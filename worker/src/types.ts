import type { UsageTracker } from "./usage.js";

export interface Env {
  /** Bearer auth opcional (`wrangler secret put API_KEY`). Ausente = acesso aberto. */
  API_KEY?: string;
  /** Origin permitida no CORS do endpoint MCP. Default "*" (wrangler.jsonc). */
  ALLOWED_ORIGIN?: string;
  /**
   * Durable Object de estatísticas de uso. Opcional para que testes e dev local rodem
   * sem o binding: sem ele, nada é registrado e /metrics responde com aviso.
   */
  USAGE?: DurableObjectNamespace<UsageTracker>;
  /**
   * Binding version_metadata (id/tag/timestamp do deploy). Opcional: GET /status
   * omite o bloco deploy quando ausente (dev local / testes).
   */
  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
  /**
   * Telemetria de tool calls no Analytics Engine (src/analytics.ts). Opcional:
   * sem o binding (dev local / testes), nada é gravado.
   */
  ANALYTICS?: AnalyticsEngineDataset;
  /**
   * Segredo do marcador de uso próprio (`wrangler secret put SELF_MARKER`):
   * requisições com o header x-mcp-self igual a ele ganham blob4="self" na
   * telemetria. Ausente = nenhuma requisição é marcada.
   */
  SELF_MARKER?: string;
  /**
   * Token temporário do claim no mcpindex.ai (`wrangler secret put
   * MCPINDEX_CHALLENGE`), servido em /.well-known/mcpindex-challenge durante a
   * janela de 15 min da verificação de posse. Ausente = a rota responde 404.
   */
  MCPINDEX_CHALLENGE?: string;
}
