import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeComparar } from "../src/tools/comparar.js";
import { cache } from "../src/cache.js";
import { mockResponse, sidraResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function lastUrl(): string {
  return String(mockFetch.mock.calls.at(-1)?.[0]);
}

// SIDRA-shaped population data for two municipalities.
const popData = sidraResponse(
  {
    D1C: "Código do Município",
    D1N: "Município",
    V: "Valor",
  },
  { D1C: "3550308", D1N: "São Paulo", V: "12300000" },
  { D1C: "3304557", D1N: "Rio de Janeiro", V: "6700000" }
);

describe("ibge_comparar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("listar mode", () => {
    it("lists available indicators without calling the API", async () => {
      const result = await ibgeComparar({
        localidades: "",
        indicador: "listar",
        formato: "tabela",
      });

      expect(result).toContain("Indicadores Disponíveis para Comparação");
      expect(result).toContain("populacao");
      expect(result).toContain("pib");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("input validation", () => {
    it("requires at least 2 localities", async () => {
      const result = await ibgeComparar({
        localidades: "3550308",
        indicador: "populacao",
        formato: "tabela",
      });

      expect(result).toContain("pelo menos 2 localidades");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects more than 10 localities", async () => {
      const many = Array.from({ length: 11 }, (_, i) => `350030${i}`).join(",");
      const result = await ibgeComparar({
        localidades: many,
        indicador: "populacao",
        formato: "tabela",
      });

      expect(result).toContain("Máximo de 10 localidades");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("happy path (municipalities)", () => {
    it("builds a SIDRA n6 query and renders a comparison table", async () => {
      // 1st fetch: SIDRA data. 2nd & 3rd: locality name lookups.
      mockFetch
        .mockResolvedValueOnce(mockResponse(popData))
        .mockResolvedValueOnce(mockResponse({ nome: "São Paulo" }))
        .mockResolvedValueOnce(mockResponse({ nome: "Rio de Janeiro" }));

      const result = await ibgeComparar({
        localidades: "3550308,3304557",
        indicador: "populacao",
        formato: "tabela",
      });

      // First call is the SIDRA url
      const sidraUrl = String(mockFetch.mock.calls[0][0]);
      expect(sidraUrl).toContain("/t/6579");
      expect(sidraUrl).toContain("/n6/3550308,3304557");

      expect(result).toContain("Comparação: População");
      expect(result).toContain("São Paulo");
      expect(result).toContain("Rio de Janeiro");
      expect(result).toContain("Estatísticas");
      expect(result).toContain("Maior");
      // value formatted with thousands separators
      expect(result).toContain("12.300.000");
    });

    it("uses n3 (estados) when localities are 2-digit codes", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            sidraResponse(
              { D1C: "Código da UF", D1N: "Unidade da Federação", V: "Valor" },
              { D1C: "35", D1N: "São Paulo", V: "44000000" },
              { D1C: "33", D1N: "Rio de Janeiro", V: "17000000" }
            )
          )
        )
        .mockResolvedValueOnce(mockResponse({ nome: "São Paulo", sigla: "SP" }))
        .mockResolvedValueOnce(mockResponse({ nome: "Rio de Janeiro", sigla: "RJ" }));

      const result = await ibgeComparar({
        localidades: "35,33",
        indicador: "populacao",
        formato: "tabela",
      });

      const sidraUrl = String(mockFetch.mock.calls[0][0]);
      expect(sidraUrl).toContain("/n3/35,33");
      // name lookup hits /estados/
      const nameUrl = String(mockFetch.mock.calls[1][0]);
      expect(nameUrl).toContain("/estados/");
      // sigla preferred over nome
      expect(result).toContain("SP");
    });
  });

  describe("ranking format", () => {
    it("sorts descending by value", async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(popData))
        .mockResolvedValueOnce(mockResponse({ nome: "São Paulo" }))
        .mockResolvedValueOnce(mockResponse({ nome: "Rio de Janeiro" }));

      const result = await ibgeComparar({
        localidades: "3550308,3304557",
        indicador: "populacao",
        formato: "ranking",
      });

      // São Paulo (larger) should appear before Rio de Janeiro
      expect(result.indexOf("São Paulo")).toBeLessThan(result.indexOf("Rio de Janeiro"));
    });
  });

  describe("json format", () => {
    it("emits a JSON code block", async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(popData))
        .mockResolvedValueOnce(mockResponse({ nome: "São Paulo" }))
        .mockResolvedValueOnce(mockResponse({ nome: "Rio de Janeiro" }));

      const result = await ibgeComparar({
        localidades: "3550308,3304557",
        indicador: "populacao",
        formato: "json",
      });

      expect(result).toContain("```json");
      expect(result).toContain("Município");
    });
  });

  describe("empty result", () => {
    it("reports no data when only the header row is returned", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(sidraResponse({ D1N: "Município", V: "Valor" }))
      );

      const result = await ibgeComparar({
        localidades: "3550308,3304557",
        indicador: "populacao",
        formato: "tabela",
      });

      expect(result).toContain("Nenhum dado encontrado");
      expect(result).toContain("ibge_geocodigo");
    });
  });

  describe("errors", () => {
    it("formats an upstream error in the comparison context", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));

      const result = await ibgeComparar({
        localidades: "3550308,3304557",
        indicador: "populacao",
        formato: "tabela",
      });

      expect(result).toContain("Erro na Comparação");
      expect(result).toContain("HTTP 500");
    });
  });
});
