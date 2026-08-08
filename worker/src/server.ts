/**
 * Construção do McpServer — chamado pela factory do createMcpHandler a cada request
 * (modelo stateless do MCP SDK v2).
 *
 * As registrations de tools/resources/prompts são reutilizadas verbatim do pacote
 * npm via `registerAll` (../../src/server.ts, importado do build em dist/), então o
 * transporte HTTP e o STDIO expõem exatamente a mesma superfície. A instrumentação
 * de uso (Durable Object UsageTracker) entra pelo hook `record` do próprio
 * `registerAll` — nomes e contagens apenas, nunca argumentos ou resultados.
 *
 * Requer o pacote pai compilado (`npm run build` na raiz do repo).
 */

import { McpServer } from "@modelcontextprotocol/server";

import { registerAll, SERVER_INSTRUCTIONS, SERVER_VERSION } from "../../dist/server.js";
import { SERVER_CONFIG } from "./config.js";
import type { RecordUsage } from "./usage-core.js";

/** Builds a fresh MCP server with the shared tool/resource/prompt surface. */
export function buildServer(record: RecordUsage = () => {}): McpServer {
  const server = new McpServer(
    {
      name: SERVER_CONFIG.name,
      version: SERVER_VERSION,
      websiteUrl: SERVER_CONFIG.websiteUrl,
    },
    { instructions: SERVER_INSTRUCTIONS }
  );
  registerAll(server, (kind, name) => record(kind, name));
  return server;
}
