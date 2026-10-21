import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gracefulShutdown } from "../src/shutdown.js";

let server: Server | undefined;

afterEach(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise((resolve) => server?.close(resolve));
  server = undefined;
});

/**
 * Start a server that answers "done" after `delayMs` (never, if undefined). With `stream`, it sends
 * the headers and a first chunk at once, like the MCP transport's SSE responses.
 */
async function start(delayMs?: number, stream = false) {
  let arrived: () => void = () => {};
  const firstRequest = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const srv = createServer((_req, res) => {
    if (stream) res.write("...");
    arrived();
    if (delayMs !== undefined) setTimeout(() => res.end("done"), delayMs);
  });
  server = srv;
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  return { srv, firstRequest, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/` };
}

/** Send one request (keep-alive, as MCP clients do), signal shutdown once it is in flight. */
async function shutdownDuring(delayMs: number | undefined, stream: boolean, graceMs: number) {
  const { srv, firstRequest, url } = await start(delayMs, stream);
  const exit = vi.fn();
  const log = vi.fn();
  const shutdown = gracefulShutdown(srv, { graceMs, exit, log });
  const pending = fetch(url);
  pending.catch(() => {});
  await firstRequest;
  shutdown("SIGTERM");
  return { pending, exit, log, shutdown, url };
}

describe("gracefulShutdown", () => {
  // Regression for #9: shutdown used to call closeAllConnections() and reset in-flight requests.
  it("lets an in-flight request finish, then exits 0 without waiting for the grace period", async () => {
    const { pending, exit } = await shutdownDuring(300, false, 10_000);

    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.headers.get("connection")).toBe("close");
    expect(await res.text()).toBe("done");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 2000 });
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("also drains a response whose headers were already sent (SSE-style)", async () => {
    const { pending, exit } = await shutdownDuring(300, true, 10_000);

    const res = await pending;
    expect(await res.text()).toBe("...done");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 2000 });
  });

  it("stops accepting new connections", async () => {
    const { pending, exit, url } = await shutdownDuring(300, false, 10_000);
    await expect(fetch(url)).rejects.toMatchObject({ cause: { code: "ECONNREFUSED" } });
    await pending;
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 2000 });
  });

  it("exits 0 after the grace period when a request is still running", async () => {
    const { exit, log } = await shutdownDuring(undefined, false, 100);

    expect(exit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 2000 });
    expect(log).toHaveBeenLastCalledWith("Requests still running after 100 ms, exiting");
  });

  it("exits at once on a second signal", async () => {
    const { exit, log, shutdown } = await shutdownDuring(undefined, false, 10_000);

    expect(exit).not.toHaveBeenCalled();
    shutdown("SIGINT");
    expect(exit).toHaveBeenCalledWith(0);
    expect(log).toHaveBeenLastCalledWith("SIGINT received again, exiting now");
  });
});
