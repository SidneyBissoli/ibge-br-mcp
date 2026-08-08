/**
 * Landing page na raiz — pública. A URL raiz do Worker aparece no User-Agent das
 * chamadas upstream do portfólio, então precisa resolver para algo legível por
 * humanos: identificação do serviço + contato (sysadmins upstream chegam por aqui).
 */

import { SERVER_CONFIG } from "./config.js";

export function landingHtml(): string {
  const c = SERVER_CONFIG;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${c.title}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.6; }
  code { background: #eee; padding: 0.1rem 0.35rem; border-radius: 4px; }
  @media (prefers-color-scheme: dark) { body { background: #111; color: #ddd; } code { background: #333; } }
</style>
</head>
<body>
<h1>${c.title}</h1>
<p>${c.description}</p>
<p>Servidor <a href="https://modelcontextprotocol.io">MCP</a> (Streamable HTTP). Endpoints:</p>
<ul>
  <li><code>${c.mcpRoute}</code> — endpoint MCP</li>
  <li><code>/health</code> — liveness</li>
  <li><code>/status</code> — versão e build corrente</li>
  <li><code>/metrics</code> — estatísticas de uso agregadas</li>
</ul>
<p>Contato: <a href="mailto:${c.contactEmail}">${c.contactEmail}</a></p>
</body>
</html>`;
}

export function landingResponse(): Response {
  return new Response(landingHtml(), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
