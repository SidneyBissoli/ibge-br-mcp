import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeCidades, cidadesOutputSchema } from "../src/tools/cidades.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function lastUrl(): string {
  return String(mockFetch.mock.calls.at(-1)?.[0]);
}

/** Builds a PesquisaResultado[] payload with a year->value map for one locality. */
function pesquisaResultado(res: Record<string, string | number | null>) {
  return [{ id: 1, res: [{ localidade: "3550308", res }] }];
}

const municipioLocalidade = {
  nome: "São Paulo",
  microrregiao: { mesorregiao: { UF: { nome: "São Paulo", sigla: "SP" } } },
};

describe("ibge_cidades", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("panorama", () => {
    it("requires a municipio code", async () => {
      const result = await ibgeCidades({ tipo: "panorama" });
      expect(result.markdown).toContain("ibge_cidades");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects a malformed municipio code", async () => {
      const result = await ibgeCidades({ tipo: "panorama", municipio: "123" });
      expect(result.markdown).toContain("municipio");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("fetches locality name then indicators and renders a table", async () => {
      // 1st fetch: locality lookup
      mockFetch.mockResolvedValueOnce(mockResponse(municipioLocalidade));
      // subsequent fetches: 8 panorama indicators (populacao..salario_medio)
      mockFetch.mockResolvedValueOnce(mockResponse(pesquisaResultado({ "2022": "11451999" })));
      mockFetch.mockResolvedValueOnce(mockResponse(pesquisaResultado({ "2021": "1521.11" })));
      mockFetch.mockResolvedValue(mockResponse(pesquisaResultado({})));

      const result = await ibgeCidades({ tipo: "panorama", municipio: "3550308" });

      expect(result.markdown).toContain("Panorama: São Paulo (SP)");
      expect(result.markdown).toContain("Código IBGE:** 3550308");
      expect(result.markdown).toContain("População estimada");
      // population formatted with thousands sep + " pessoas"
      expect(result.markdown).toContain("11.451.999 pessoas");
      expect(result.markdown).toContain("Ferramentas Relacionadas");
      // Structured output (1.2): typed indicators for the municipality.
      const s = result.structured as Record<string, unknown>;
      expect(s.tipo).toBe("panorama");
      expect(s.municipio).toBe("3550308");
      expect((s.indicadores as unknown[]).length).toBeGreaterThan(0);
      expect(cidadesOutputSchema.safeParse(result.structured).success).toBe(true);
    });

    it("reports empty result when no indicators are returned", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(municipioLocalidade));
      mockFetch.mockResolvedValue(mockResponse(pesquisaResultado({})));

      const result = await ibgeCidades({ tipo: "panorama", municipio: "3550308" });

      expect(result.markdown).toContain("Nenhum indicador encontrado");
    });

    it("falls back to the code when locality lookup fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 404: Not Found"));
      mockFetch.mockResolvedValueOnce(mockResponse(pesquisaResultado({ "2022": "11451999" })));
      mockFetch.mockResolvedValue(mockResponse(pesquisaResultado({})));

      const result = await ibgeCidades({ tipo: "panorama", municipio: "3550308" });

      expect(result.markdown).toContain("Panorama: 3550308");
    });
  });

  describe("indicador", () => {
    it("lists available indicators when no indicador given", async () => {
      const result = await ibgeCidades({ tipo: "indicador" });
      expect(result.markdown).toContain("Indicadores Disponíveis");
      expect(result.markdown).toContain("populacao");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("requires a municipio for a known alias", async () => {
      const result = await ibgeCidades({ tipo: "indicador", indicador: "populacao" });
      expect(result.markdown).toContain("municipio");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("renders a year/value table for a known alias", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(pesquisaResultado({ "2022": "11451999", "2021": "11400000", "-": "-" }))
      );

      const result = await ibgeCidades({
        tipo: "indicador",
        indicador: "populacao",
        municipio: "3550308",
      });

      expect(lastUrl()).toContain("/33/indicadores/29171/resultados/3550308");
      expect(result.markdown).toContain("População estimada");
      expect(result.markdown).toContain("2022");
      expect(result.markdown).toContain("11451999");
    });

    it("falls back to the indicator list for an unknown alias", async () => {
      const result = await ibgeCidades({
        tipo: "indicador",
        indicador: "nao_existe",
        municipio: "3550308",
      });
      expect(result.markdown).toContain("Indicadores Disponíveis");
    });

    it("reports empty result when the API returns nothing", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([]));
      const result = await ibgeCidades({
        tipo: "indicador",
        indicador: "idh",
        municipio: "3550308",
      });
      expect(result.markdown).toContain("Nenhum");
    });
  });

  describe("pesquisas", () => {
    it("lists principal pesquisas when no pesquisa id given", async () => {
      const result = await ibgeCidades({ tipo: "pesquisas" });
      expect(result.markdown).toContain("Pesquisas Disponíveis");
      expect(result.markdown).toContain("Cadastro Central de Empresas");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("fetches details and indicators for a specific pesquisa", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ id: "33", nome: "Cadastro Central de Empresas", periodicidade: "anual" })
      );
      mockFetch.mockResolvedValueOnce(
        mockResponse([
          { id: 29171, indicador: "População", unidade: { id: "pessoas" } },
          { id: 29168, indicador: "Densidade", unidade: { id: "hab/km2" } },
        ])
      );

      const result = await ibgeCidades({ tipo: "pesquisas", pesquisa: "33" });

      expect(result.markdown).toContain("Pesquisa: Cadastro Central de Empresas");
      expect(result.markdown).toContain("Periodicidade:** anual");
      expect(result.markdown).toContain("População");
    });

    it("surfaces an upstream error for a specific pesquisa", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));
      const result = await ibgeCidades({ tipo: "pesquisas", pesquisa: "33" });
      expect(result.markdown).toContain("Erro");
    });
  });

  describe("historico", () => {
    it("requires both municipio and indicador", async () => {
      const result = await ibgeCidades({ tipo: "historico", municipio: "3550308" });
      expect(result.markdown).toContain("municipio/indicador");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("renders a history table for a known alias", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(pesquisaResultado({ "2020": "100", "2021": "110", "2022": "120" }))
      );

      const result = await ibgeCidades({
        tipo: "historico",
        municipio: "3550308",
        indicador: "populacao",
      });

      expect(result.markdown).toContain("Histórico: População estimada");
      expect(result.markdown).toContain("2022");
      expect(result.markdown).toContain("120");
    });

    it("renders a history table for a raw numeric indicator id", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(pesquisaResultado({ "2022": "120" })));

      const result = await ibgeCidades({
        tipo: "historico",
        municipio: "3550308",
        indicador: "29171",
      });

      expect(lastUrl()).toContain("indicadores/29171/resultados/3550308");
      expect(result.markdown).toContain("Indicador 29171");
    });

    it("reports empty result when no data rows are returned", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([]));
      const result = await ibgeCidades({
        tipo: "historico",
        municipio: "3550308",
        indicador: "populacao",
      });
      expect(result.markdown).toContain("Nenhum");
    });
  });
});
