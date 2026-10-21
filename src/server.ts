/**
 * HTTP layer: routes GET /, GET /health and the stateless Streamable HTTP MCP endpoint at /mcp.
 * Built on node:http and the official MCP TypeScript SDK; see docs/ADR-001-transport.md.
 */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { NbuClient } from "./nbu.js";
import { publicOrigin, requestPath } from "./request.js";
import { registerTools } from "./tools.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

export const SERVER_NAME = "nbu-rates-mcp";
export const VERSION: string = pkg.version;
const TOOL_NAMES = ["get_rate", "list_rates", "convert"] as const;
export const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export interface AppOptions {
  /** Shared NBU client (and therefore shared cache) for all requests. */
  client?: NbuClient;
  /** Hostnames accepted in Host/Origin on /mcp (DNS-rebinding protection). "*" disables the check. */
  allowedHosts?: string[];
}

/** Build a fresh MCP server per request (stateless Streamable HTTP). */
export function createMcpServer(client: NbuClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    {
      instructions:
        "Official exchange rates of the National Bank of Ukraine (NBU). Rates are UAH per 1 unit of foreign currency. Dates are YYYY-MM-DD; omit for today.",
    },
  );
  registerTools(server, client);
  return server;
}

function homePage(origin: string): string {
  return [
    `${SERVER_NAME} v${VERSION}`,
    "Self-hosted MCP server for official NBU (National Bank of Ukraine) exchange rates.",
    "",
    `MCP endpoint (Streamable HTTP, no auth): ${origin}/mcp`,
    `Tools: ${TOOL_NAMES.join(", ")}`,
    "",
    `Claude Code: claude mcp add --transport http nbu-rates ${origin}/mcp`,
    "claude.ai: Settings -> Connectors -> Add custom connector (needs a public HTTPS URL, not localhost).",
    "",
    "Source: https://github.com/romanmoravskyi/nbu-rates-mcp",
    "Data: NBU open data, https://bank.gov.ua/ua/open-data/api-dev",
    "",
  ].join("\n");
}

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers });
  res.end(body);
}

function sendJsonRpcError(res: ServerResponse, status: number, message: string, headers = {}): void {
  const body = JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
  send(res, status, body, { "content-type": "application/json", ...headers });
}

/** Hostname of a Host header or Origin URL, without the port ("[::1]" keeps its brackets). */
function hostnameOf(value: string): string | undefined {
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Reject requests whose Host (or browser Origin) is not ours. Guards a local server against DNS rebinding. */
function hostAllowed(req: IncomingMessage, allowed: string[]): boolean {
  if (allowed.includes("*")) return true;
  const host = hostnameOf(req.headers.host ?? "");
  if (!host || !allowed.includes(host)) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true; // non-browser MCP clients send no Origin
  const originHost = hostnameOf(origin);
  return originHost !== undefined && allowed.includes(originHost);
}

async function handleMcp(req: IncomingMessage, res: ServerResponse, client: NbuClient): Promise<void> {
  if (req.method !== "POST") {
    // Stateless server: no standalone SSE stream (GET) and no sessions to delete (DELETE).
    sendJsonRpcError(res, 405, "Method not allowed.", { allow: "POST" });
    return;
  }
  const server = createMcpServer(client);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

/** Create the HTTP server (not yet listening). */
export function createApp(options: AppOptions = {}): Server {
  const client = options.client ?? new NbuClient();
  const allowedHosts = (options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS).map((h) => h.toLowerCase());

  return createServer(async (req, res) => {
    try {
      const path = requestPath(req.url);
      if (path === undefined) {
        send(res, 400, "Bad Request");
        return;
      }
      if (path === "/mcp") {
        if (!hostAllowed(req, allowedHosts)) {
          sendJsonRpcError(res, 403, "Forbidden: Host or Origin not allowed. See ALLOWED_HOSTS.");
          return;
        }
        await handleMcp(req, res, client);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        send(res, 405, "Method Not Allowed", { allow: "GET, HEAD" });
        return;
      }
      if (path === "/") {
        send(res, 200, homePage(publicOrigin(req.headers)), {
          "cache-control": "public, max-age=300",
          vary: "Host, X-Forwarded-Proto",
        });
        return;
      }
      if (path === "/health") {
        send(res, 200, JSON.stringify({ ok: true }), { "content-type": "application/json" });
        return;
      }
      send(res, 404, "Not Found");
    } catch (err) {
      console.error(JSON.stringify({ msg: "request failed", error: String(err) }));
      if (!res.headersSent) sendJsonRpcError(res, 500, "Internal server error.");
      else res.end();
    }
  });
}
