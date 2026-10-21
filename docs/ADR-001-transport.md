# ADR-001: Stateless Streamable HTTP on `node:http` with the official MCP SDK

- Status: Accepted
- Date: 2026-10-21
- Deciders: Roman Moravskyi (implemented by an AI coding agent from `docs/IMPLEMENTATION_PLAN.md`)

## Context

The server must be reachable by Claude Code, Claude Desktop and (once hosted behind HTTPS)
claude.ai custom connectors through a single URL, without authentication. It has to run anywhere
Node.js runs: a laptop, a container, a platform such as Fly.io or Railway, or a VPS, with no
provider-specific runtime, bindings or config files.

All three tools are pure, read-only lookups. Nothing needs to survive between requests except an
HTTP cache of upstream answers.

Two HTTP layers were considered on top of the official `@modelcontextprotocol/sdk` (1.32.x):

1. **Node's built-in `node:http`.** The SDK's `StreamableHTTPServerTransport` takes Node's
   `IncomingMessage`/`ServerResponse` directly (`transport.handleRequest(req, res)`).
2. **`hono` with `@hono/node-server`.** Nicer routing and middleware, and a web-standard
   `Request`/`Response` API.

## Decision

1. Use **`node:http`**. The app has three routes (`/`, `/health`, `/mcp`), which a few `if`
   statements cover; the SDK transport speaks Node's request/response types natively, so there is
   no adapter layer; and it adds zero direct runtime dependencies beyond the SDK and `zod`.
   Swapping to Hono later only touches `src/server.ts`.
2. Run the transport in **stateless mode** (`sessionIdGenerator: undefined`): build a fresh
   `McpServer` and `StreamableHTTPServerTransport` per POST, close both when the response closes.
   No session IDs, no standalone SSE stream: `GET` and `DELETE` on `/mcp` return 405. Any replica
   can answer any request, so horizontal scaling needs no sticky sessions.
3. Share **one `NbuClient`** (and therefore one cache) across requests for the life of the process.
4. Protect against **DNS rebinding** in the HTTP layer: on `/mcp`, the `Host` hostname, and the
   `Origin` hostname when a browser sends one, must be `localhost`, `127.0.0.1`, `[::1]` or a name
   listed in `ALLOWED_HOSTS` (`*` disables the check). Non-browser MCP clients send no `Origin`.
   `/` and `/health` are not checked, so platform health probes work on any address.
5. Bind to `127.0.0.1` by default (`HOST` overrides; the Docker image sets `0.0.0.0`), port 8787
   by default (`PORT` overrides).
6. Fetch the **all-currencies** NBU endpoint for a date (`?date=YYYYMMDD&json`) and filter locally
   instead of calling `?valcode=XXX`. One cache entry per date then serves `get_rate`,
   `list_rates` and `convert` (which needs two currencies) alike, and upstream traffic stays tiny.
7. Cache parsed upstream answers in a small **in-memory TTL cache** (`src/cache.ts`) keyed by the
   upstream URL: 1 hour for today/tomorrow, 24 hours for past dates, at most 1000 entries (oldest
   evicted first). Empty responses are not cached, because tomorrow's rates appear in the
   afternoon.

## Other choices made while implementing

- **Date window.** "Today" is computed in `Europe/Kyiv`. Dates up to tomorrow are accepted; an
  empty NBU answer becomes a clear "not published yet" tool error.
- **Errors.** Validation and upstream problems become MCP tool results with `isError: true` and a
  readable message. Unexpected exceptions are logged as JSON and reported generically.
- **Output.** Each tool returns a one-line summary and the JSON (both as text content) plus the
  same object as `structuredContent`. No `outputSchema` is declared yet, to keep the contract easy
  to extend; adding one later is backward compatible.
- **Tests.** Plain Vitest in Node. Unit tests inject a fake `fetch` into `NbuClient`; end-to-end
  tests start the real HTTP server on an ephemeral port and `vi.stubGlobal("fetch", ...)` so NBU
  URLs are answered from fixtures.
- **Build.** `tsc` compiles `src/` to `dist/` (ESM, `nodenext`); `tsx watch` runs the sources in
  development. The version string is read from `package.json` at startup.
- **TypeScript 7 and Biome 2.6** were current at build time and are used as-is.

## Consequences

- Positive: no provider lock-in, no build bundler, one small process; runs the same on a laptop,
  in Docker or on any Node platform.
- Positive: shared per-date cache entries keep NBU load to a few requests per process per day.
- Negative: the cache is per process. It is empty after a restart and not shared between
  replicas, so each replica fetches each date once. For this traffic that is fine; a shared cache
  (for example Redis) would need a new ADR.
- Negative: no server-initiated messages, resumable streams or sessions. None are needed for
  these tools; if a future feature needs them, a new ADR should revisit stateful mode with a
  session store.
- Negative: no built-in TLS or rate limiting. Public instances should sit behind a reverse proxy
  or platform that terminates HTTPS and limits abusive clients.
