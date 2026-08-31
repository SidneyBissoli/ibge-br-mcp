/**
 * Cada tabela do mapa de temas de `ibge_censo` é mesmo do Censo Demográfico, e
 * mesmo do assunto que o tema promete.
 *
 * POR QUE ESTE ARQUIVO EXISTE. `ibge_censo` é o atalho: existe para que ninguém
 * precise saber código de tabela SIDRA. O preço disso é um mapa escrito à mão —
 * tema e ano de um lado, código e uma `descricao` do outro — e nada jamais
 * confrontou esse par com a fonte. Em 2026-08-31 uma varredura contra a API de
 * Agregados achou **13 das 41 tabelas fora do Censo Demográfico**:
 *
 * - `saneamento`/2022 → tabela 9696, que é da PNAD Contínua e mede rendimento
 *   em domicílios com televisão por assinatura;
 * - `fecundidade`/2010 → tabela 1691, que é o **INPC** de 1990;
 * - `rendimento`/2000 → tabela 857, do **Censo Agropecuário**;
 * - `quilombolas`/2022 e `quilombolas`/2022-territorios → tabelas de uso de
 *   Internet na PNAD Contínua;
 * - `educacao`/2000 → nascidos vivos, do Registro Civil;
 * - `deficiencia`/2000 → transportes, da Pesquisa Anual de Serviços;
 *   e mais seis.
 *
 * O defeito não quebrava nada. A tool respondia, o cabeçalho trazia a
 * `descricao` escrita à mão, e quem perguntasse "saneamento no Censo 2022"
 * recebia linhas de outra pesquisa sob um rótulo que mentia — pior que um erro,
 * porque parece resposta. É a mesma classe dos números fossilizados em prosa
 * (ver `tests/contagem-nos-textos.test.ts`): um literal escrito à mão ao lado do
 * texto que o descreve, e ninguém entre os dois.
 *
 * A defesa é confrontar com a FONTE ([[verificacao-deriva-da-fonte]]):
 *
 * 1. o código tem de existir no catálogo do Censo Demográfico — o espelho em
 *    `tests/fixtures/censo-agregados.json`, cópia da API de Agregados,
 *    regenerável por `node scripts/atualiza-catalogo-censo.mjs`;
 * 2. o NOME OFICIAL da tabela tem de conter um termo do assunto do tema. É isto
 *    que pega o caso mais traiçoeiro: tabela do Censo, sim, mas de outro assunto
 *    — era o `nupcialidade`/2010, que apontava para rendimento domiciliar.
 *
 * Tabela nova do Censo que ainda não esteja no espelho reprova aqui e a
 * mensagem manda rodar o script. É falso negativo barulhento, que é o lado
 * certo de errar: o que não se pode ter é falso positivo silencioso.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { CENSO_TABELAS } from "../src/tools/censo.js";

const espelho = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures", "censo-agregados.json"),
    "utf8",
  ),
) as { _meta: { extraido_em: string }; agregados: Record<string, string> };

/** Sem acento e em caixa baixa: o nome oficial usa acentuação, o termo não precisa. */
function normaliza(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * O ASSUNTO de cada tema, em termos que o nome oficial da tabela precisa
 * conter (basta um). Não é uma cópia do código — é a afirmação, em português,
 * do que aquele tema promete; é ela que o nome oficial confirma ou desmente.
 */
const TERMOS_POR_TEMA: Record<string, readonly string[]> = {
  populacao: ["populacao residente", "domicilios recenseados"],
  alfabetizacao: ["alfabetiza"],
  domicilios: ["domicilios recenseados", "domicilios particulares"],
  idade_sexo: ["idade", "envelhecimento"],
  religiao: ["religiao"],
  cor_raca: ["cor ou raca"],
  rendimento: ["rendimento"],
  migracao: ["lugar de nascimento", "naturalidade", "imigra", "emigra"],
  educacao: ["nivel de instrucao"],
  trabalho: ["condicao de atividade", "ocupadas", "trabalho"],
  indigenas: ["indigena"],
  quilombolas: ["quilombola"],
  saneamento: ["abastecimento de agua", "esgot", "saneamento"],
  deficiencia: ["deficiencia"],
  nupcialidade: ["estado civil", "estado conjugal"],
  fecundidade: ["filhos", "fecundidade"],
};

const entradas = Object.entries(CENSO_TABELAS).flatMap(([tema, porAno]) =>
  Object.entries(porAno).map(([chave, info]) => ({ tema, chave, ...info })),
);

describe("mapa de temas de ibge_censo", () => {
  it("o espelho do catálogo oficial está carregado", () => {
    expect(Object.keys(espelho.agregados).length).toBeGreaterThan(1000);
    expect(entradas.length).toBeGreaterThan(0);
  });

  it("todo tema declarado tem termos de assunto para conferir", () => {
    // Tema novo sem termos passaria sem verificação nenhuma — que é como o
    // defeito entrou.
    const semTermos = Object.keys(CENSO_TABELAS).filter((t) => !TERMOS_POR_TEMA[t]);
    expect(semTermos, "temas sem TERMOS_POR_TEMA — acrescente antes de mapear tabela").toEqual([]);
  });

  for (const { tema, chave, tabela, descricao } of entradas) {
    it(`${tema}/${chave} → tabela ${tabela} é do Censo Demográfico`, () => {
      expect(
        espelho.agregados[tabela],
        `a tabela ${tabela} (${descricao}) não está no catálogo do Censo Demográfico. ` +
          `Ou é de outra pesquisa — e aí o tema "${tema}" está servindo dado errado sob rótulo ` +
          `certo —, ou é uma tabela nova: rode "node scripts/atualiza-catalogo-censo.mjs".`,
      ).toBeDefined();
    });

    it(`${tema}/${chave} → tabela ${tabela} é do assunto do tema`, () => {
      const oficial = espelho.agregados[tabela];
      if (!oficial) return; // já reprovado no teste acima; não duplicar o ruído
      const alvo = normaliza(oficial);
      const termos = TERMOS_POR_TEMA[tema] ?? [];
      expect(
        termos.some((t) => alvo.includes(normaliza(t))),
        `a tabela ${tabela} existe no Censo, mas é de outro assunto:\n` +
          `  tema:           ${tema}\n` +
          `  o mapa promete: ${descricao}\n` +
          `  o IBGE publica: ${oficial}`,
      ).toBe(true);
    });
  }
});
