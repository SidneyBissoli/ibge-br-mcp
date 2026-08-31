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
import { announceServedVersions } from "../../dist/discover.js";

/** Builds a fresh MCP server with the shared tool/resource/prompt surface. */
export function buildServer(record: RecordUsage = () => {}): McpServer {
  const server = new McpServer(
    {
      name: SERVER_CONFIG.name,
      version: SERVER_VERSION,
      // `title` e `icons` no serverInfo do HANDSHAKE. Existiam no `server.json`
      // — que é o que os diretórios leem — mas não no que o cliente recebe ao
      // conectar, e o mcpscore mede o handshake. Esta construção é SEPARADA da
      // do stdio (`src/server.ts`): corrigir lá não corrige aqui, e foi
      // exatamente o que aconteceu na primeira tentativa — o stdio foi a
      // 146/148 e produção ficou em 169/173.
      title: SERVER_CONFIG.title,
      websiteUrl: SERVER_CONFIG.websiteUrl,
      icons: [
        { src: `${SERVER_CONFIG.websiteUrl}/icon.png`, mimeType: "image/png", sizes: ["512x512"] },
      ],
    },
    { instructions: SERVER_INSTRUCTIONS }
  );
  registerAll(server, (kind, name) => record(kind, name));
  // Anuncia no `server/discover` todas as revisões atendidas — ver
  // ../../src/discover.ts. É no HTTP que esta regra aparece.
  announceServedVersions(server);
  return server;
}
