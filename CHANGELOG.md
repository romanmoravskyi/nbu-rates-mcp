# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Tool names, input fields and
output fields are the public API: removing or renaming any of them is a breaking change.

## [Unreleased]

### Added

- stdio transport: `node dist/index.js --stdio` (or `MCP_TRANSPORT=stdio`) for clients that
  launch the server themselves, such as Claude Code and Claude Desktop. Logs go to stderr. The
  HTTP server stays the default. Clients should spawn `node dist/index.js --stdio` directly (after
  `npm run build`): `npm run` prints a banner to stdout, which corrupts the protocol stream, so
  `npm run start:stdio` is only for trying the server by hand (README and connector guide).

### Fixed

- `npm run start:stdio` now builds `dist/` first (`prestart:stdio`, output to stderr), so it works
  on a fresh clone instead of failing with `Cannot find module dist/index.js`.

### Fixed

- Requests without a `date` no longer return the previous day's rates for up to an hour after
  Kyiv midnight: "today" is now resolved to the Kyiv date before the NBU lookup and cached under
  that date (#5).
- A timeout or connection reset while reading the NBU response body is now reported as an NBU
  upstream error instead of "Unexpected error" (#10).
- An empty NBU answer for a past date now says NBU has no rates for that date, instead of
  claiming the rates are not published yet (#16).

### Changed

- `convert` output precision: `result` is still rounded to 2 decimals and `rate_used` to 6 when
  the value is 1 or more, but values below 1 now keep at least 4 (`result`) or 6 (`rate_used`)
  significant digits instead of collapsing to 0. For example, 100 UAH to XAU now gives
  `result: 0.0005882` instead of `0`. Field names and types are unchanged (both are numbers).
- `get_rate` and `list_rates` treat UAH like `convert` does: as the base currency with
  `rate_uah: 1`. `get_rate {currency: "UAH"}` returns that instead of an error, and
  `list_rates` includes a UAH row when UAH is named in `currencies` (the unfiltered list is
  unchanged). Neither needs NBU to be reachable for UAH alone. The `get_rate` summary for UAH
  says "base currency, not an NBU quote".
- `convert` input validation is stricter: a negative `amount` is now rejected with a validation
  error. It used to return a negative `result`. The field name and type are unchanged.

### Fixed

- `list_rates` with `currencies: []` returns all rates instead of none.
- `convert` UAH to UAH no longer fails when NBU is down or has not published rates for the date.
- Today's Kyiv date is built from date parts instead of relying on the `en-CA` locale pattern,
  and falls back to the legacy `Europe/Kiev` zone name on runtimes with older tzdata.

## [0.1.0] - 2026-10-21

### Added

- Self-hosted MCP server in plain Node.js 22 and TypeScript, built on the official MCP TypeScript
  SDK: stateless Streamable HTTP at `/mcp`, no authentication.
- `get_rate` tool: official NBU rate (UAH per 1 unit) for one currency and an optional date.
- `list_rates` tool: all NBU rates for a date, sorted by code, with an optional currency filter.
- `convert` tool: convert between any two currencies (UAH allowed) by crossing via UAH.
- Validation of ISO 4217 codes and `YYYY-MM-DD` dates (up to tomorrow, Kyiv time) with readable errors.
- In-memory TTL cache in front of the NBU API: 1 hour for today and tomorrow, 24 hours for past
  dates, empty answers never cached.
- `GET /` info page and `GET /health` endpoint.
- `PORT` (default 8787), `HOST` and `ALLOWED_HOSTS` environment variables; Host/Origin checks on
  `/mcp` against DNS rebinding.
- `npm start`, `npm run dev` (tsx watch) and `npm run build` (tsc to `dist/`).
- Multi-stage `node:22-alpine` Dockerfile.
- Vitest suite with a mocked upstream; CI and Dependabot configuration.

[Unreleased]: https://github.com/romanmoravskyi/nbu-rates-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/romanmoravskyi/nbu-rates-mcp/releases/tag/v0.1.0
