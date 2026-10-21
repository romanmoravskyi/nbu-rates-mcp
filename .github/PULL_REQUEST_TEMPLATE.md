## What and why

<!-- One or two sentences. Link the issue: Closes #123 -->

## Type

- [ ] fix
- [ ] feat (backward compatible)
- [ ] breaking change to a tool name, input or output
- [ ] docs / ci / chore

## Checklist

- [ ] `npm run check` passes locally
- [ ] Tests added or updated (no real NBU calls)
- [ ] Verified with MCP Inspector against `npm start` or `npm run dev` (paste the relevant output below)
- [ ] `CHANGELOG.md` updated under `Unreleased` for user-visible changes
- [ ] No secrets, tokens or `.env` files committed

## Verification

```
<!-- e.g. npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp --method tools/call ... -->
```
