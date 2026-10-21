/**
 * stdio transport: the MCP client (Claude Code, Claude Desktop) launches this process itself and
 * talks JSON-RPC over stdin/stdout. Nothing may be written to stdout except protocol messages, so
 * all logging goes to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { NbuClient } from "./nbu.js";
import { createMcpServer, SERVER_NAME, VERSION } from "./server.js";

export async function runStdio(client: NbuClient = new NbuClient()): Promise<void> {
  const server = createMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${VERSION} serving MCP over stdio`);
  const stop = () => server.close().finally(() => process.exit(0));
  process.stdin.on("close", stop);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
