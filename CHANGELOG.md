# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Tool names, input fields and
output fields are the public API: removing or renaming any of them is a breaking change.

## [Unreleased]

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
