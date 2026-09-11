/**
 * Contrato de malhas — valida, contra a API REAL de malhas v3, que a URL que
 * `ibge_malhas` monta é aceita, e que a tabela de divisões internas do código
 * ainda é a que a API declara.
 *
 * Por que existe: até 2026-09-10 a ferramenta falava o vocabulário da v2
 * (`resolucao=0..5`, `qualidade=1..4`) contra a v3, que responde
 * 400 "O parâmetro qualidade aceita apenas UM dos seguintes valores: minima,
 * intermediaria ou maxima". Como `qualidade` ia em toda chamada com o default
 * "4", a ferramenta falhava 100% das vezes — desde sempre, para todo mundo.
 * Os testes offline passavam porque mockam `fetch` e só conferem que a URL
 * CONTÉM o caminho esperado: URL montada é hipótese, quem diz se ela vale é a
 * API.
 *
 * Duas verificações independentes, e é de propósito que a segunda não copie a
 * primeira:
 *  - a URL que a ferramenta monta precisa voltar 200 em cada nível;
 *  - a lista de `intrarregiao` aceita por nível é PERGUNTADA à API (um valor
 *    inválido faz a v3 enumerar o que aceita) e comparada com a tabela do
 *    código. Assim a tabela não fossiliza o dia em que foi escrita.
 *
 * Roda apenas com INTEGRATION_TESTS=1 (rede real; ver
 * .github/workflows/integration.yml — cron semanal + dispatch manual).
 */
import { describe, expect, it } from "vitest";
import {
  ibgeMalhas,
  INTRARREGIAO_POR_NIVEL,
  NIVEIS,
  QUALIDADE_V3,
  RESOLUCAO_PARA_INTRARREGIAO,
  type Nivel,
} from "../src/tools/malhas.js";
import { IBGE_API } from "../src/types.js";

const LIVE = process.env.INTEGRATION_TESTS === "1" || process.env.INTEGRATION_TESTS === "true";

/** Um identificador real por nível, para perguntar à API o que ela aceita. */
const EXEMPLO: Record<Nivel, string> = {
  paises: "BR",
  regioes: "1",
  estados: "33",
  mesorregioes: "3301",
  microrregioes: "33001",
  municipios: "3304557",
  "regioes-imediatas": "330001",
  "regioes-intermediarias": "3301",
};

const GEOJSON = encodeURIComponent("application/vnd.geo+json");

/**
 * Pergunta à v3 quais valores de `intrarregiao` o nível aceita.
 *
 * Um valor impossível faz a API responder 400 enumerando o vocabulário —
 * "... aceita apenas UM dos seguintes valores: a, b ou c",
 * "... aceita apenas o seguinte valor: c" ou "... NÃO aceita valores".
 * Ler a resposta dela é o que mantém a tabela do código honesta.
 */
async function aceitosSegundoApi(nivel: Nivel): Promise<string[]> {
  const url = `${IBGE_API.MALHAS}/${nivel}/${EXEMPLO[nivel]}?formato=${GEOJSON}&intrarregiao=__invalido__`;
  const resposta = await fetch(url);
  expect(resposta.status, `${nivel}: esperava 400 para intrarregiao inválida`).toBe(400);
  const { message } = (await resposta.json()) as { message?: string };
  expect(message, `${nivel}: a API não explicou o que aceita`).toBeTruthy();
  if (/N[ÃA]O aceita valores/i.test(message as string)) return [];
  const lista = (message as string).split(/valor(?:es)?:/i)[1];
  expect(lista, `${nivel}: mensagem inesperada — "${message}"`).toBeTruthy();
  return lista
    .split(/,| ou /)
    .map((v) => v.trim().replace(/\.$/, ""))
    .filter(Boolean);
}

describe.skipIf(!LIVE)("contrato de malhas contra a API v3 real", () => {
  it("cobre todo nível declarado no código", () => {
    expect(Object.keys(EXEMPLO).sort()).toEqual([...NIVEIS].sort());
  });

  for (const nivel of NIVEIS) {
    it(`${nivel}: a API confirma as divisões internas que o código promete`, async () => {
      const daApi = await aceitosSegundoApi(nivel);
      expect(new Set(daApi)).toEqual(new Set(INTRARREGIAO_POR_NIVEL[nivel]));
    }, 30000);
  }

  for (const nivel of NIVEIS) {
    it(`${nivel}: o endpoint da ferramenta responde 200`, async () => {
      const url = `${IBGE_API.MALHAS}/${nivel}/${EXEMPLO[nivel]}?formato=${GEOJSON}&qualidade=minima`;
      const resposta = await fetch(url);
      expect(resposta.status, `${nivel} em ${url}`).toBe(200);
    }, 30000);
  }

  for (const qualidade of QUALIDADE_V3) {
    it(`a API aceita qualidade="${qualidade}"`, async () => {
      const url = `${IBGE_API.MALHAS}/paises/BR?formato=${GEOJSON}&qualidade=${qualidade}`;
      expect((await fetch(url)).status).toBe(200);
    }, 30000);
  }

  it("a ferramenta inteira devolve malha, sem erro, no caminho mais comum", async () => {
    const { markdown, structured, isError } = await ibgeMalhas({
      localidade: "BR",
      resolucao: "2",
      qualidade: "minima",
    });

    expect(isError).toBeFalsy();
    expect(markdown).toContain("Número de features");
    // 27 UFs: o intrarregiao foi aplicado de verdade, não silenciosamente ignorado.
    expect(markdown).toContain("| **Número de features** | 27 |");
    expect(String((structured as { url?: string })?.url)).toContain("intrarregiao=UF");
  }, 60000);

  it("cada resolucao traduzida é um valor que a API aceita para BR", async () => {
    const doCodigo = Object.values(RESOLUCAO_PARA_INTRARREGIAO).filter(Boolean) as string[];
    const daApi = await aceitosSegundoApi("paises");
    for (const valor of doCodigo) {
      expect(daApi, `resolucao traduz para "${valor}", que a API de BR não aceita`).toContain(valor);
    }
  }, 30000);
});
