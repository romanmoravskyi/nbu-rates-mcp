import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigError } from "../src/env.js";
import { healthUrl, probe } from "../src/healthcheck.js";
import { createApp } from "../src/server.js";

// Regression for #29: the Dockerfile used to interpolate the raw PORT through /bin/sh and always
// probe 127.0.0.1, so a working server was reported unhealthy (or an unreachable one healthy).
describe("healthUrl", () => {
  it("defaults to the server's own default address", () => {
    expect(healthUrl({})).toBe("http://127.0.0.1:8787/health");
  });

  it("parses PORT like the server: blank is the default, padding is trimmed", () => {
    expect(healthUrl({ PORT: "" })).toBe("http://127.0.0.1:8787/health");
    expect(healthUrl({ PORT: " 8080 " })).toBe("http://127.0.0.1:8080/health");
    expect(healthUrl({ PORT: "9000" })).toBe("http://127.0.0.1:9000/health");
  });

  it("probes loopback for wildcard hosts", () => {
    expect(healthUrl({ HOST: "0.0.0.0" })).toBe("http://127.0.0.1:8787/health");
    expect(healthUrl({ HOST: "::" })).toBe("http://127.0.0.1:8787/health");
  });

  it("probes a specific host where the server listens, bracketing IPv6", () => {
    expect(healthUrl({ HOST: "::1" })).toBe("http://[::1]:8787/health");
    expect(healthUrl({ HOST: "127.0.0.1" })).toBe("http://127.0.0.1:8787/health");
    expect(healthUrl({ HOST: " localhost ", PORT: "3000" })).toBe("http://localhost:3000/health");
  });

  it("reads NBU_MCP_HOST before HOST, as the image sets it", () => {
    const machine = "test-machine";
    expect(healthUrl({ NBU_MCP_HOST: "0.0.0.0" }, machine)).toBe("http://127.0.0.1:8787/health");
    expect(healthUrl({ NBU_MCP_HOST: "::1", HOST: "0.0.0.0" }, machine)).toBe("http://[::1]:8787/health");
    expect(healthUrl({ NBU_MCP_HOST: "[::1]" }, machine)).toBe("http://[::1]:8787/health");
    expect(healthUrl({ NBU_MCP_HOST: " ", HOST: "::1" }, machine)).toBe("http://[::1]:8787/health");
  });

  it("ignores a HOST that is just the machine name, like the server", () => {
    expect(healthUrl({ HOST: "test-machine" }, "test-machine")).toBe("http://127.0.0.1:8787/health");
  });

  it("rejects PORT=0, whose real port cannot be known", () => {
    expect(() => healthUrl({ PORT: "0" })).toThrow(ConfigError);
    expect(() => healthUrl({ PORT: "0" })).toThrow(/PORT=0/);
  });

  it("rejects an invalid PORT with the server's message", () => {
    expect(() => healthUrl({ PORT: "abc" })).toThrow(/Invalid PORT "abc"/);
  });
});

describe("probe", () => {
  const app = createApp();
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => app.close(() => resolve())));

  it("is healthy when /health answers 200", async () => {
    expect(await probe(`${base}/health`)).toBeUndefined();
  });

  it("reports a non-2xx answer", async () => {
    expect(await probe(`${base}/nope`)).toBe(`${base}/nope answered HTTP 404`);
  });

  it("exits 0 or 1 when run as the process entry", async () => {
    const run = (env: Record<string, string>) =>
      new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const child = execFile(
          process.execPath,
          ["--import", "tsx", "src/healthcheck.ts"],
          {
            cwd: fileURLToPath(new URL("..", import.meta.url)),
            env: { ...process.env, NBU_MCP_HOST: "127.0.0.1", ...env },
          },
          (_error, _stdout, stderr) => resolve({ code: child.exitCode, stderr }),
        );
      });
    const port = String((app.address() as AddressInfo).port);
    const ok = await run({ PORT: ` ${port} ` });
    expect(ok.code).toBe(0);
    expect(ok.stderr).not.toMatch(/unhealthy/);
    const zero = await run({ PORT: "0" });
    expect(zero.code).toBe(1);
    expect(zero.stderr).toMatch(/^unhealthy: PORT=0/);
  }, 20_000);

  it("reports a refused connection without throwing", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(closed.address() as AddressInfo).port}/health`;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expect(await probe(url)).toMatch(/failed: .*ECONNREFUSED/);
  });

  it("reports a URL it cannot request instead of throwing", async () => {
    expect(await probe("http://[fe80::1%eth0]:8787/health")).toMatch(
      /^http:\/\/\[fe80::1%eth0\]:8787\/health failed: /,
    );
  });

  it("gives up on a server that never answers", async () => {
    const silent = createServer(() => {});
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(silent.address() as AddressInfo).port}/health`;
    try {
      expect(await probe(url, 100)).toBe(`${url} failed: no answer within 100 ms`);
    } finally {
      silent.closeAllConnections();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });
});
