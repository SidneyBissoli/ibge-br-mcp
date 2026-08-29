import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeComparar, compararOutputSchema } from "../src/tools/comparar.js";
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

      expect(result.markdown).toContain("Indicadores Disponíveis para Comparação");
      expect(result.markdown).toContain("populacao");
      expect(result.markdown).toContain("pib");
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

      expect(result.markdown).toContain("pelo menos 2 localidades");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects more than 10 localities", async () => {
      const many = Array.from({ length: 11 }, (_, i) => `350030${i}`).join(",");
      const result = await ibgeComparar({
        localidades: many,
        indicador: "populacao",
        formato: "tabela",
      });

      expect(result.markdown).toContain("Máximo de 10 localidades");
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

      expect(result.markdown).toContain("Comparação: População");
      expect(result.markdown).toContain("São Paulo");
      expect(result.markdown).toContain("Rio de Janeiro");
      expect(result.markdown).toContain("Estatísticas");
      expect(result.markdown).toContain("Maior");
      // value formatted with thousands separators
      expect(result.markdown).toContain("12.300.000");
      // Structured output (1.2): typed comparison list + statistics.
      const s = result.structured as Record<string, unknown>;
      const locs = s.localidades as Array<{ nome: string; valor: number }>;
      expect(locs.map((l) => l.nome)).toContain("São Paulo");
      expect(s.estatisticas).toBeDefined();
      expect(compararOutputSchema.safeParse(result.structured).success).toBe(true);
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
      expect(result.markdown).toContain("SP");
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
      expect(result.markdown.indexOf("São Paulo")).toBeLessThan(
        result.markdown.indexOf("Rio de Janeiro")
      );
      // ranking order reflected in the structured payload too
      const locs = (result.structured as Record<string, unknown>).localidades as Array<{
        nome: string;
      }>;
      expect(locs[0].nome).toBe("São Paulo");
    });
  });

  // Regressões de 2026-08-28, medidas contra o servidor no ar.
  describe("shape real do SIDRA", () => {
    // A resposta real traz "Unidade de Medida (Código)" ANTES de
    // "Município (Código)". Pegar a primeira coluna com "código" no rótulo
    // marcava toda localidade com o código da UNIDADE (28 = hab/km²,
    // 40 = Mil Reais), e não com o código IBGE dela.
    it("usa o código da LOCALIDADE, não o da unidade de medida", async () => {
      const real = sidraResponse(
        {
          NC: "Nível Territorial (Código)",
          MC: "Unidade de Medida (Código)",
          MN: "Unidade de Medida",
          V: "Valor",
          D1C: "Município (Código)",
          D1N: "Município",
        },
        {
          NC: "6",
          MC: "28",
          MN: "Habitante por quilômetro quadrado",
          V: "7528.26",
          D1C: "3550308",
          D1N: "São Paulo - SP",
        },
        {
          NC: "6",
          MC: "28",
          MN: "Habitante por quilômetro quadrado",
          V: "181.01",
          D1C: "1302603",
          D1N: "Manaus - AM",
        }
      );

      mockFetch
        .mockResolvedValueOnce(mockResponse(real))
        .mockResolvedValueOnce(mockResponse({ nome: "São Paulo" }))
        .mockResolvedValueOnce(mockResponse({ nome: "Manaus" }));

      const result = await ibgeComparar({
        localidades: "3550308,1302603",
        indicador: "densidade",
        formato: "tabela",
      });

      const locs = (result.structured as Record<string, unknown>).localidades as Array<{
        codigo: string;
      }>;
      expect(locs.map((l) => l.codigo)).toEqual(["3550308", "1302603"]);
      expect(locs.map((l) => l.codigo)).not.toContain("28");
      expect(compararOutputSchema.safeParse(result.structured).success).toBe(true);
    });

    // Marcador de ausência do SIDRA virava 0 e entrava na média e no ranking
    // como se fosse medição — errar alto, não plausível.
    it("não converte marcador de ausência em zero", async () => {
      const comAusencia = sidraResponse(
        { D1C: "Município (Código)", D1N: "Município", V: "Valor" },
        { D1C: "3550308", D1N: "São Paulo", V: "12300000" },
        { D1C: "3304557", D1N: "Rio de Janeiro", V: "6700000" },
        { D1C: "1400100", D1N: "Boa Vista", V: "..." }
      );

      mockFetch
        .mockResolvedValueOnce(mockResponse(comAusencia))
        .mockResolvedValueOnce(mockResponse({ nome: "São Paulo" }))
        .mockResolvedValueOnce(mockResponse({ nome: "Rio de Janeiro" }))
        .mockResolvedValueOnce(mockResponse({ nome: "Boa Vista" }));

      const result = await ibgeComparar({
        localidades: "3550308,3304557,1400100",
        indicador: "populacao",
        formato: "ranking",
      });

      const s = result.structured as Record<string, unknown>;
      const locs = s.localidades as Array<{ nome: string; valor: number | null }>;

      const semValor = locs.find((l) => l.nome === "Boa Vista");
      expect(semValor?.valor).toBeNull();
      expect(locs.map((l) => l.valor)).not.toContain(0);
      // ausência vai para o fim do ranking, não para o fundo da escala
      expect(locs.at(-1)?.nome).toBe("Boa Vista");

      // e fica fora das estatísticas
      const est = s.estatisticas as { menor: number; media: number };
      expect(est.menor).toBe(6700000);
      expect(est.media).toBe((12300000 + 6700000) / 2);
      expect(compararOutputSchema.safeParse(result.structured).success).toBe(true);
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

      expect(result.markdown).toContain("```json");
      expect(result.markdown).toContain("Município");
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

      expect(result.markdown).toContain("Nenhum dado encontrado");
      expect(result.markdown).toContain("ibge_geocodigo");
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

      expect(result.markdown).toContain("Erro na Comparação");
      expect(result.markdown).toContain("HTTP 500");
    });
  });
});
