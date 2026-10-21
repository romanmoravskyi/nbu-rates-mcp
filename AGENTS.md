# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor and friends) working in this repository.
Humans may find it useful too; the contributor guide is [CONTRIBUTING.md](CONTRIBUTING.md).

## What this is

A stateless, self-hosted MCP server in plain Node.js 22 and TypeScript. It exposes three read-only
tools (`get_rate`, `list_rates`, `convert`) backed by the public NBU exchange-rate API. No auth, no
storage, no user data. The only state is an in-memory TTL cache of upstream responses.

## Commands

| Command | What it does |
|---|---|
| `npm ci` | Install exact dependencies from `package-lock.json` |
| `npm run dev` | `tsx watch src/index.ts`: MCP at http://localhost:8787/mcp, reloads on save |
| `npm start` | Build to `dist/`, then `node dist/index.js` on port 8787 (`PORT` overrides) |
| `npm run build` | `tsc -p tsconfig.build.json` to `dist/` |
| `npm run check` | `tsc` (src and test) + `biome check` + `vitest run`. Must pass before every commit |
| `npm run format` | Apply Biome formatting and safe fixes |
| `docker build -t nbu-rates-mcp .` | Build the container image (see `Dockerfile`) |

## Layout

```
src/index.ts      process entry: reads PORT/HOST/ALLOWED_HOSTS, listens, handles SIGINT/SIGTERM
src/server.ts     node:http routing for /, /health, /mcp; Host/Origin check; McpServer per request
src/tools.ts      zod input schemas, tool handlers, MCP result/error shaping, registerTools()
src/nbu.ts        NBU client: URL building, TTLs, timeouts, payload parsing, error types
src/cache.ts      tiny in-memory TTL cache with a size cap
src/validate.ts   currency/date validation, Kyiv "today", rounding helpers
test/             plain vitest, mocked upstream (injected fetch or vi.stubGlobal)
docs/             ADR, connector setup guide, implementation plan
Dockerfile        multi-stage node:22-alpine image
```

## Conventions

- TypeScript strict mode, ESM with `nodenext` resolution: relative imports end in `.js`.
- Format and lint with Biome only (no Prettier/ESLint).
- Keep each source file under about 150 lines; split by responsibility if one grows.
- `src/index.ts` is the only module with side effects (it starts listening). Tests import
  `src/server.ts` and call `createApp()`.
- Tool handlers throw `UserError` (bad input, unknown currency, no data yet) or `UpstreamError`
  (NBU down or malformed). `runTool` turns both into `isError: true` results. Never let a tool throw.
- Tests never hit the real NBU API. Inject a fake `fetch` into `NbuClient`, or `vi.stubGlobal("fetch", ...)`
  for end-to-end tests through the HTTP server (forward requests to the test server to the real fetch).
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`,
  `test:`, `chore:`, `ci:`, `build:`, `refactor:`.

## Do not

- Commit secrets, `.env` files, API tokens or credentials.
- Rename or remove tools, input fields or output fields. They are a public API used by saved
  connectors; add optional fields instead, or bump the major version and say so in the CHANGELOG.
- Add authentication, persistent storage or server sessions without a new ADR in `docs/`.
- Add a hosting-provider-specific dependency or config; the server must stay runnable on any Node host.
- Skip updating `CHANGELOG.md` (under `Unreleased`) for user-visible changes.
- Deploy anywhere or push from an agent session unless the maintainer asked for it.

## Verify a change end to end

1. `npm run check`
2. `npm start` (keep it running), then in another shell:

```bash
npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp --method tools/list
npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp --method tools/call \
  --tool-name get_rate --tool-arg currency=USD
npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp --method tools/call \
  --tool-name list_rates --tool-arg 'currencies=["USD","EUR"]'
npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp --method tools/call \
  --tool-name convert --tool-arg amount=100 --tool-arg from=EUR --tool-arg to=USD
```

3. Check that `tools/list` returns exactly the three tools and that `get_rate` with
   `currency=XXX` returns `isError: true` with a readable message.
4. For a UI check, run `npx @modelcontextprotocol/inspector` without `--cli` and connect to
   `http://localhost:8787/mcp` with transport "Streamable HTTP".
