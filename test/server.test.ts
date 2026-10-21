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
