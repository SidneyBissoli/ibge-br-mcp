/**
 * A ida à origem: retry, timeout, orçamento — e a CONTAGEM que alimenta o
 * bloco `retrieval` do contrato de proveniência v1.1.
 *
 * Desde a 5.4.0 (27/09/2026) a ida é do `@sbissoli/mcp-upstream`, o fetch
 * comum do portfólio: retry com backoff e `Retry-After`, timeout por
 * tentativa, orçamento total por ida e a contagem de idas, tentativas e
 * anomalias que sai na proveniência de toda resposta. O pacote CLASSIFICA;
 * este módulo DECIDE. O que continua sendo daqui:
 *
 *  - os números: 5 tentativas (4 retries) de 2 s → 16 s, 30 s por tentativa
 *    (`REQUEST_TIMEOUT_MS`), os presets `QUICK`/`NONE`, sem jitter;
 *  - a lista de status que repete (`retryableStatusCodes`) — é ela que deixa
 *    o 500 da API de Agregados fora da repetição (`RETRY_SIDRA`);
 *  - "o fetch lançou" só repete se for REDE (`isNetworkError` sobre o
 *    `cause`): um `Error` que outra camada lançou dentro do fetch não é rede;
 *  - corpo em 200 que não é JSON NÃO repete. Nunca foi medido nas APIs do
 *    IBGE; o pacote repetiria por padrão porque o bcb mediu HTML-em-200
 *    transitório na origem DELE. Quando for medido aqui, é uma linha em
 *    `repetir` — até lá, paridade com o que este servidor sempre fez;
 *  - os erros tipados que o resto do servidor lê: `TimeoutError`,
 *    `UpstreamError` (com o que a fonte disse) e `RecursoAusenteError` (o
 *    `[]`-em-200, classe medida — ver `cachedFetchOne`).
 *
 * O que MUDOU com o pacote: 429 passa a honrar `Retry-After`; um pedido não
 * ultrapassa o orçamento total mesmo que a origem responda devagar a cada
 * tentativa; e toda tentativa — superada ou final — fica contada e sai em
 * `retrieval`.
 *
 * O coletor por chamada. `comColetorDeRede` (chamado por `withMetrics`, que
 * envolve o corpo de TODA tool) abre UM `UpstreamCall` por chamada de tool,
 * propagado por `AsyncLocalStorage`; tudo o que `cachedFetch` e
 * `fetchWithRetry` fazem dentro dele conta, e `provenienciaIbge` lê
 * `currentCall()?.retrieval()`. Chamada aninhada (`search`/`fetch` chamam as
 * tools de verdade; `ibge_nomes` mede os sub-passos) REUSA o coletor aberto —
 * senão a contagem da tool de fora perderia as idas de dentro. Fora de um
 * coletor — chamada direta em teste — cada ida ganha um coletor descartável
 * e a proveniência degrada para `retrieval: null` ("não medido"), nunca quebra.
 */

import {
  createUpstream,
  UpstreamError as ErroDaIda,
  type RetryContext,
  type Upstream,
  type UpstreamCall,
  type UpstreamRequestInit,
} from "@sbissoli/mcp-upstream";
import { currentCall, withCall } from "@sbissoli/mcp-upstream/als";
import { REQUEST_TIMEOUT_MS } from "./config.js";

/**
 * Thrown when a request exceeds its configured timeout. Carries the limit so
 * callers (e.g. `parseHttpError`) can render a precise, user-facing message.
 */
export class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Request timeout after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Uma resposta HTTP de erro da fonte, COM o que a fonte disse.
 *
 * Por que existe. Até 11/09/2026 o erro era `new Error("HTTP 400: Bad Request")`
 * e o corpo da resposta ia para o lixo. O SIDRA responde 400 a toda chamada
 * malformada e o corpo é uma frase que resolve o problema sozinha — "Parâmetro
 * N3 (Nível territorial) incompatível com a tabela", "Parâmetro V (Variável)
 * com código 9999 inexistente na tabela", "Tabela 99999: Tabela inválida".
 * Quem chamava recebia "Parâmetros inválidos. Verifique se os parâmetros estão
 * no formato correto", que não diz QUAL parâmetro nem POR QUÊ, e a única saída
 * era tentar outra combinação.
 *
 * A `message` continua começando por `HTTP <código>: <texto>` de propósito: é
 * o que `parseHttpError` usa para achar o código, e mudar a forma quebraria a
 * leitura em silêncio.
 */
export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    /** O que a fonte respondeu no corpo, já limpo e cortado. Vazio quando não há. */
    public readonly detalhe?: string,
    sufixo = ""
  ) {
    super(`HTTP ${status}: ${statusText}${sufixo}${detalhe ? ` — ${detalhe}` : ""}`);
    this.name = "UpstreamError";
  }
}

/**
 * A fonte respondeu 200 e respondeu que o recurso NÃO EXISTE.
 *
 * Por que existe. As APIs do IBGE não usam 404 para identificador inexistente:
 * respondem `[]` com HTTP 200. Medido em 22/09/2026, nas duas famílias:
 *
 *   GET /api/v2/cnae/classes/4721            -> 200 []
 *   GET /api/v2/cnae/subclasses/4721101      -> 200 []
 *   GET /api/v1/localidades/municipios/9999999 -> 200 []
 *   GET /api/v1/localidades/estados/99       -> 200 []
 *
 * Como `cachedFetch` só olha `response.ok`, esse array atravessava a camada de
 * rede com o tipo do chamador (`CnaeClasse`, `Municipio`) e estourava no
 * formatador — `Cannot read properties of undefined (reading 'divisao')`, que
 * não tem classe em `call-shape.ts` e caía em `outro`. Era o defeito por trás
 * dos 13 erros `outro` do `ibge_cnae` na semana de 13/09/2026.
 *
 * Consertar só o endpoint que estourou deixaria a classe aberta: QUALQUER
 * endpoint de identificador único destas duas famílias pode devolver `[]`. Por
 * isso a ausência vira um erro tipado na borda da rede (`cachedFetchOne`), e
 * não uma checagem repetida em cada formatador.
 *
 * O limite da classe também foi medido, para não se varrer de novo: as outras
 * duas APIs que este servidor consulta por identificador respondem ausência com
 * HTTP 500, não com `[]`, e já caem no tratamento de `UpstreamError` —
 * `/api/v3/agregados/99999/metadados` e `/api/v1/pesquisas/ZZ`. Elas seguem em
 * `cachedFetch`.
 *
 * A `message` diz "nenhum registro encontrado" de propósito: é o que
 * `classifyError` lê para gravar a classe `nao_encontrado` na telemetria, no
 * lugar do `outro` anônimo em que o `TypeError` caía. A forma também evita
 * concordância com o gênero de `recurso` ("a Classe", "o Grupo").
 *
 * O pacote de rede não vê esta classe — para ele, `[]` com 200 é uma ida
 * limpa, e É: a origem respondeu. A ausência é semântica deste servidor.
 */
export class RecursoAusenteError extends Error {
  constructor(
    /** O que se procurava, em português, para a mensagem ao chamador. Ex.: "Classe CNAE". */
    public readonly recurso: string,
    /** O identificador pedido, como foi montado na URL. */
    public readonly id: string
  ) {
    super(`${recurso} "${id}": nenhum registro encontrado na fonte`);
    this.name = "RecursoAusenteError";
  }
}

/**
 * O corpo de uma resposta de erro, pronto para ir ao chamador — ou `undefined`.
 *
 * Três guardas, cada uma por um motivo: HTML é página de erro de borda e não
 * ensina nada (e vem em quilobytes); o corte em 300 caracteres existe porque
 * este texto entra numa mensagem que o modelo lê inteira; e o `catch` cobre
 * corpo já consumido ou conexão cortada, onde não ter detalhe é melhor que
 * derrubar o tratamento do erro.
 */
export async function motivoUpstream(response: Response): Promise<string | undefined> {
  try {
    return motivoDoCorpo(await response.text());
  } catch {
    return undefined;
  }
}

/** `motivoUpstream` para um corpo já lido (o pacote lê o corpo do erro no modo JSON). */
export function motivoDoCorpo(corpo: string | undefined): string | undefined {
  const cru = (corpo ?? "").trim();
  if (!cru || cru.startsWith("<")) return undefined;
  // JSON de erro das APIs do IBGE em v1/v3 traz a frase numa chave; texto
  // cru é o caso do SIDRA. Tentar a chave antes de despejar o JSON inteiro.
  let texto = cru;
  try {
    const j = JSON.parse(cru) as Record<string, unknown>;
    for (const chave of ["message", "mensagem", "erro", "error", "detail"]) {
      if (typeof j[chave] === "string" && j[chave]) {
        texto = j[chave] as string;
        break;
      }
    }
  } catch {
    // Não era JSON — o texto cru é a mensagem, que é o caso do SIDRA.
  }
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (!limpo) return undefined;
  return limpo.length > 300 ? `${limpo.slice(0, 297)}...` : limpo;
}

export interface RetryOptions {
  /** Retries beyond the first attempt (default: 4 — up to 5 attempts) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 2000); doubles at every retry */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 16000) */
  maxDelayMs?: number;
  /** HTTP status codes that should trigger a retry */
  retryableStatusCodes?: number[];
  /** Per-attempt timeout in milliseconds (default: REQUEST_TIMEOUT_MS) */
  timeoutMs?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 4,
  initialDelayMs: 2000,
  maxDelayMs: 16000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
  timeoutMs: REQUEST_TIMEOUT_MS,
};

/**
 * Retry configuration presets for different scenarios. `AGGRESSIVE` (6 retries
 * up to 30 s) went away in 5.4.0: nothing used it, and it would not fit the
 * total budget of a request (`orcamentoTotalMs`).
 */
export const RETRY_PRESETS = {
  /** Standard retry for API requests */
  DEFAULT: {
    maxRetries: 4,
    initialDelayMs: 2000,
  } as RetryOptions,

  /** Quick retry for best-effort enrichment requests (ibge_cidades, ibge_vizinhos) */
  QUICK: {
    maxRetries: 2,
    initialDelayMs: 500,
    maxDelayMs: 2000,
  } as RetryOptions,

  /** No retry */
  NONE: {
    maxRetries: 0,
  } as RetryOptions,
} as const;

/**
 * Check if an error is a network-related error that should be retried
 */
export function isNetworkError(error: Error): boolean {
  const networkErrorPatterns = [
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "fetch failed",
    "network error",
    "network request failed",
    "socket hang up",
    "connection reset",
    "connection refused",
    "timeout",
  ];

  const message = error.message.toLowerCase();
  return networkErrorPatterns.some(
    (pattern) => message.includes(pattern.toLowerCase()) || error.name === pattern
  );
}

/**
 * Orçamento TOTAL de uma ida na política padrão: as tentativas inteiras mais as
 * esperas entre elas — o que este servidor já gastava no pior caso (5 × 30 s +
 * 2 + 4 + 8 + 16 s = 180 s). O pacote exige um teto explícito, e o teto honesto
 * é o que já valia. Vale por cima de qualquer política por ida.
 */
export function orcamentoTotalMs(o: Required<RetryOptions> = DEFAULT_OPTIONS): number {
  let esperas = 0;
  for (let r = 0; r < o.maxRetries; r++) {
    esperas += Math.min(o.initialDelayMs * 2 ** r, o.maxDelayMs);
  }
  return (o.maxRetries + 1) * o.timeoutMs + esperas;
}

/**
 * A decisão de repetir uma tentativa que falhou. O pacote diz a classe; aqui
 * se decide, com a política daquela ida (a lista de status é o que varia
 * entre `DEFAULT` e `RETRY_SIDRA`).
 */
export function repetir(ctx: RetryContext, o: Required<RetryOptions>): boolean {
  // Tempo esgotado é transitório por natureza — cabeçalhos ou corpo.
  if (ctx.kind === "timeout") return true;
  // O fetch lançou: só é rede se a mensagem for de rede. Um `Error` de outra
  // camada lançado dentro do fetch (é assim que os testes simulam status) não é.
  if (ctx.kind === "network") return ctx.cause instanceof Error && isNetworkError(ctx.cause);
  // 200 que não é JSON: nunca medido nas APIs do IBGE — paridade (ver cabeçalho).
  if (ctx.kind === "malformed_body") return false;
  // Um status chegou (4xx, 5xx, 429): a lista decide.
  return ctx.status !== undefined && o.retryableStatusCodes.includes(ctx.status);
}

/**
 * A política de rede do servidor: os números padrão, sem jitter (os testes
 * contam o relógio), e a ligação TARDIA ao `fetch` global — os testes o dublam
 * depois de o módulo carregar.
 */
function upstreamIbge(): Upstream {
  return createUpstream({
    timeoutMs: DEFAULT_OPTIONS.timeoutMs,
    retries: DEFAULT_OPTIONS.maxRetries,
    budgetMs: orcamentoTotalMs(),
    backoff: {
      baseMs: DEFAULT_OPTIONS.initialDelayMs,
      maxMs: DEFAULT_OPTIONS.maxDelayMs,
      jitterMs: 0,
    },
    honorRetryAfter: true,
    retryOn: (ctx) => repetir(ctx, DEFAULT_OPTIONS),
    fetchImpl: (input, init) => globalThis.fetch(input, init),
  });
}

/**
 * Abre o coletor de UMA chamada de tool e roda `fn` dentro dele — ou reusa o
 * que já está aberto, se `fn` é um passo de uma chamada maior. `withMetrics`
 * chama isto para toda tool; `provenienciaIbge` lê o resultado.
 */
export function comColetorDeRede<T>(fn: () => Promise<T>): Promise<T> {
  return currentCall() ? fn() : withCall(upstreamIbge(), () => fn());
}

/** O coletor da chamada corrente; fora de uma, um descartável (a ida ainda tem política). */
function coletor(): UpstreamCall {
  return currentCall() ?? upstreamIbge().call();
}

/** A política de UMA ida, na forma que o pacote lê por requisição. */
function politicaDaIda(o: Required<RetryOptions>, init?: RequestInit): UpstreamRequestInit {
  return {
    ...init,
    signal: init?.signal ?? undefined,
    timeoutMs: o.timeoutMs,
    retries: o.maxRetries,
    backoff: { baseMs: o.initialDelayMs, maxMs: o.maxDelayMs },
    retryOn: (ctx) => repetir(ctx, o),
  };
}

/**
 * Uma ida lendo JSON — o caminho de `cachedFetch`. Erro de status vem como
 * `UpstreamError` com o que a fonte disse; tempo esgotado, como `TimeoutError`.
 */
export async function fetchJson<T>(url: string, options?: RetryOptions): Promise<T> {
  const o: Required<RetryOptions> = { ...DEFAULT_OPTIONS, ...options };
  try {
    return await coletor().json<T>(url, politicaDaIda(o));
  } catch (erro) {
    throw await traduzirErro(erro, o);
  }
}

/**
 * Uma ida que devolve a `Response` inteira, corpo não consumido — para quem
 * só precisa saber se a origem respondeu (`ibge_vizinhos` e a malha). Status
 * de erro final lança `UpstreamError`, como `cachedFetch`.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  const o: Required<RetryOptions> = { ...DEFAULT_OPTIONS, ...options };
  try {
    return await coletor().response(url, politicaDaIda(o, init));
  } catch (erro) {
    throw await traduzirErro(erro, o);
  }
}

/** Texto padrão dos status que as APIs do IBGE respondem (o modo JSON do pacote não guarda a `Response`). */
const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  408: "Request Timeout",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

/**
 * Do erro do pacote (classe + contagem) ao erro que o servidor sempre leu
 * (tipo + mensagem). O sufixo "(after N retries)" continua onde estava: na
 * mensagem de quem esgotou as tentativas.
 */
async function traduzirErro(erro: unknown, o: Required<RetryOptions>): Promise<Error> {
  if (!(erro instanceof ErroDaIda)) {
    return erro instanceof Error ? erro : new Error(String(erro));
  }
  const sufixo = erro.attempts > 1 ? ` (after ${erro.attempts - 1} retries)` : "";
  switch (erro.kind) {
    case "timeout":
      return new TimeoutError(o.timeoutMs);
    case "network":
    case "aborted":
      // O que o fetch lançou é o que o servidor sempre viu.
      return erro.cause instanceof Error
        ? erro.cause
        : new Error(erro.message, { cause: erro.cause });
    case "malformed_body":
      return new Error(`Resposta da API do IBGE não é JSON válido${sufixo}`, { cause: erro.cause });
    default: {
      // Um status chegou: http_4xx, http_5xx, rate_limited, not_found. O corpo
      // vai junto — é nele que a fonte diz QUAL parâmetro recusou e por quê.
      const status = erro.status ?? 0;
      const detalhe = erro.response
        ? await motivoUpstream(erro.response)
        : motivoDoCorpo(erro.body);
      const statusText = erro.response?.statusText || STATUS_TEXT[status] || "";
      return new UpstreamError(status, statusText, detalhe, sufixo);
    }
  }
}
