import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const client = new Client({ name: "test", version: "0.0.0" });

beforeAll(async () => {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["./node_modules/tsx/dist/cli.mjs", "src/index.ts", "--stdio"],
      stderr: "pipe",
    }),
  );
}, 30_000);
afterAll(() => client.close());

describe("stdio transport", () => {
  it("lists the three tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["convert", "get_rate", "list_rates"]);
  });

  it("returns a tool error for an unknown currency without crashing", async () => {
    const result = await client.callTool({ name: "get_rate", arguments: { currency: "XXX" } });
    expect(result.isError).toBe(true);
  });
});
