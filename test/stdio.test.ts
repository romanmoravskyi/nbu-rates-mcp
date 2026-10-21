import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The server runs in a child process, so a fake fetch cannot be injected. This preload makes every
// fetch in the child fail at once, so no test can reach the real NBU API or wait for its timeout.
const blockFetch =
  "data:text/javascript,globalThis.fetch=()=>Promise.reject(new Error('network is disabled in tests'))";

const client = new Client({ name: "test", version: "0.0.0" });

beforeAll(async () => {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "--import", blockFetch, "src/index.ts", "--stdio"],
      // Inherit so server diagnostics show up in the test output; an unread pipe could fill up.
      stderr: "inherit",
    }),
  );
}, 30_000);
afterAll(() => client.close());

const textOf = (result: Awaited<ReturnType<typeof client.callTool>>): string =>
  (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");

describe("stdio transport", () => {
  it("lists the three tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["convert", "get_rate", "list_rates"]);
  });

  it("returns a readable tool error for an invalid currency without crashing", async () => {
    const result = await client.callTool({ name: "get_rate", arguments: { currency: "X1Z" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Invalid currency code "X1Z"/);
  });

  it("returns a tool error, without touching the network, when the upstream call fails", async () => {
    const result = await client.callTool({ name: "get_rate", arguments: { currency: "XXX" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/network is disabled in tests/);
  });
});
