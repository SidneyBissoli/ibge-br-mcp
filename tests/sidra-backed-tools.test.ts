import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeCenso, censoOutputSchema } from "../src/tools/censo.js";
import { ibgeIndicadores, indicadoresOutputSchema } from "../src/tools/indicadores.js";
import { ibgeDatasaude, datasaudeOutputSchema } from "../src/tools/datasaude.js";
import { cache } from "../src/cache.js";
import { mockResponse, sidraResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const sidraPop = sidraResponse(
  { D1N: "Unidade da Federação", D2N: "Ano", V: "Valor" },
  { D1N: "São Paulo", D2N: "2022", V: "44411238" }
);

describe("ibge_censo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats a census table for a known theme", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sidraPop));

    const result = await ibgeCenso({ tema: "populacao", nivel_territorial: "3" });

    expect(result.markdown).toContain("Censo Demográfico");
    expect(result.markdown).toContain("Tabela SIDRA:");
    expect(result.markdown).toContain("São Paulo");
    expect(result.markdown).toContain("44.411.238");
    // Structured output (1.2): typed records validated against the outputSchema.
    const s = result.structured as Record<string, unknown>;
    expect(s.tema).toBe("populacao");
    expect(s.colunas).toContain("Unidade da Federação");
    expect((s.registros as Record<string, string>[])[0]["Unidade da Federação"]).toBe("São Paulo");
    expect(censoOutputSchema.safeParse(result.structured).success).toBe(true);
  });

  it("returns embedded JSON when formato='json'", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sidraPop));

    const result = await ibgeCenso({ tema: "populacao", formato: "json" });

    expect(result.markdown).toContain("```json");
    expect(result.markdown).toContain('"São Paulo"');
  });

  it("lists available tables for tema='listar' without calling the API", async () => {
    const result = await ibgeCenso({ tema: "listar" });

    expect(result.markdown).toContain("Tabelas do Censo");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("distinguishes an empty result from an upstream failure", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));

    const result = await ibgeCenso({ tema: "populacao" });

    expect(result.markdown).toContain("Nenhum dado encontrado");
    expect(result.markdown).not.toContain("Código HTTP");
  });

  it("surfaces an upstream error gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));

    const result = await ibgeCenso({ tema: "populacao" });

    expect(result.markdown).toContain("Erro");
  });
});

describe("ibge_indicadores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists indicators when called with no indicator", async () => {
    const result = await ibgeIndicadores({});

    expect(result.markdown.length).toBeGreaterThan(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("formats a known indicator", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sidraPop));

    const result = await ibgeIndicadores({ indicador: "desemprego", nivel_territorial: "3" });

    expect(result.markdown).toContain("Tabela SIDRA:");
    expect(result.markdown).toContain("São Paulo");
    const s = result.structured as Record<string, unknown>;
    expect(s.indicador).toBe("desemprego");
    expect(s.totalRegistros).toBe(1);
    expect(indicadoresOutputSchema.safeParse(result.structured).success).toBe(true);
  });

  it("returns embedded JSON when formato='json'", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sidraPop));

    const result = await ibgeIndicadores({
      indicador: "desemprego",
      nivel_territorial: "3",
      formato: "json",
    });

    expect(result.markdown).toContain("```json");
  });

  it("reports an unknown indicator without calling the API", async () => {
    const result = await ibgeIndicadores({ indicador: "inexistente-xyz" });

    expect(result.markdown).toContain("não encontrado");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reports 'no data' distinctly for a valid indicator with an empty response", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));

    const result = await ibgeIndicadores({ indicador: "desemprego", nivel_territorial: "3" });

    expect(result.markdown).toContain("Nenhum dado encontrado");
  });
});

describe("ibge_datasaude", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists health indicators for indicador='listar' without calling the API", async () => {
    const result = await ibgeDatasaude({ indicador: "listar" });

    expect(result.markdown).toContain("Indicadores de Saúde");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("formats a known health indicator", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sidraPop));

    const result = await ibgeDatasaude({ indicador: "esperanca_vida", nivel_territorial: "3" });

    expect(result.markdown).toContain("**Fonte:**");
    expect(result.markdown).toContain("São Paulo");
    const s = result.structured as Record<string, unknown>;
    expect(s.indicador).toBe("esperanca_vida");
    expect(datasaudeOutputSchema.safeParse(result.structured).success).toBe(true);
  });

  it("reports an unknown indicator without calling the API", async () => {
    const result = await ibgeDatasaude({ indicador: "inexistente-xyz" });

    expect(result.markdown).toContain("não encontrado");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("distinguishes an empty result from an upstream failure", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));

    const result = await ibgeDatasaude({ indicador: "esperanca_vida", nivel_territorial: "3" });

    expect(result.markdown).toContain("Nenhum dado encontrado");
    expect(result.markdown).not.toContain("Código HTTP");
  });

  it("surfaces an upstream error gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("HTTP 500: Internal Server Error"));

    const result = await ibgeDatasaude({ indicador: "esperanca_vida", nivel_territorial: "3" });

    expect(result.markdown).toContain("Erro");
  });
});
