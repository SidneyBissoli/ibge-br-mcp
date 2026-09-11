/**
 * Contrato do RESULTADO VAZIO do SIDRA, contra a API real.
 *
 * Por que existe. "População por UF em 2023" — a pergunta mais natural que
 * existe sobre a tabela mais usada do servidor — voltava vazia e calada: a
 * tabela 6579 não publica 2023, porque a série de estimativas do IBGE pula os
 * anos de Censo e de Contagem (2007, 2010, 2022, 2023). No modo estatísticas
 * era pior, porque a mensagem acusava marcador de ausência que não existia.
 * Sem dizer a causa, "nenhum registro" vira fato do mundo dentro de um
 * relatório. Medido e reproduzido em 11/09/2026.
 *
 * O ano do teste NÃO é pinado. Pinar 2023 fossilizaria uma lacuna que o IBGE
 * pode preencher: o teste PERGUNTA à fonte quais períodos a tabela tem, acha
 * uma lacuna real e usa essa. Se um dia não houver lacuna nenhuma, ele passa
 * dizendo isso em vez de reprovar por uma boa notícia.
 *
 * Roda apenas com INTEGRATION_TESTS=1 (rede real; ver
 * .github/workflows/integration.yml — cron semanal + dispatch manual).
 */
import { describe, expect, it } from "vitest";
import { ibgeSidra, sidraSchema } from "../src/tools/sidra.js";
import { IBGE_API } from "../src/types.js";

const LIVE = process.env.INTEGRATION_TESTS === "1" || process.env.INTEGRATION_TESTS === "true";

/** Estimativas de população: a tabela mais consultada, e a que tem a lacuna. */
const TABELA = "6579";

async function periodosDaFonte(tabela: string): Promise<number[]> {
  const resposta = await fetch(`${IBGE_API.AGREGADOS}/${tabela}/periodos`);
  expect(resposta.status).toBe(200);
  const periodos = (await resposta.json()) as Array<{ id?: string }>;
  return periodos.map((p) => Number(p?.id)).filter((n) => Number.isFinite(n));
}

describe.skipIf(!LIVE)("resultado vazio do SIDRA explica a causa", () => {
  it("um ano que a tabela não publica volta NOMEADO, com a lista do que ela tem", async () => {
    const anos = await periodosDaFonte(TABELA);
    expect(anos.length).toBeGreaterThan(5);

    const min = Math.min(...anos);
    const max = Math.max(...anos);
    const lacuna = [];
    for (let a = min; a <= max; a++) if (!anos.includes(a)) lacuna.push(a);

    if (lacuna.length === 0) {
      // O IBGE preencheu a série. Nada a testar, e é uma boa notícia — não uma
      // reprovação. O caminho do diagnóstico continua coberto offline.
      expect(anos.length).toBe(max - min + 1);
      return;
    }

    const ausente = String(lacuna[0]);
    const { markdown, isError } = await ibgeSidra(
      sidraSchema.parse({ tabela: TABELA, nivel_territorial: "3", periodos: ausente })
    );

    expect(isError).toBeFalsy();
    expect(markdown, `esperava o ano ${ausente} nomeado`).toContain(
      `não publica o período ${ausente}`
    );
    // E a lista do que existe precisa citar as pontas da série.
    expect(markdown).toContain(String(min));
    expect(markdown).toContain(String(max));
  }, 60000);

  it("no modo estatísticas a causa é a mesma, não marcador de ausência", async () => {
    const anos = await periodosDaFonte(TABELA);
    const min = Math.min(...anos);
    const max = Math.max(...anos);
    const lacuna = [];
    for (let a = min; a <= max; a++) if (!anos.includes(a)) lacuna.push(a);
    if (lacuna.length === 0) return;

    const { markdown } = await ibgeSidra(
      sidraSchema.parse({
        tabela: TABELA,
        nivel_territorial: "3",
        periodos: String(lacuna[0]),
        estatisticas: true,
      })
    );

    expect(markdown).toContain("não publica o período");
    expect(markdown).not.toContain("marcador de ausência");
  }, 60000);

  it("um ano que a tabela PUBLICA continua respondendo dado", async () => {
    const anos = await periodosDaFonte(TABELA);
    const presente = String(Math.max(...anos));

    const { markdown, structured, isError } = await ibgeSidra(
      sidraSchema.parse({ tabela: TABELA, nivel_territorial: "3", periodos: presente })
    );

    expect(isError).toBeFalsy();
    expect(markdown).not.toContain("não publica");
    // 27 unidades da federação: o diagnóstico não pode ter comido a resposta.
    expect((structured as { totalRegistros: number }).totalRegistros).toBe(27);
  }, 60000);
});
