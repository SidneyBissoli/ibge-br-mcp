/**
 * Unidade/escala em campo próprio (roadmap Fase 4, achado de 29/09/2026,
 * feito em 15/10/2026): `unidades` sai FORA de `registros`, lido da resposta
 * inteira antes de `campos` e da paginação — o filtro que tirava a coluna
 * "Unidade de Medida" não pode mais deixar o número sem unidade.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sidraUnidades, notaUnidadesRemovidas } from "../src/structured.js";
import { ibgeSidra, sidraOutputSchema } from "../src/tools/sidra.js";
import { ibgeIndicadores } from "../src/tools/indicadores.js";
import { ibgeComparar } from "../src/tools/comparar.js";
import { unidadeComEscala } from "../src/tools/cidades.js";
import { cache } from "../src/cache.js";
import { mockResponse, sidraResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

/** Forma real da v3 com `view=flat` (conferida ao vivo em 15/10/2026, tabela 6579). */
const comUnidade = sidraResponse(
  {
    MC: "Unidade de Medida (Código)",
    MN: "Unidade de Medida",
    V: "Valor",
    D1C: "Unidade da Federação (Código)",
    D1N: "Unidade da Federação",
    D2C: "Variável (Código)",
    D2N: "Variável",
  },
  { MC: "1594", MN: "Mil pessoas", V: "44411", D1C: "35", D1N: "São Paulo", D2C: "4090", D2N: "Ocupadas" },
  { MC: "1594", MN: "Mil pessoas", V: "16055", D1C: "33", D1N: "Rio de Janeiro", D2C: "4090", D2N: "Ocupadas" },
  { MC: "2", MN: "%", V: "7.9", D1C: "35", D1N: "São Paulo", D2C: "4099", D2N: "Taxa de desocupação" }
);

describe("sidraUnidades", () => {
  it("um par por (variável, unidade), na ordem em que aparecem; multiplicador null", () => {
    expect(sidraUnidades(comUnidade)).toEqual([
      { variavel: "4090", nomeVariavel: "Ocupadas", unidade: "Mil pessoas", multiplicador: null },
      { variavel: "4099", nomeVariavel: "Taxa de desocupação", unidade: "%", multiplicador: null },
    ]);
  });

  it("não confunde 'Unidade da Federação' com 'Unidade de Medida'", () => {
    const soUf = sidraResponse(
      { D1N: "Unidade da Federação", V: "Valor" },
      { D1N: "São Paulo", V: "1" }
    );
    expect(sidraUnidades(soUf)).toEqual([]);
  });

  it("unidade em branco vira null, não string vazia", () => {
    const branco = sidraResponse({ MN: "Unidade de Medida", V: "Valor" }, { MN: " ", V: "1" });
    expect(sidraUnidades(branco)).toEqual([
      { variavel: null, nomeVariavel: null, unidade: null, multiplicador: null },
    ]);
  });

  it("variável cuja unidade muda no período (moedas antigas) dá um par por unidade", () => {
    const moedas = sidraResponse(
      { MN: "Unidade de Medida", V: "Valor", D1C: "Variável (Código)", D1N: "Variável" },
      { MN: "Mil Cruzeiros", V: "1", D1C: "1", D1N: "PIB" },
      { MN: "Mil Reais", V: "2", D1C: "1", D1N: "PIB" }
    );
    expect(sidraUnidades(moedas).map((u) => u.unidade)).toEqual(["Mil Cruzeiros", "Mil Reais"]);
  });

  it("só cabeçalho ou nada → []", () => {
    expect(sidraUnidades([])).toEqual([]);
    expect(sidraUnidades([comUnidade[0]])).toEqual([]);
  });
});

describe("notaUnidadesRemovidas", () => {
  const unidades = sidraUnidades(comUnidade);
  it("vazia quando a coluna continua na tabela", () => {
    expect(notaUnidadesRemovidas(unidades, ["Unidade de Medida", "Valor"])).toBe("");
  });
  it("devolve a unidade ao texto quando `campos` tirou a coluna", () => {
    expect(notaUnidadesRemovidas(unidades, ["Valor"])).toBe(
      "_Unidade de medida: Mil pessoas; %._\n\n"
    );
  });
});

describe("as ferramentas: `unidades` resiste a `campos` e à paginação", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ibge_sidra com campos='Valor': a coluna some, o campo fica (e o texto também)", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(comUnidade));
    const r = await ibgeSidra({ tabela: "4093", nivel_territorial: "3", campos: "Valor" });
    const s = r.structured as Record<string, unknown>;
    expect(s.colunas).toEqual(["Valor"]);
    expect(s.unidades).toEqual(sidraUnidades(comUnidade));
    expect(r.markdown).toContain("_Unidade de medida: Mil pessoas; %._");
    expect(sidraOutputSchema.safeParse(s).success).toBe(true);
  });

  it("CONTROLE: sem `campos`, a coluna fica e a nota não se repete no texto", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(comUnidade));
    const r = await ibgeSidra({ tabela: "4093", nivel_territorial: "3" });
    expect((r.structured as Record<string, unknown>).colunas).toContain("Unidade de Medida");
    expect(r.markdown).not.toContain("_Unidade de medida:");
  });

  it("ibge_indicadores com campos: o campo vem da resposta inteira", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(comUnidade));
    const r = await ibgeIndicadores({ indicador: "desemprego", campos: "Valor" });
    expect((r.structured as Record<string, unknown>).unidades).toEqual(sidraUnidades(comUnidade));
  });

  it("ibge_comparar: a tabela não tem coluna de unidade, o texto ganha a linha", async () => {
    mockFetch
      .mockResolvedValueOnce(
        mockResponse(
          sidraResponse(
            { MN: "Unidade de Medida", D1C: "Código do Município", D1N: "Município", V: "Valor" },
            { MN: "Pessoas", D1C: "3550308", D1N: "São Paulo", V: "12300000" },
            { MN: "Pessoas", D1C: "3304557", D1N: "Rio de Janeiro", V: "6700000" }
          )
        )
      )
      .mockResolvedValueOnce(mockResponse({ nome: "São Paulo" }))
      .mockResolvedValueOnce(mockResponse({ nome: "Rio de Janeiro" }));
    const r = await ibgeComparar({ localidades: "3550308,3304557" });
    expect((r.structured as Record<string, unknown>).unidades).toEqual([
      { variavel: null, nomeVariavel: null, unidade: "Pessoas", multiplicador: null },
    ]);
    expect(r.markdown).toContain("_Unidade de medida: Pessoas._");
  });
});

describe("unidadeComEscala (ibge_cidades, listagem de pesquisa)", () => {
  it("mostra o multiplicador da fonte quando ≠ 1", () => {
    expect(unidadeComEscala({ id: "R$", multiplicador: 1000 })).toBe("R$ (× 1.000)");
  });
  it("multiplicador 1 ou ausente: só a unidade; sem unidade: '-'", () => {
    expect(unidadeComEscala({ id: "pessoas", multiplicador: 1 })).toBe("pessoas");
    expect(unidadeComEscala({ id: "km²" })).toBe("km²");
    expect(unidadeComEscala(undefined)).toBe("-");
  });
});
