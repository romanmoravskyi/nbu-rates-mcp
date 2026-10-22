import { execFile } from "node:child_process";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigError } from "../src/env.js";
import { type HealthTarget, healthTarget, healthUrl, probe } from "../src/healthcheck.js";
import { createApp } from "../src/server.js";

const machine = "test-machine";
const target = (env: NodeJS.ProcessEnv): HealthTarget => healthTarget(env, machine);

// Regression for #29: the Dockerfile used to interpolate the raw PORT through /bin/sh and always
// probe 127.0.0.1, so a working server was reported unhealthy (or an unreachable one healthy).
describe("healthTarget", () => {
  it("defaults to the server's own default address", () => {
    expect(target({})).toEqual({ host: "127.0.0.1", port: 8787 });
    expect(healthTarget({ PORT: "9000" })).toEqual({ host: "127.0.0.1", port: 9000 });
  });

  it("parses PORT like the server: blank is the default, padding is trimmed", () => {
    expect(target({ PORT: "" }).port).toBe(8787);
    expect(target({ PORT: " 8080 " }).port).toBe(8080);
  });

  it("probes loopback for wildcard hosts", () => {
    expect(target({ HOST: "0.0.0.0" }).host).toBe("127.0.0.1");
    expect(target({ HOST: "::" }).host).toBe("127.0.0.1");
  });

  it("probes a specific host where the server listens", () => {
    expect(target({ HOST: "::1" }).host).toBe("::1");
    expect(target({ HOST: "127.0.0.1" }).host).toBe("127.0.0.1");
    expect(target({ HOST: " localhost ", PORT: "3000" })).toEqual({ host: "localhost", port: 3000 });
  });

  it("reads NBU_MCP_HOST before HOST, as the image sets it", () => {
    expect(target({ NBU_MCP_HOST: "0.0.0.0" }).host).toBe("127.0.0.1");
    expect(target({ NBU_MCP_HOST: "::1", HOST: "0.0.0.0" }).host).toBe("::1");
    expect(target({ NBU_MCP_HOST: "[::1]" }).host).toBe("::1");
    expect(target({ NBU_MCP_HOST: " ", HOST: "::1" }).host).toBe("::1");
  });

  it("ignores a HOST that is just the machine name, like the server", () => {
    expect(target({ HOST: machine }).host).toBe("127.0.0.1");
  });

  it("rejects PORT=0, whose real port cannot be known", () => {
    expect(() => target({ PORT: "0" })).toThrow(ConfigError);
    expect(() => target({ PORT: "0" })).toThrow(/PORT=0/);
  });

  it("rejects an invalid PORT with the server's message", () => {
    expect(() => target({ PORT: "abc" })).toThrow(/Invalid PORT "abc"/);
  });
});

describe("healthUrl", () => {
  it("brackets IPv6 hosts", () => {
    expect(healthUrl({ host: "127.0.0.1", port: 8787 })).toBe("http://127.0.0.1:8787/health");
    expect(healthUrl({ host: "::1", port: 8080 })).toBe("http://[::1]:8080/health");
  });
});

async function listen(handler?: RequestListener): Promise<{ server: Server; to: HealthTarget }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, to: { host: "127.0.0.1", port: (server.address() as AddressInfo).port } };
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("probe", () => {
  const app = createApp();
  let to: HealthTarget;

  beforeAll(async () => {
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    to = { host: "127.0.0.1", port: (app.address() as AddressInfo).port };
  });
  afterAll(() => close(app));

  it("is healthy when /health answers 200", async () => {
    expect(await probe(to)).toBeUndefined();
  });

  it("reports a non-2xx answer", async () => {
    const { server, to: failing } = await listen((_req, res) => res.writeHead(503).end());
    try {
      expect(await probe(failing)).toBe(`${healthUrl(failing)} answered HTTP 503`);
    } finally {
      await close(server);
    }
  });

  it("exits 0 or 1 when run as the process entry", async () => {
    const run = (env: Record<string, string>) =>
      new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const child = execFile(
          process.execPath,
          ["--import", "tsx", "src/healthcheck.ts"],
          {
            cwd: fileURLToPath(new URL("..", import.meta.url)),
            // Drop inherited settings that could change the child's behaviour or output.
            env: { ...process.env, NODE_OPTIONS: "", HOST: "", NBU_MCP_HOST: "127.0.0.1", ...env },
          },
          (_error, _stdout, stderr) => resolve({ code: child.exitCode, stderr }),
        );
      });
    const ok = await run({ PORT: ` ${to.port} ` });
    expect(ok.code).toBe(0);
    expect(ok.stderr).not.toMatch(/unhealthy/);
    const zero = await run({ PORT: "0" });
    expect(zero.code).toBe(1);
    expect(zero.stderr).toMatch(/^unhealthy: PORT=0/);
  }, 20_000);

  it("reports a refused connection without throwing", async () => {
    const { server, to: refused } = await listen();
    await close(server);
    expect(await probe(refused)).toMatch(/failed: .*ECONNREFUSED/);
  });

  it("reports options `http.get` rejects synchronously instead of throwing", async () => {
    expect(await probe({ host: "127.0.0.1", port: 70000 })).toMatch(
      /^http:\/\/127\.0\.0\.1:70000\/health failed: /,
    );
  });

  it("gives up on a server that never answers", async () => {
    const { server, to: silent } = await listen(() => {});
    try {
      expect(await probe(silent, 100)).toBe(`${healthUrl(silent)} failed: no answer within 100 ms`);
    } finally {
      await close(server);
    }
  });
});
