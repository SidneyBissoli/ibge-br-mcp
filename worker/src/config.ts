/**
 * Identidade e tunáveis do Worker ibge-br-mcp — instância do template de hosting
 * da Fase 0 (mcp-br-commons/templates/cloudflare-worker). Os demais módulos leem daqui.
 *
 * A versão vem do build do pacote pai (dist/server.js ← package.json), a única
 * fonte de verdade de versão do repo.
 */

import { SERVER_VERSION } from "../../dist/server.js";

export const SERVER_CONFIG = {
  /** Nome curto do servidor (handshake MCP, /status, landing). */
  name: "ibge-br-mcp",
  /** Versão do servidor — única fonte: package.json do pacote pai. */
  version: SERVER_VERSION,
  /** Título de exibição (landing page). */
  // Mesmo texto do `server.json` — que é o que o MCP Registry publica e os
  // diretórios copiam. Divergir aqui faria o handshake e as fichas mostrarem
  // nomes diferentes do mesmo produto.
  title: "IBGE Brasil MCP",
  /** Uma frase: o que o servidor serve e de qual fonte. */
  description:
    "Servidor MCP com 22 ferramentas de dados públicos oficiais do IBGE — geografia, " +
    "censo, economia e saúde — com valores exatos e fonte citada.",
  /**
   * Contato exibido na landing page. A URL raiz do Worker é o que sysadmins upstream
   * veem — precisa resolver para identificação humana + contato.
   */
  contactEmail: "sbissoli76@gmail.com",
  /**
   * Site do servidor no handshake (`serverInfo.websiteUrl`). É o DOMÍNIO
   * PRÓPRIO, não o repositório: é o que `server.json` declara e o que serve o
   * ícone. O par estava desalinhado — o manifesto apontava para o domínio e o
   * handshake para o GitHub.
   */
  websiteUrl: "https://ibge.sidneybissoli.com",
  /** Rota do endpoint MCP (Streamable HTTP). */
  mcpRoute: "/mcp",
  /**
   * Hostnames aceitos no header Host. A lista SUBSTITUI os defaults do
   * createMcpHandler (localhost e *.workers.dev) — por isso inclui também o
   * hostname workers.dev e os de dev local, além do domínio próprio.
   */
  extraAllowedHostnames: [
    "ibge.sidneybissoli.com",
    "ibge-br-mcp.sidneybissoli.workers.dev",
    "localhost",
    "127.0.0.1",
  ] as string[],
} as const;

/**
 * Rate limit de entrada por cliente (IP), aplicado às rotas não-públicas.
 * Token bucket em memória por isolate: proteção contra abuso acidental/burst, não um
 * limite global exato (recicla com o isolate; instâncias em POPs distintos não somam).
 * Para limite global rígido, mover a contagem para um Durable Object.
 */
export const RATE_LIMIT = {
  /** Burst máximo por cliente. */
  clientBurst: 20,
  /** Reposição de tokens por segundo por cliente. */
  clientRefillPerSec: 5,
  /** Teto de buckets rastreados por isolate (evicção FIFO ao estourar). */
  maxClientBuckets: 1000,
} as const;
