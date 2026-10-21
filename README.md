# nbu-rates-mcp

[![CI](https://github.com/romanmoravskyi/nbu-rates-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/romanmoravskyi/nbu-rates-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 22](https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-6E56CF)](https://modelcontextprotocol.io/)

**Official National Bank of Ukraine exchange rates, inside Claude.** `nbu-rates-mcp` is a tiny,
no-auth, self-hosted [MCP](https://modelcontextprotocol.io/) server written in plain Node.js and
TypeScript. It lets Claude look up the official UAH rate for any date, list all rates, and convert
between currencies using the NBU numbers that accountants and the tax office use, not a random
market quote. Run it locally with one command, or put it on any Node host or container.

```
http://localhost:8787/mcp
```

## Demo

> **You:** What was the official NBU euro rate on 22 October 2026, and how much is 100 EUR in dollars at that rate?
>
> **Claude** *(calls `get_rate`, then `convert`)*: On 2026-10-22 the NBU rate was **1 EUR = 50.5601 UAH**.
> Crossing via UAH with the USD rate of 45.0256, **100 EUR = 112.29 USD** (rate 1.122919).

## Run locally

Requires Node 22+.

```bash
npm ci
npm start            # builds to dist/ and serves http://localhost:8787, MCP endpoint /mcp
npm run dev          # same, from source with tsx watch (reloads on save)
```

Keep it running while you use it from Claude. `GET http://localhost:8787/health` returns `{"ok":true}`.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | TCP port to listen on |
| `HOST` | `127.0.0.1` | Interface to bind. Use `0.0.0.0` in containers (the Docker image does) |
| `ALLOWED_HOSTS` | *(empty)* | Extra comma-separated hostnames accepted in `Host`/`Origin` on `/mcp`, e.g. `nbu.example.com`. `localhost`, `127.0.0.1` and `[::1]` are always allowed; `*` disables the check |

## Add to Claude

### Claude Code (stdio, recommended locally)

Claude Code launches the process itself per session; no server to keep running.

```bash
npm ci && npm run build
claude mcp add -s user nbu-rates -- node /path/to/nbu-rates-mcp/dist/index.js --stdio
```

After a code change: `npm run build`. Nothing to re-register.

Point MCP clients at `node dist/index.js --stdio` directly, not at `npm run start:stdio`. In stdio
mode stdout is the JSON-RPC channel, and `npm run` first prints its `> nbu-rates-mcp@… start:stdio`
banner there, which strict clients reject. `npm run start:stdio` also rebuilds `dist/` first, so
it is only for trying the server by hand.

### Claude Code (HTTP, for a server that is already running)

```bash
claude mcp add --transport http nbu-rates http://localhost:8787/mcp
```

### Claude Desktop (local MCP config)

Claude Desktop's config file launches local commands, so point it at the stdio entry (build first
with `npm run build`). In **Settings → Developer → Edit Config** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "nbu-rates": {
      "command": "node",
      "args": ["/path/to/nbu-rates-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

### claude.ai custom connector (web and mobile): needs a public HTTPS URL

claude.ai connects to connectors from Anthropic's cloud, so it cannot reach `localhost`. Once you
host the server somewhere (see [Hosting](#hosting)) behind HTTPS, add `https://<your-host>/mcp`
under **Settings → Connectors → Add custom connector**.

Step-by-step guide and troubleshooting: [docs/CONNECTOR_SETUP.md](docs/CONNECTOR_SETUP.md).

## Tools

| Tool | Input | Output | Example arguments |
|---|---|---|---|
| `get_rate` | `currency` (ISO 4217, any case), `date?` (`YYYY-MM-DD`) | `{ currency, rate_uah, date, name_uk }` | `{ "currency": "usd" }` |
| `list_rates` | `date?`, `currencies?` (array of codes) | `{ date, rates: [{ currency, rate_uah, name_uk }] }` sorted by code | `{ "currencies": ["USD", "EUR"] }` |
| `convert` | `amount`, `from`, `to` (UAH allowed), `date?` | `{ amount, from, to, result, rate_used, date }` | `{ "amount": 100, "from": "EUR", "to": "USD" }` |

- `rate_uah` is UAH per **1** unit of the currency. `name_uk` is the NBU's Ukrainian name.
- `convert` crosses via UAH: `result = amount × rate(from) / rate(to)`, rounded to 2 decimals; `rate_used` keeps 6.
- `date` defaults to today in Kyiv. Tomorrow is accepted (NBU publishes next-day rates after about 15:30 Kyiv time); later dates are rejected.
- Every result carries a one-line summary, the JSON as text, and `structuredContent`.
- Unknown currencies, bad dates and upstream outages come back as MCP tool errors (`isError: true`) with a readable message, never a crash.

Other endpoints: `GET /` (plain-text info page) and `GET /health` (`{"ok":true}`).

## Development

```bash
npm run check        # typecheck + biome + vitest (mocked NBU, no network)
npm run build        # tsc to dist/
npm start            # then, in another terminal:
npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp --method tools/list
npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp --method tools/call \
  --tool-name convert --tool-arg amount=100 --tool-arg from=EUR --tool-arg to=USD
```

## Hosting

It is a single stateless Node process with no database, so it runs on any Node host or container
(Docker, Fly.io, Railway, a VPS). Put it behind a reverse proxy or platform that terminates HTTPS,
and set `ALLOWED_HOSTS` to the public hostname.

### Docker

```bash
docker build -t nbu-rates-mcp .
docker run --rm -p 8787:8787 nbu-rates-mcp
# behind a public hostname:
docker run -d --restart unless-stopped -p 8787:8787 -e ALLOWED_HOSTS=nbu.example.com nbu-rates-mcp
```

The image is a multi-stage `node:22-alpine` build that ships only `dist/` and production
dependencies, runs as the non-root `node` user and has a `/health` healthcheck.

### Plain Node (VPS or any Node platform)

```bash
npm ci && npm run build
HOST=0.0.0.0 PORT=8787 ALLOWED_HOSTS=nbu.example.com node dist/index.js
```

Most platforms set `PORT` for you; set `HOST=0.0.0.0` so the process accepts outside traffic.

## Caching and rate limits

- Upstream responses are kept in a small in-memory TTL cache: **1 hour** for today and tomorrow,
  **24 hours** for past dates.
- One upstream request per date covers every currency, so all three tools share the same cache entry.
- Empty answers (tomorrow before NBU publishes) are never cached.
- The cache lives in the process: it is empty after a restart and not shared between replicas.
  It holds at most 1000 dates.
- No rate limiting of our own. Please be gentle with the public NBU API.

## Architecture

```
Claude --Streamable HTTP--> node:http /mcp --> McpServer + StreamableHTTPServerTransport (stateless, per request)
                                                 '--> tools.ts --> nbu.ts --TtlCache--> bank.gov.ua
```

Why `node:http` and a stateless transport: [docs/ADR-001-transport.md](docs/ADR-001-transport.md).

## Data source and attribution

Exchange rates come from the National Bank of Ukraine open data API
(`https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange`), see
[bank.gov.ua open data](https://bank.gov.ua/ua/open-data/api-dev). This project is not affiliated
with or endorsed by the NBU. Data is provided as-is; check bank.gov.ua for anything legally binding.

## Contributing

Issues and PRs are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md) (for AI
coding agents) and the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues: [SECURITY.md](SECURITY.md).
Release notes: [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 Roman Moravskyi
