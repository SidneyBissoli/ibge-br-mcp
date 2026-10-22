/**
 * A ida à rede dos testes de integração (rede real) e o que um resultado de
 * ferramenta significa para eles.
 *
 * Por que existe: em 12/09/2026 a rodada semanal ficou vermelha porque UMA
 * conexão de UMA requisição não abriu — `UND_ERR_CONNECT_TIMEOUT` contra
 * `servicodados.ibge.gov.br:443` — no mesmo runner que, segundos antes, tinha
 * feito 32 leituras boas contra o mesmo host. Um blip isolado não diz nada
 * sobre o contrato, mas derrubava o job inteiro e chegava ao painel do
 * portfólio como "a fonte mudou".
 *
 * Desde a peça 4 do item `mcp:fonte-indisponivel-nao-e-deriva` (22/10/2026) a
 * ida é do `@sbissoli/mcp-upstream` — o erro carrega o `kind` — e cada caso
 * roda em `aoVivo` do `@sbissoli/mcp-live-source/vitest`, que repete (3 idas)
 * e, se a fonte segue fora (timeout, rede, 429, 5xx), PULA o caso e o anota
 * como `Fonte indisponível`: job verde, o painel conta as noites. Só o que a
 * fonte RESPONDEU reprova. O disjuntor (3 casos seguidos sem resposta e nenhuma
 * leitura) faz os casos seguintes pularem sem ir à rede — é o regime do runner
 * que a fonte bloqueia por endereço de origem (medido em 12/09/2026: de 20
 * runners simultâneos, 2 não receberam resposta de TCP nenhuma), e disso cuida
 * o workflow `Integration retry`, com runner novo.
 *
 * Regra: resposta 4xx que chega é devolvida como está — vários testes daqui
 * ASSERTAM um 400, e repetir isso esconderia o que eles medem. 5xx e 429 são a
 * fonte fora: sobem como erro do pacote e viram caso pulado.
 */

import { expect } from "vitest";
import { createUpstream, UpstreamError } from "@sbissoli/mcp-upstream";
import { ehAssercao, type OpcoesDaSuite } from "@sbissoli/mcp-live-source";
import { causaAnexada } from "../src/errors.js";
import { orcamentoTotalMs, RecursoAusenteError } from "../src/retry.js";

/**
 * Orçamento por requisição. A API responde em ~250 ms quando responde; 20 s é
 * oitenta vezes isso, folga de sobra para lentidão real sem transformar
 * silêncio em hora de runner.
 */
export const ORCAMENTO_REQUISICAO_MS = 20_000;

/** As idas são do `aoVivo`: 3, com 2 s e 4 s de espera (padrão do pacote). */
const IDAS = 3;
const ESPERAS_MS = 2_000 + 4_000;

/**
 * Pior caso de UM caso de teste com UMA requisição: três idas no orçamento
 * inteiro mais as esperas entre elas = 66 s. Todo caso que faz uma requisição
 * por este helper precisa de timeout MAIOR que isso, senão o vitest derruba o
 * caso enquanto a repetição ainda está cabendo — foi o que aconteceu em 21 e
 * 28/09/2026 (`Test timed out in 30000ms`), e o painel leu lentidão da fonte
 * como contrato quebrado. Casos com N requisições usam N × (a repetição é do
 * caso inteiro).
 */
export const TIMEOUT_CASO_MS = IDAS * ORCAMENTO_REQUISICAO_MS + ESPERAS_MS + 7_000;

/**
 * Caso que chama a FERRAMENTA inteira (`ibgeSidra`, `ibgeMalhas`…) além deste
 * helper: a ferramenta vai à fonte pelo `fetchJson` do servidor, com a política
 * padrão dele (5 tentativas de 30 s mais 2+4+8+16 s de espera = 180 s,
 * `orcamentoTotalMs`). Uma tentativa lenta lá dentro é comportamento normal do
 * servidor, não contrato quebrado — e em 29/09/2026 um caso de 60 s caiu por
 * `Test timed out` enquanto os dois irmãos passavam em 13 s. Cobre o helper mais
 * UMA ida completa da ferramenta; ferramenta que faça N idas no pior caso passa
 * disso, e aí é o pior caso do servidor, não lentidão pontual. Esses casos
 * rodam com `tentativas: 1` no `aoVivo` (`CASO_FERRAMENTA`): o servidor já
 * repetiu 5 vezes por dentro.
 */
export const TIMEOUT_CASO_FERRAMENTA_MS = TIMEOUT_CASO_MS + orcamentoTotalMs();

/** Opções de `aoVivo` para um caso que chama a ferramenta inteira. */
export const CASO_FERRAMENTA = { tentativas: 1, timeout: TIMEOUT_CASO_FERRAMENTA_MS } as const;

/**
 * Opções da suíte ao vivo de cada arquivo: o limite do disjuntor medido em
 * 12/09/2026, e a ausência que a fonte RESPONDEU (`[]` em 200) como deriva,
 * não como erro alheio.
 */
export const SUITE_AO_VIVO: OpcoesDaSuite = {
  limiteDoDisjuntor: 3,
  deriva: (e) => ehAssercao(e) || e instanceof RecursoAusenteError,
};

/** UMA tentativa por ida; quem repete é o `aoVivo`. */
const upstream = createUpstream({
  timeoutMs: ORCAMENTO_REQUISICAO_MS,
  retries: 0,
  fetchImpl: (input, init) => globalThis.fetch(input, init),
});

/**
 * Busca `url` e devolve a `Response` assim que uma chegar com status 4xx ou
 * 2xx/3xx. Timeout, rede, 429 e 5xx sobem como `UpstreamError` do pacote
 * (com o `kind`), para o `aoVivo` distinguir "não respondeu" de "respondeu e
 * foi recusado".
 */
export async function fetchIntegracao(url: string | URL, init: RequestInit = {}): Promise<Response> {
  try {
    return await upstream.call().response(String(url), { ...init, signal: init.signal ?? undefined });
  } catch (err) {
    if (
      err instanceof UpstreamError &&
      err.response !== undefined &&
      (err.kind === "http_4xx" || err.kind === "not_found")
    ) {
      return err.response;
    }
    throw err;
  }
}

/**
 * O resultado de uma ferramenta chamada como um cliente chamaria, lido pelo
 * teste vivo: `isError` com a exceção anexada (`CAUSA_DO_ERRO`, errors.ts)
 * relança a exceção REAL — o repórter lê o `kind` da origem pela cadeia
 * `cause` e decide (fonte fora = pulado); `isError` sem exceção é a ferramenta
 * recusando o que a fonte respondeu, e aí é a asserção que reprova.
 */
export function semErro(r: { isError?: boolean; markdown: string }): void {
  if (r.isError) {
    const causa = causaAnexada(r);
    if (causa) throw causa;
  }
  expect(r.isError, r.markdown.slice(0, 300)).toBeFalsy();
}
