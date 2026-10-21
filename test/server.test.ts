import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server.js";
import { fakeFetch, RATES_2026_10_22 } from "./fixtures.js";

const realFetch = globalThis.fetch;
const app = createApp();
let base = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
afterAll(async () => {
  app.closeAllConnections();
  await new Promise((resolve) => app.close(resolve));
});

/** Stub global fetch for NBU URLs only; requests to the test server still go out for real. */
function stubNbu(routes: Record<string, unknown>) {
  const nbu = fakeFetch(routes);
  const stub = vi.fn((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    String(input).startsWith(base) ? realFetch(input, init) : nbu.fetch(input, init),
  );
  vi.stubGlobal("fetch", stub);
  return nbu;
}

async function mcp(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const res = await realFetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  // Responses may be plain JSON or a single SSE event.
  const json = text.startsWith("{") ? text : (text.match(/^data: (.*)$/m)?.[1] ?? text);
  return { status: res.status, body: JSON.parse(json) };
}

describe("HTTP server", () => {
  it("serves /health and the home page", async () => {
    const health = await realFetch(`${base}/health`);
    expect(await health.json()).toEqual({ ok: true });
    const home = await realFetch(`${base}/`);
    expect(await home.text()).toContain(`${base}/mcp`);
  });

  it("answers 404 for unknown paths, 405 for wrong methods", async () => {
    expect((await realFetch(`${base}/nope`)).status).toBe(404);
    expect((await realFetch(`${base}/health`, { method: "POST" })).status).toBe(405);
    const get = await realFetch(`${base}/mcp`, { headers: { accept: "text/event-stream" } });
    expect(get.status).toBe(405);
  });

  it("lists exactly the three tools over MCP", async () => {
    const { body } = await mcp("tools/list");
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["convert", "get_rate", "list_rates"]);
  });

  it("returns an MCP tool error (not a crash) for an unknown currency", async () => {
    const nbu = stubNbu({ "20261019": RATES_2026_10_22 });
    const { status, body } = await mcp("tools/call", {
      name: "get_rate",
      arguments: { currency: "XXX", date: "2026-10-19" },
    });
    expect(status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/does not publish an official rate for "XXX"/);
    expect(nbu.calls).toHaveLength(1);
  });

  it("converts 100 EUR to USD end to end with one upstream call", async () => {
    const nbu = stubNbu({ "20261018": RATES_2026_10_22 });
    const { body } = await mcp("tools/call", {
      name: "convert",
      arguments: { amount: 100, from: "EUR", to: "USD", date: "2026-10-18" },
    });
    expect(body.result.structuredContent.result).toBe(112.29);
    expect(nbu.calls).toHaveLength(1);
  });

  it("rejects foreign Host and Origin headers on /mcp (DNS rebinding)", async () => {
    // fetch cannot override Host, so use node:http for this one.
    const status403 = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${base}/mcp`, { method: "POST", headers: { host: "evil.example" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on("error", reject);
      req.end("{}");
    });
    expect(status403).toBe(403);
    const { status } = await mcp("tools/list", {}, { origin: "https://evil.example" });
    expect(status).toBe(403);
  });
});

/** Raw request via node:http, which (unlike fetch) lets a test set Host and odd request targets. */
function raw(path: string, headers: Record<string, string> = {}, method = "GET", body?: string) {
  return new Promise<{ status: number | undefined; headers: Record<string, unknown>; body: string }>(
    (resolve, reject) => {
      const req = request(`${base}/`, { path, method, headers }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
      });
      req.on("error", reject);
      req.end(body);
    },
  );
}

describe("untrusted Host and X-Forwarded-* headers (#14)", () => {
  const badProtos = ["javascript", "ftp", "a b", "<script>alert(1)</script>", "https://evil"];
  const badHosts = ["local host", "<script>alert(1)</script>", "evil.example/phish", "evil.example:99999"];

  it("never answers 500 on any route for malformed X-Forwarded-Proto or Host", async () => {
    for (const path of ["/", "/health", "/nope"]) {
      for (const proto of badProtos) {
        expect((await raw(path, { "x-forwarded-proto": proto })).status).toBeLessThan(500);
      }
      for (const host of badHosts) {
        expect((await raw(path, { host, "x-forwarded-host": host })).status).toBeLessThan(500);
      }
    }
    expect((await raw("/health", { "x-forwarded-proto": "a b", host: "local host" })).status).toBe(200);
  });

  it("answers 400, not 500, for a request target that is not a valid http(s) URL", async () => {
    expect((await raw("http://[/")).status).toBe(400);
    expect((await raw("file:///mcp", {}, "POST", "{}")).status).toBe(400);
    expect((await raw("//[")).status).toBe(404);
    expect((await raw("*", {}, "OPTIONS")).status).toBe(405);
  });

  it("never reflects unvalidated header content on the home page", async () => {
    for (const proto of badProtos) {
      const home = await raw("/", { host: "localhost:8787", "x-forwarded-proto": proto });
      expect(home.status).toBe(200);
      expect(home.body).toContain("http://localhost:8787/mcp");
      expect(home.body).not.toMatch(/javascript|ftp|script|evil|a b/);
    }
    for (const host of badHosts) {
      const home = await raw("/", { host, "x-forwarded-host": host, "x-forwarded-proto": "https" });
      expect(home.status).toBe(200);
      expect(home.body).toContain("https://localhost/mcp");
      expect(home.body).not.toMatch(/script|evil|local host/);
    }
  });

  it("ignores X-Forwarded-Host and varies the cached home page on Host and X-Forwarded-Proto", async () => {
    const home = await raw("/", { host: "rates.example.com", "x-forwarded-host": "evil.example" });
    expect(home.body).toContain("http://rates.example.com/mcp");
    expect(home.body).not.toContain("evil");
    expect(home.headers.vary).toMatch(/\bhost\b/i);
    expect(home.headers.vary).toMatch(/x-forwarded-proto/i);
  });

  it("still uses valid X-Forwarded-Proto and Host values", async () => {
    const https = await raw("/", { host: "Rates.Example.com:8443", "x-forwarded-proto": "HTTPS, http" });
    expect(https.body).toContain(
      "claude mcp add --transport http nbu-rates https://rates.example.com:8443/mcp",
    );
    const ipv6 = await raw("/", { host: "[::1]:8787", "x-forwarded-proto": "http" });
    expect(ipv6.body).toContain("http://[::1]:8787/mcp");
    const compose = await raw("/", { host: "nbu_rates:8787" });
    expect(compose.body).toContain("http://nbu_rates:8787/mcp");
  });

  it("serves /mcp normally with odd X-Forwarded-* headers and keeps the Host check", async () => {
    const nbu = stubNbu({ "20261017": RATES_2026_10_22 });
    for (const proto of ["https", "https, http", "javascript", "a b"]) {
      const { status, body } = await mcp(
        "tools/call",
        { name: "get_rate", arguments: { currency: "USD", date: "2026-10-17" } },
        { "x-forwarded-proto": proto, "x-forwarded-host": "<script>" },
      );
      expect(status).toBe(200);
      expect(body.result.isError).toBeFalsy();
    }
    expect(nbu.calls).toHaveLength(1);
    const rpc = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    for (const host of ["local host", "<script>", "evil.example"]) {
      expect((await raw("/mcp", { ...headers, host }, "POST", rpc)).status).toBe(403);
    }
    expect((await raw("//evil.example/mcp")).status).toBe(404); // a path, not a host: GET /mcp would be 405
  });
});
