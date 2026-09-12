/**
 * `fetch` com repetição para os testes de integração (rede real).
 *
 * Por que existe: em 12/09/2026 a rodada semanal ficou vermelha porque UMA
 * conexão de UMA requisição não abriu — `UND_ERR_CONNECT_TIMEOUT` contra
 * `servicodados.ibge.gov.br:443` — no mesmo runner que, segundos antes, tinha
 * feito 32 leituras boas contra o mesmo host. Um blip isolado não diz nada
 * sobre o contrato, mas derrubava o job inteiro e chegava ao painel do
 * portfólio como "a fonte mudou".
 *
 * Regra: só repete falha de TRANSPORTE, quando o IBGE não respondeu nada.
 * Resposta que chega é devolvida como está, inclusive 4xx e 5xx — vários
 * testes daqui ASSERTAM um 400, e repetir isso esconderia o que eles medem.
 *
 * O outro regime, diferente deste, é o runner que não fala com a fonte o job
 * inteiro: a fonte mantém lista de bloqueio por endereço de origem (medido em
 * 12/09/2026 — de 20 runners simultâneos, 2 não receberam nenhuma resposta de
 * TCP em nenhum endereço do alvo, enquanto 18 conectavam). Repetição não cura
 * isso; quem cura é runner novo, e disso cuida o workflow `Integration retry`.
 */

/** O IBGE não respondeu: DNS, TCP, TLS, abort. Diferente de um status HTTP. */
export class FalhaDeTransporte extends Error {
  constructor(public readonly causa: unknown) {
    super(String(causa));
    this.name = "FalhaDeTransporte";
  }
}

/**
 * Orçamento por requisição. A API responde em ~250 ms quando responde; 20 s é
 * oitenta vezes isso, folga de sobra para lentidão real sem transformar
 * silêncio em hora de runner.
 */
export const ORCAMENTO_REQUISICAO_MS = 20_000;

const TENTATIVAS = 3;
const ESPERA_BASE_MS = 1000;

function dorme(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Busca `url` repetindo só falhas de transporte. Devolve a `Response` assim
 * que uma chegar, seja qual for o status. Esgotadas as tentativas, lança
 * `FalhaDeTransporte`, para quem chama poder distinguir "não respondeu" de
 * "respondeu e foi recusado".
 */
export async function fetchIntegracao(url: string, init: RequestInit = {}): Promise<Response> {
  let ultima: unknown;
  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa++) {
    try {
      return await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(ORCAMENTO_REQUISICAO_MS),
      });
    } catch (err) {
      ultima = err;
      if (tentativa < TENTATIVAS - 1) await dorme(ESPERA_BASE_MS * (tentativa + 1));
    }
  }
  throw new FalhaDeTransporte(ultima);
}
