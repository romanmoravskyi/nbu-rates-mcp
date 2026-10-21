# Connector setup

Start the server locally:

```bash
npm ci
npm start
```

or with Docker:

```bash
docker build -t nbu-rates-mcp .
docker run --rm -p 8787:8787 nbu-rates-mcp
```

The MCP endpoint is then:

```
http://localhost:8787/mcp
```

Transport: Streamable HTTP. Authentication: none. Keep the server running while Claude uses it.

> A claude.ai custom connector (web, mobile, and connectors synced to Desktop) is called from
> Anthropic's cloud and needs a **public HTTPS URL**; it cannot reach `localhost`. Until you host
> the server somewhere, use Claude Code or Claude Desktop's local MCP config below.

## Claude Code

```bash
claude mcp add --transport http nbu-rates http://localhost:8787/mcp
```

Add `--scope user` to make it available in every project, or `--scope project` to write it to
`.mcp.json` for your team. Then check it:

```bash
claude mcp list          # nbu-rates should show as connected while the server is running
```

Inside a session, `/mcp` lists the server and its three tools.

## Claude Desktop (local MCP config)

Claude Desktop's `claude_desktop_config.json` starts local processes, so use
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) as a bridge to the HTTP endpoint.

1. Open Claude Desktop → **Settings → Developer → Edit Config**.
2. Add:

```json
{
  "mcpServers": {
    "nbu-rates": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:8787/mcp"]
    }
  }
}
```

3. Restart Claude Desktop. The tools menu should list `get_rate`, `list_rates` and `convert`.
4. Try: *"What is the official NBU USD rate today?"*

## Verify from a terminal

```bash
curl http://localhost:8787/health   # {"ok":true}
npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp --method tools/list
npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp \
  --method tools/call --tool-name get_rate --tool-arg currency=EUR
```

## Hosted instance and claude.ai

1. Run the server on any Node host or container (Docker, Fly.io, Railway, a VPS); see
   [Hosting in the README](../README.md#hosting). Terminate HTTPS in front of it (the platform's
   TLS, or a reverse proxy such as Caddy or nginx) and set `ALLOWED_HOSTS` to your public
   hostname, for example `ALLOWED_HOSTS=nbu.example.com`.
2. Check `https://nbu.example.com/health` returns `{"ok":true}`.
3. On [claude.ai](https://claude.ai): **Settings → Connectors → Add custom connector**, name
   `NBU rates`, URL `https://nbu.example.com/mcp`, leave OAuth empty.
4. Point Claude Code at the same URL:
   `claude mcp add --transport http nbu-rates https://nbu.example.com/mcp`.

On Team and Enterprise plans an owner may need to add the connector for the organization first.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Claude cannot connect | Is the server running? Does `http://localhost:8787/health` return `{"ok":true}`? Is the URL ending in `/mcp`? |
| Port 8787 in use | Stop the other process, or start with another port (`PORT=8788 npm start`) and use that port in the URL. |
| Tool error "not published yet" | You asked for tomorrow before NBU set the rates (about 15:30 Kyiv time). |
| Tool error "does not publish an official rate" | NBU does not quote that currency. Call `list_rates` to see the list. |
| HTTP 403 "Host or Origin not allowed" | Use `localhost` or `127.0.0.1`, or add your hostname to `ALLOWED_HOSTS`; see ADR-001. |
| Works locally but not from another machine | The server binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` (the Docker image already does). |
