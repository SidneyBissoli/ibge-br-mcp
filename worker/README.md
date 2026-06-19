# ibge-br-mcp — Cloudflare Worker (HTTP transport)

Serves the same MCP server as the npm package, but over **Streamable HTTP** so
it can be reached at a URL (e.g. `https://ibge.sidneybissoli.com/mcp`) by
web/hosted MCP clients — instead of locally over STDIO.

It reuses the package's tool/resource/prompt registrations verbatim via
`registerAll` (from `../src/server.ts`), so the HTTP and STDIO transports always
expose exactly the same 22 tools. The handler is **stateless** (a fresh server
per request, no Durable Object), which fits this read-only, public-data server.

## Endpoints

| Path | Purpose |
|------|---------|
| `/mcp` | MCP Streamable HTTP endpoint (point your client here) |
| `/health` | Liveness probe |
| `/.well-known/glama.json` | Glama connector descriptor |

## Status

**Live in production** at `https://ibge.sidneybissoli.com/mcp` (custom domain,
DNS + TLS provisioned) and at `https://ibge-br-mcp.sidneybissoli.workers.dev`.

## Deploy / redeploy

```bash
# 1. Build the parent package (produces ../dist, which this Worker imports).
cd ..
npm install
npm run build

# 2. Install and deploy the Worker.
cd worker
npm install
npx wrangler deploy
```

Run the same steps to redeploy after a code change. The custom domain
`ibge.sidneybissoli.com` is already attached, so no further DNS setup is needed.
To re-add it from scratch (e.g. on a fresh account): in the dashboard, **Workers
& Pages → ibge-br-mcp → Settings → Domains & Routes → Add Custom Domain →
`ibge.sidneybissoli.com`** (Cloudflare provisions DNS + TLS automatically), or
uncomment the `[[routes]]` block in `wrangler.toml`.

## Local dev

```bash
npx wrangler dev
# MCP endpoint at http://localhost:8787/mcp
```

## Optional: lock it down

By default `/mcp` is open (the data is public, read-only). To require a token:

```bash
npx wrangler secret put API_KEY
```

Clients then send `Authorization: Bearer <API_KEY>`. Set `ALLOWED_ORIGIN` in
`wrangler.toml` to restrict CORS.

## Notes

- This directory is **not** published to npm (the package ships only `dist/`).
- Keep `version` in `../package.json` / `SERVER_VERSION` as the single source of
  truth — the Worker reads `SERVER_VERSION` from the built package.
