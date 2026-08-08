# ibge-br-mcp — Cloudflare Worker (HTTP transport)

Serves the same MCP server as the npm package, but over **Streamable HTTP** so
it can be reached at a URL (e.g. `https://ibge.sidneybissoli.com/mcp`) by
web/hosted MCP clients — instead of locally over STDIO.

It reuses the package's tool/resource/prompt registrations verbatim via
`registerAll` (from `../src/server.ts`), so the HTTP and STDIO transports always
expose exactly the same 22 tools. The MCP handler is **stateless**
(`createMcpHandler` builds a fresh server per request — MCP SDK v2 + `agents`);
cross-request state lives only in the `UsageTracker` Durable Object (SQLite),
which keeps privacy-preserving usage statistics: event kind, tool/route name,
and daily counts — never tool arguments, results, or user data.

## Endpoints

| Path | Purpose |
|------|---------|
| `/mcp` | MCP Streamable HTTP endpoint (point your client here) |
| `/` | Landing page (service identification + contact) |
| `/health` | Liveness probe |
| `/status` | Version + metadata of the current deploy |
| `/metrics` | Aggregated usage statistics (last 30 days) |
| `/.well-known/mcp/server-card.json` | Static MCP server card for registry scanners |
| `/.well-known/glama.json` | Glama connector descriptor |

Requests to `/mcp` pass an optional Bearer auth check and a per-IP token-bucket
rate limit (burst 20, refill 5/s — see `src/config.ts`).

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
`ibge.sidneybissoli.com` is declared in `wrangler.jsonc` (`routes`) and also
listed in `SERVER_CONFIG.extraAllowedHostnames` (`src/config.ts`) — the MCP
handler validates the Host header against that list. The `UsageTracker` Durable
Object is provisioned automatically by the `migrations` block on first deploy.

## Local dev

```bash
npx wrangler dev
# MCP endpoint at http://localhost:8787/mcp
```

## Tests

```bash
npm test          # vitest: auth, rate limit, usage aggregation, status, server surface
npm run typecheck
```

## Optional: lock it down

By default `/mcp` is open (the data is public, read-only). To require a token:

```bash
npx wrangler secret put API_KEY
```

Clients then send `Authorization: Bearer <API_KEY>`. Set `ALLOWED_ORIGIN` in
`wrangler.jsonc` to restrict CORS.

## Notes

- This directory is **not** published to npm (the package ships only `dist/`).
- Keep `version` in `../package.json` / `SERVER_VERSION` as the single source of
  truth — the Worker reads `SERVER_VERSION` from the built package.
- `@modelcontextprotocol/server` and `zod` are deliberately not dependencies
  here: they resolve from the parent package's `node_modules` (single SDK copy).
  `worker/.npmrc` pins `legacy-peer-deps=true` so npm does not install a second
  copy to satisfy `agents`' peer ranges.
- Layout mirrors `mcp-br-commons/templates/cloudflare-worker` (Fase 0 hosting
  template); `src/server.ts` and `src/card.ts` are the ibge-specific parts.
