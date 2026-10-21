# Security Policy

## Supported versions

Only the latest release on `main` receives fixes. The project is self-hosted; there is no official
hosted instance.

## Scope

This server has no authentication, stores no user data and only reads public NBU data. Relevant
reports include, for example:

- ways to make the server call hosts other than `bank.gov.ua`, or to poison the in-memory cache;
- input that crashes the process or bypasses validation;
- MCP protocol issues such as DNS rebinding or Host/Origin validation gaps on `/mcp`;
- vulnerable dependencies that are reachable at runtime;
- leaked secrets in the repository or CI configuration.

Out of scope: wrong or delayed rates published by the NBU itself, and volumetric denial of service
against an individual deployment (put a rate-limiting reverse proxy in front of a public instance).

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private
[security advisory form](https://github.com/romanmoravskyi/nbu-rates-mcp/security/advisories/new)
with steps to reproduce and the impact you see.

You can expect an acknowledgement within 7 days and a fix or mitigation plan within 30 days for
confirmed issues. Reporters are credited in the advisory and CHANGELOG unless they prefer otherwise.
