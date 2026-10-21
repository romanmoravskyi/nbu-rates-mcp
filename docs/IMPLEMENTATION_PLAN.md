# Implementation Plan: nbu-rates-mcp

A self-hosted MCP (Model Context Protocol) server in plain Node.js that exposes the National Bank
of Ukraine (NBU) official exchange rates, so Claude (Claude Code, Claude Desktop, and claude.ai
once the server is hosted behind HTTPS) can fetch official UAH rates.

This is a living document: it describes the current design. Decisions and their reasons are in
[ADR-001](ADR-001-transport.md).

Owner: Roman Moravskyi (GitHub `romanmoravskyi`). Public repo. MIT license.

## 1. Goal and non-goals

Goal
- One URL, `http://localhost:8787/mcp` locally or `https://<your-host>/mcp` when hosted, that
  speaks MCP over Streamable HTTP, no auth, and offers three tools backed by the NBU API.
- Runs on any Node host or container (Docker, Fly.io, Railway, a VPS) with no provider-specific
  code or config.

Non-goals
- No authentication, no user data, no storage of anything beyond a short in-memory cache.
- No market/interbank rates. Only official NBU rates.
- No built-in TLS or rate limiting; a reverse proxy or the hosting platform provides those.

## 2. Upstream API

Base: `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange`

| Query | Returns |
|---|---|
| `?json` | all currencies, today |
| `?valcode=USD&json` | one currency, today |
| `?valcode=USD&date=20261021&json` | one currency, given date (`YYYYMMDD`) |
| `?date=20261021&json` | all currencies, given date |

The server only uses `?json` (today) and `?date=YYYYMMDD&json`: one upstream call per date,
filtered locally.

Response item shape:
```json
{ "r030": 840, "txt": "Долар США", "rate": 45.0256, "cc": "USD", "exchangedate": "22.10.2026", "special": "N" }
```
Notes: `rate` is UAH per 1 unit. `special` may be `null`. Weekends and holidays return the rate
set for that date (NBU sets rates for every calendar day). Dates without published rates return `[]`.

## 3. Tools

All tools return a one-line human summary and the JSON as text content, plus the same JSON as
`structuredContent`. Failures are tool results with `isError: true` and a readable message.

1. `get_rate` — `{ currency: string (ISO 4217, case-insensitive), date?: string (YYYY-MM-DD) }`
   → `{ currency, rate_uah, date, name_uk }`. Error if the currency is unknown.
2. `list_rates` — `{ date?: string, currencies?: string[] }` → `{ date, rates: [{ currency, rate_uah, name_uk }] }`
   sorted by currency code. Error if a requested currency is unknown.
3. `convert` — `{ amount: number, from: string, to: string, date?: string }`.
   `UAH` allowed on either side. Cross rates via UAH: `amount * rate(from) / rate(to)`.
   → `{ amount, from, to, result, rate_used, date }`. `result` rounded to 2 decimals, `rate_used` to 6.

Validation: dates must be `YYYY-MM-DD` real calendar days, not later than tomorrow in Kyiv (NBU
publishes next-day rates after about 15:30 Kyiv time). An empty NBU answer is a "not published
yet" error.

## 4. Stack

- Node.js 22, TypeScript (strict, ESM, `nodenext`), compiled with `tsc` to `dist/`; `tsx watch`
  for development.
- MCP: official `@modelcontextprotocol/sdk`, `McpServer` + `StreamableHTTPServerTransport` in
  stateless mode, a new pair per request.
- HTTP: `node:http`. Routes: `POST /mcp` (MCP), `GET /` (plain-text info page with name, version,
  tool list and endpoint), `GET /health` (`{"ok":true}`). `GET`/`DELETE /mcp` return 405.
- Configuration by environment: `PORT` (default 8787), `HOST` (default `127.0.0.1`),
  `ALLOWED_HOSTS` (extra hostnames for the Host/Origin DNS-rebinding check on `/mcp`).
- Caching: in-memory TTL cache keyed by upstream URL, 1 hour for today/tomorrow, 24 hours for past
  dates, empty answers not cached, at most 1000 entries.
- Input schemas: `zod`.
- Tests: plain `vitest`; fetch mocked by injection into `NbuClient` or `vi.stubGlobal`; end-to-end
  tests start the HTTP server on an ephemeral port.
- Lint/format: `biome`. `npm run check` runs typecheck + lint + tests.
- Packaging: multi-stage `node:22-alpine` Dockerfile, non-root, `/health` healthcheck.

## 5. Repository layout

```
nbu-rates-mcp/
  .github/
    workflows/ci.yml          # node 22: npm ci, npm run check, npm run build
    ISSUE_TEMPLATE/bug_report.md, feature_request.md, config.yml
    PULL_REQUEST_TEMPLATE.md
    dependabot.yml            # npm, Docker base image, GitHub Actions
  docs/
    IMPLEMENTATION_PLAN.md    # this file
    ADR-001-transport.md
    CONNECTOR_SETUP.md        # Claude Code, Claude Desktop, hosted instance + claude.ai
  src/
    index.ts                  # process entry: env config, listen, graceful shutdown
    server.ts                 # node:http routing, Host/Origin check, McpServer per request
    tools.ts                  # tool definitions (zod schemas) and handlers
    nbu.ts                    # upstream client, TTLs, types, error classes
    cache.ts                  # in-memory TTL cache
    validate.ts               # date/currency validation helpers
  test/
    cache.test.ts, nbu.test.ts, server.test.ts, tools.test.ts, validate.test.ts, fixtures.ts
  Dockerfile, .dockerignore
  README.md, AGENTS.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, CHANGELOG.md, LICENSE
  package.json, tsconfig.json, tsconfig.build.json, biome.json, vitest.config.ts, .gitignore, .editorconfig
```

## 6. Documentation requirements

- README.md: badges (CI, license, Node.js, MCP), pitch, demo, run locally, configuration table,
  "Add to Claude" (Claude Code `claude mcp add --transport http nbu-rates http://localhost:8787/mcp`,
  Claude Desktop via `mcp-remote`, claude.ai custom connector once hosted behind HTTPS), tool
  reference, development, hosting (Docker and plain Node), caching and rate limits, architecture,
  NBU attribution, license.
- AGENTS.md: commands, layout, conventions, what not to do, end-to-end verification with the MCP
  Inspector CLI.
- CONTRIBUTING.md: setup, branch/PR flow, conventional commits, tests, release steps.
- CHANGELOG.md: Keep a Changelog format.

## 7. Verifying a build

1. `npm run check` is green.
2. `npm start`, then with the MCP Inspector CLI:
   - `--method tools/list` returns exactly `get_rate`, `list_rates`, `convert`;
   - one `tools/call` per tool, plus `get_rate` with `currency=XXX` for the error path.
3. Optionally `docker build` and `docker run -p 8787:8787` and repeat step 2.

## 8. Acceptance criteria

- `tools/list` returns exactly `get_rate`, `list_rates`, `convert`.
- `convert` 100 EUR → USD on 2026-10-22 returns about 112.29 (50.5601 / 45.0256 × 100).
- `get_rate` for `XXX` returns an MCP tool error, not a crash.
- Dates later than tomorrow (Kyiv) are rejected with a readable error.
- `npm run check` passes locally and in CI.
- README, AGENTS.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, CHANGELOG.md, LICENSE all
  present and project-specific.
