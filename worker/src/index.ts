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
import { createUsageRecorder, usageSnapshot, UsageTracker } from "./usage.js";

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

    const response = await handler(request, env, ctx);
    logger.info("request", {
      method: request.method,
      path: url.pathname,
      status: response.status,
      ms: Date.now() - start,
    });
    return response;
  },
} satisfies ExportedHandler<Env>;
