import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NBU_API_URL } from "../src/nbu.js";
import { DEFAULT_GRACE_MS } from "../src/shutdown.js";
import { RATES_2026_10_22 } from "./fixtures.js";

// End to end for #30: test/shutdown.test.ts drives the handler directly, so this one sends a real
// SIGTERM to the HTTP server entry and checks the wiring in src/index.ts. Skipped on Windows, where
// child.kill("SIGTERM") terminates the process at once without running signal handlers.

const UPSTREAM_DELAY_MS = 1500;
const FETCH_STARTED = "test: NBU fetch started";

// The server runs in a child process, so a fake fetch cannot be injected. This preload, loaded in
// the same process, answers NBU URLs with the fixture after a delay and rejects anything else, so
// the real NBU API is never called. It logs a marker when the NBU fetch starts, so the test sends
// the signal only once the request is known to be in flight.
const slowNbu = `data:text/javascript,${encodeURIComponent(`
const payload = ${JSON.stringify(RATES_2026_10_22)};
globalThis.fetch = async (input) => {
  if (!String(input).startsWith(${JSON.stringify(NBU_API_URL)})) throw new Error("network is disabled in tests");
  console.log(${JSON.stringify(FETCH_STARTED)});
  await new Promise((resolve) => setTimeout(resolve, ${UPSTREAM_DELAY_MS}));
  return Response.json(payload);
};`)}`;

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
let child: ChildProcess | undefined;

afterEach(() => {
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  child = undefined;
});

interface Server {
  url: string;
  stdout: () => string;
  /** Resolves once the child's stdout contains `text`. */
  waitFor: (text: string) => Promise<void>;
}

/** Start the HTTP entry on a free port; resolve once it reports the URL it listens on. */
function startServer(): Promise<Server> {
  const proc = spawn(process.execPath, ["--import", "tsx", "--import", slowNbu, entry], {
    // PORT=0 picks a free port; the startup log reports it. Blank values count as unset, so the
    // caller's shell cannot change how the server starts.
    env: {
      ...process.env,
      PORT: "0",
      NBU_MCP_HOST: "127.0.0.1",
      HOST: "",
      ALLOWED_HOSTS: "",
      MCP_TRANSPORT: "",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  child = proc;
  let out = "";
  const waiters = new Set<() => void>();
  const waitFor = (text: string) =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (!out.includes(text)) return;
        waiters.delete(check);
        resolve();
      };
      waiters.add(check);
      check();
    });
  return new Promise((resolve, reject) => {
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      out += chunk;
      for (const check of [...waiters]) check();
      const url = out.match(/listening on (http:\/\/\S+\/mcp)/)?.[1];
      if (url) resolve({ url, stdout: () => out, waitFor });
    });
    proc.once("error", reject);
    proc.once("exit", (code, signal) => reject(new Error(`server exited early (${code ?? signal}): ${out}`)));
  });
}

function exited(proc: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return Promise.resolve({ code: proc.exitCode, signal: proc.signalCode });
  }
  return new Promise((resolve) => proc.once("exit", (code, signal) => resolve({ code, signal })));
}

describe.skipIf(process.platform === "win32")("graceful shutdown on a real SIGTERM (#30)", () => {
  it("finishes an in-flight tools/call, then exits 0 well within the grace period", async () => {
    const { url, stdout, waitFor } = await startServer();
    const proc = child as ChildProcess;
    const exit = exited(proc);

    const pending = fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_rate", arguments: { currency: "USD", date: "2026-10-22" } },
      }),
    }).then(async (res) => ({ status: res.status, text: await res.text() }));

    await waitFor(FETCH_STARTED);
    const signalledAt = Date.now();
    expect(proc.kill("SIGTERM")).toBe(true);

    const { status, text } = await pending;
    expect(status).toBe(200);
    // Responses may be plain JSON or a single SSE event.
    const json = text.startsWith("{") ? text : (text.match(/^data: (.*)$/m)?.[1] ?? text);
    const { result } = JSON.parse(json);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ currency: "USD", rate_uah: 45.0256 });

    const { code, signal } = await exit;
    const elapsed = Date.now() - signalledAt;
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(stdout()).toContain("SIGTERM received, finishing in-flight requests");
    expect(stdout()).not.toContain("Requests still running");
    // The process waited for the upstream answer (about 1.5 s after the signal), then exited
    // without waiting out the grace period.
    expect(elapsed).toBeGreaterThanOrEqual(UPSTREAM_DELAY_MS - 200);
    expect(elapsed).toBeLessThan(DEFAULT_GRACE_MS - 1000);
  }, 30_000);
});
