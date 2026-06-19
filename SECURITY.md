# Security Policy

## Security model

`ibge-br-mcp` is a **read-only** MCP server. Every one of its tools is a pure
`GET` against a **public** official IBGE REST API. The server:

- never writes, mutates, or deletes any remote state;
- requires **no credentials, API keys, or secrets** to operate;
- handles **no personal or sensitive data** — only public, aggregate statistics
  published by IBGE;
- keeps no persistent state beyond an in-memory response cache;
- logs only to `stderr` (never to `stdout`, which is the MCP protocol channel).

All tools are annotated `readOnlyHint: true` / `destructiveHint: false` /
`idempotentHint: true` so MCP clients can treat them as safe.

The optional Cloudflare Worker (HTTP transport) is stateless (a fresh server per
request, no Durable Object) and exposes the same read-only surface. By default
`/mcp` is open because the data is public; an optional `API_KEY` enables
`Authorization: Bearer` enforcement.

## Supported versions

Only the latest published version on npm receives security updates.

| Version | Supported |
| ------- | --------- |
| 2.x     | ✅        |
| < 2.0   | ❌        |

## Reporting a vulnerability

If you discover a security issue, please **do not open a public issue**.
Instead, report it privately via one of:

- GitHub's [private vulnerability reporting](https://github.com/SidneyBissoli/ibge-br-mcp/security/advisories/new)
  ("Report a vulnerability" under the repository's **Security** tab), or
- email **sbissoli76@gmail.com** with the subject `SECURITY: ibge-br-mcp`.

Please include steps to reproduce and the affected version. You can expect an
acknowledgement within 7 days. Once a fix is released, the advisory will be
published with credit to the reporter (unless anonymity is requested).
