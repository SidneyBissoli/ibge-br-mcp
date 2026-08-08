/**
 * Tool-level tests of the D2 statistics mode (`estatisticas=true`) on the four
 * SIDRA-backed tabular tools. Upstream is mocked — never the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeSidra, sidraOutputSchema } from "../src/tools/sidra.js";
import { ibgeCenso, censoOutputSchema } from "../src/tools/censo.js";
import { ibgeIndicadores, indicadoresOutputSchema } from "../src/tools/indicadores.js";
import { ibgeDatasaude, datasaudeOutputSchema } from "../src/tools/datasaude.js";
import { cache } from "../src/cache.js";
import { mockResponse, sidraResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const popByUf = sidraResponse(
  { D1N: "Unidade da Federação", D2N: "Ano", V: "Valor" },
  { D1N: "São Paulo", D2N: "2022", V: "44411238" },
  { D1N: "Rio de Janeiro", D2N: "2022", V: "16055174" },
  { D1N: "Minas Gerais", D2N: "2022", V: "20539989" }
);

beforeEach(() => {
  vi.clearAllMocks();
  cache.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ibge_sidra — estatisticas=true", () => {
  it("returns the statistics block over ALL rows, with empty registros", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    const result = await ibgeSidra({ tabela: "6579", nivel_territorial: "3", estatisticas: true });

    expect(result.isError).toBeUndefined();
    const s = result.structured as Record<string, unknown>;
    expect(s.registros).toEqual([]);
    expect(s.totalRegistros).toBe(3);
    const e = s.estatisticas as Record<string, unknown>;
    expect(e.colunaValor).toBe("Valor");
    expect(e.registrosConsiderados).toBe(3);
    const d = e.distribuicao as Record<string, unknown>;
    expect(d.n).toBe(3);
    expect(d.maximo).toBe(44411238);
    const top = e.top as Array<Record<string, unknown>>;
    expect(top[0]["Unidade da Federação"]).toBe("São Paulo");
    expect(sidraOutputSchema.safeParse(result.structured).success).toBe(true);
    expect(result.markdown).toContain("Estatísticas");
  });

  it("groups by a column label with agruparPor", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    const result = await ibgeSidra({
      tabela: "6579",
      nivel_territorial: "3",
      estatisticas: true,
      agruparPor: "Ano",
    });

    const e = (result.structured as Record<string, unknown>).estatisticas as Record<
      string,
      unknown
    >;
    expect(e.agrupadoPor).toBe("Ano");
    expect(e.totalGrupos).toBe(1);
    expect(sidraOutputSchema.safeParse(result.structured).success).toBe(true);
  });

  it("reports a pedagogical error for an unknown agruparPor column", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    const result = await ibgeSidra({
      tabela: "6579",
      estatisticas: true,
      agruparPor: "Municipio",
    });

    expect(result.isError).toBe(true);
    expect(result.markdown).toContain("Colunas disponíveis");
  });
});

describe("ibge_censo — estatisticas=true", () => {
  it("returns the statistics block and validates against the outputSchema", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    const result = await ibgeCenso({
      ano: "2022",
      tema: "populacao",
      nivel_territorial: "3",
      estatisticas: true,
    });

    expect(result.isError).toBeUndefined();
    const s = result.structured as Record<string, unknown>;
    expect(s.registros).toEqual([]);
    expect((s.estatisticas as Record<string, unknown>).registrosConsiderados).toBe(3);
    expect(censoOutputSchema.safeParse(result.structured).success).toBe(true);
    expect(result.markdown).toContain("Censo Demográfico");
    expect(result.markdown).toContain("Estatísticas");
  });
});

describe("ibge_indicadores — estatisticas=true", () => {
  it("returns the statistics block and validates against the outputSchema", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    const result = await ibgeIndicadores({
      indicador: "desemprego",
      nivel_territorial: "3",
      estatisticas: true,
    });

    expect(result.isError).toBeUndefined();
    const s = result.structured as Record<string, unknown>;
    expect(s.registros).toEqual([]);
    expect((s.estatisticas as Record<string, unknown>).colunaValor).toBe("Valor");
    expect(indicadoresOutputSchema.safeParse(result.structured).success).toBe(true);
  });
});

describe("ibge_datasaude — estatisticas=true", () => {
  it("returns the statistics block and validates against the outputSchema", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    const result = await ibgeDatasaude({
      indicador: "esperanca_vida",
      nivel_territorial: "3",
      estatisticas: true,
    });

    expect(result.isError).toBeUndefined();
    const s = result.structured as Record<string, unknown>;
    expect(s.registros).toEqual([]);
    expect((s.estatisticas as Record<string, unknown>).registrosConsiderados).toBe(3);
    expect(datasaudeOutputSchema.safeParse(result.structured).success).toBe(true);
  });
});
