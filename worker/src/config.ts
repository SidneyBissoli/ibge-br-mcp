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
    "Servidor MCP com 23 ferramentas de dados públicos oficiais do IBGE — geografia, " +
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
  /**
   * Chave do IndexNow. É PÚBLICA por desenho: ela prova posse do domínio por
   * estar servida em `/<chave>.txt`, então versionar aqui não é vazamento.
   */
  indexNowKey: "9d22f92e5508b317f749929e1e139669",
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

/**
 * Texto da LANDING PAGE — a única superfície própria do produto, e por isso a
 * única que responde por ele numa busca. Até 2026-08-31 a página tinha oito
 * linhas de corpo, sem `meta description`, sem og:, sem dado estruturado e sem
 * link para o repositório: não havia o que indexar.
 *
 * `lang` segue o PÚBLICO do produto, não a língua do código. O bloco
 * `emOutroIdioma` não é rodapé de cortesia: é seção com resumo e exemplos
 * próprios, porque é texto indexável.
 */
export const LANDING = {
  lang: "pt-BR" as "pt-BR" | "en",
  resumo:
    "Servidor MCP com 23 ferramentas de dados oficiais do IBGE — geografia, censo, " +
    "economia e saúde — com valor exato e a fonte citada em cada resposta.",
  exemplos: [
    "“Qual era a população de Belo Horizonte no Censo 2022?”",
    "“Liste os municípios do Espírito Santo.”",
    "“Compare o PIB das capitais do Sudeste.”",
    "“Qual foi o desemprego no 2º trimestre de 2026?”",
  ] as readonly string[],
  destaques: [
    "Toda resposta traz bloco de procedência: a pesquisa ou tabela, o período e a URL que reproduz a consulta.",
    "Os 5.570 municípios numa chamada só, com a distribuição completa — mediana, média e percentis — em vez de um top 10 que esconde a assimetria.",
    "Dado ao vivo das APIs do IBGE, mais novo que o treino de qualquer modelo.",
    "Indicadores de saúde inclusos, servidos pelo SIDRA do próprio IBGE.",
  ] as readonly string[],
  repoUrl: "https://github.com/SidneyBissoli/ibge-br-mcp",
  npmUrl: "https://www.npmjs.com/package/ibge-br-mcp",
  docsUrl:
    "https://github.com/SidneyBissoli/ibge-br-mcp/blob/main/docs/artigo-sidra-tabela-certa.pt-BR.md",
  emOutroIdioma: {
    lang: "en" as "pt-BR" | "en",
    resumo:
      "Live, exact Brazilian public data for your AI assistant: geography, census, " +
      "economy and health from the official IBGE APIs, every figure with the table " +
      "and period it came from.",
    exemplos: [
      "“What was the population of Belo Horizonte in the 2022 Census?”",
      "“Which Brazilian state grew the most between the 2010 and 2022 censuses?”",
    ] as readonly string[],
  },
} as const;
