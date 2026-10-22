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
| `NBU_MCP_HOST` | `127.0.0.1` | Interface to bind. Use `0.0.0.0` in containers (the Docker image does). Wins over `HOST` |
| `HOST` | `127.0.0.1` | Fallback for `NBU_MCP_HOST`. Ignored, with a note on stderr, when it is just this machine's hostname (tcsh and some shells export that); set `NBU_MCP_HOST` to bind that name |
| `ALLOWED_HOSTS` | *(empty)* | Extra comma-separated hostnames accepted in `Host`/`Origin` on `/mcp`, e.g. `nbu.example.com`. `localhost`, `127.0.0.1` and `[::1]` are always allowed; `*` disables the check |

The server has no authentication, so when it is bound to anything other than a loopback address
(`127.0.0.0/8`, `::1`, `localhost`), including `0.0.0.0` in the Docker image, it prints a warning
on stderr at startup.

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
and set `ALLOWED_HOSTS` to the public hostname. A reverse proxy must pass the original `Host`
header; see [Behind a reverse proxy](#behind-a-reverse-proxy).

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
NBU_MCP_HOST=0.0.0.0 PORT=8787 ALLOWED_HOSTS=nbu.example.com node dist/index.js
```

Most platforms set `PORT` for you; set `NBU_MCP_HOST=0.0.0.0` (or `HOST=0.0.0.0`) so the process
accepts outside traffic.

### Behind a reverse proxy

The server reads the `Host` header for two things: the `/mcp` Host check (`ALLOWED_HOSTS`) and
the URL shown on `GET /`. `X-Forwarded-Host` is ignored, so the proxy must pass the original
`Host` header, and it should set `X-Forwarded-Proto` so the home page shows `https://`. A proxy
that rewrites `Host` to its upstream address (`127.0.0.1:8787`, or a container name such as
`app:8787`) makes `GET /` advertise that internal URL, and with a named upstream every `/mcp`
request fails with 403 "Host or Origin not allowed", even with `ALLOWED_HOSTS` set to the public
name.

nginx (rewrites `Host` to the `proxy_pass` address unless told otherwise):

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;  # $host drops the port; use $http_host on a non-default port
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;  # /mcp answers with text/event-stream
}
```

Apache, in the HTTPS (`:443`) virtual host (`ProxyPreserveHost` is `Off` by default;
`RequestHeader` needs `mod_headers`):

```apache
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "https"
ProxyPass        / http://127.0.0.1:8787/
ProxyPassReverse / http://127.0.0.1:8787/
```

Caddy's `reverse_proxy` to an `http://` upstream passes `Host` unchanged and sets
`X-Forwarded-Proto` by default, and Traefik passes `Host` by default (`passHostHeader: true`).

`ALLOWED_HOSTS` must list the hostname the server actually receives in `Host`. When the proxy
preserves `Host`, that is your public hostname (`ALLOWED_HOSTS=nbu.example.com`); you do not need
to add the upstream name. Browser clients that send an `Origin` need that hostname listed too.
If the proxy rewrites `Host` to `127.0.0.1`, requests pass the Host check (loopback is always
allowed), so the DNS-rebinding check can no longer tell proxied requests from local ones (only a
browser `Origin` is still checked), and `GET /` shows the internal URL. Prefer preserving `Host`.

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
