/**
 * Entrypoint do Worker — instância do template de hosting da Fase 0.
 *
 * Fluxo por request: rotas públicas (landing, /health, /status, /metrics,
 * server card, glama) → Bearer auth opcional → rate limit por cliente →
 * createMcpHandler (stateless, factory cria um McpServer novo por request —
 * MCP SDK v2 + agents 0.20+).
 */

import { createMcpHandler } from "agents/mcp/server";

import { tagRequest, withAnalytics } from "./analytics.js";
import { checkAuth } from "./auth.js";
import { getServerCard } from "./card.js";
import { SERVER_CONFIG } from "./config.js";
import { landingResponse } from "./landing.js";
import { logger } from "./logger.js";
import { checkRateLimit } from "./rate-limit.js";
import { buildServer } from "./server.js";
import { buildStatus } from "./status.js";
import type { Env } from "./types.js";
import { ICON_PNG_BASE64 } from "./icon.js";
import { createUsageRecorder, usageSnapshot, UsageTracker } from "./usage.js";
import { unknownCursorError } from "../../dist/pagination.js";

// Decodificado uma vez por isolate, nao por request.
const ICON_PNG = Uint8Array.from(atob(ICON_PNG_BASE64), (c) => c.charCodeAt(0));

// O runtime instancia o Durable Object a partir do export do entrypoint.
export { UsageTracker };

function json(data: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const start = Date.now();
    const record = createUsageRecorder(env, ctx);

    // --- Rotas públicas, servidas antes de qualquer auth ---
    if (url.pathname === "/") return landingResponse();
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    if (url.pathname === "/status") {
      return json(buildStatus(env), { "Cache-Control": "no-store" });
    }
    // Icone do servidor — publico: e o que server.json declara e o que os
    // diretorios buscam. Mesmo host do servidor, como o schema do MCP recomenda.
    if (url.pathname === "/icon.png") {
      return new Response(ICON_PNG, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
    if (url.pathname === "/metrics") {
      const snap = await usageSnapshot(env);
      return json(snap ?? { aviso: "binding USAGE ausente — estatísticas de uso desativadas" });
    }

    // MCP server card para scanners de registry que o leem em vez do /mcp.
    if (url.pathname === "/.well-known/mcp/server-card.json") {
      try {
        return new Response(await getServerCard(), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        logger.error("server-card generation failed", { err: String(err) });
        return new Response(JSON.stringify({ error: "server card unavailable" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Descritor de conector do Glama (descoberta de registry).
    if (url.pathname === "/.well-known/glama.json") {
      return json({
        $schema: "https://glama.ai/mcp/schemas/connector.json",
        maintainers: [{ email: SERVER_CONFIG.contactEmail }],
      });
    }

    // Preflight CORS nunca carrega Authorization — o handler MCP responde o OPTIONS.
    if (request.method !== "OPTIONS") {
      const authResponse = await checkAuth(request, env.API_KEY);
      if (authResponse) {
        record("auth_failure", url.pathname);
        logger.warn("auth_failure", {
          method: request.method,
          path: url.pathname,
          status: authResponse.status,
        });
        return authResponse;
      }

      const clientId = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const decision = checkRateLimit(clientId);
      if (!decision.allowed) {
        record("rate_limited", url.pathname);
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": String(decision.retryAfterS), "Content-Type": "text/plain" },
        });
      }
    }

    record("request", url.pathname);

    // Contexto da requisição (país/AS/marcador self) + escrita no Analytics
    // Engine pegando carona no hook de uso — ver src/analytics.ts.
    const recordWithAnalytics = withAnalytics(record, env.ANALYTICS, tagRequest(request, env.SELF_MARKER));

    // Cópia do corpo tirada ANTES do handler consumir o stream — é dela que o
    // guarda de cursor abaixo decide. Só para o POST do endpoint MCP; corpo que
    // não é JSON não é assunto daqui.
    const corpoMcp =
      request.method === "POST" && url.pathname === SERVER_CONFIG.mcpRoute
        ? await request
            .clone()
            .json()
            .catch(() => undefined)
        : undefined;

    const handler = createMcpHandler(() => buildServer(recordWithAnalytics), {
      route: SERVER_CONFIG.mcpRoute,
      // Sem a opção, o handler aceita localhost e *.workers.dev. Ao definir
      // extraAllowedHostnames (domínio próprio), a lista SUBSTITUI os defaults —
      // por isso config.ts inclui nela também o hostname workers.dev.
      ...(SERVER_CONFIG.extraAllowedHostnames.length
        ? { allowedHostnames: [...SERVER_CONFIG.extraAllowedHostnames] }
        : {}),
      corsOptions: {
        origin: env.ALLOWED_ORIGIN || "*",
        methods: "GET, POST, DELETE, OPTIONS",
        headers: "Content-Type, Accept, mcp-session-id, MCP-Protocol-Version, Authorization",
        maxAge: 86400,
      },
    });

    // Cursor de paginação inválido -> JSON-RPC -32602 (ver ../../src/pagination.ts).
    //
    // POR QUE DEPOIS DO HANDLER. Quem valida `Host` e `Origin` é o próprio
    // `createMcpHandler`; um guarda colocado antes responderia -32602 a uma
    // requisição que a checagem de segurança ia recusar com 403 — recusa de
    // protocolo passando à frente da recusa de segurança. Rodando depois, só
    // substituímos uma resposta que já passou por Host, Origin, auth e rate
    // limit.
    const doHandler = await handler(request, env, ctx);
    const recusaDeCursor =
      doHandler.status === 200 && corpoMcp !== undefined ? unknownCursorError(corpoMcp) : undefined;

    let response = doHandler;
    if (recusaDeCursor) {
      record("invalid_cursor", url.pathname);
      // A lista que o handler acabou de montar não vai ser usada; sem cancelar,
      // o corpo fica pendurado.
      void doHandler.body?.cancel();
      // 200 com erro JSON-RPC no corpo: a falha é de protocolo, não de HTTP — é
      // assim que o cliente MCP lê o código -32602. O CORS é o que o handler já
      // resolveu para esta requisição.
      const corsOrigin = doHandler.headers.get("Access-Control-Allow-Origin");
      response = new Response(JSON.stringify(recusaDeCursor), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...(corsOrigin ? { "Access-Control-Allow-Origin": corsOrigin } : {}),
        },
      });
    }

    logger.info("request", {
      method: request.method,
      path: url.pathname,
      status: response.status,
      ms: Date.now() - start,
    });
    return response;
  },
} satisfies ExportedHandler<Env>;
