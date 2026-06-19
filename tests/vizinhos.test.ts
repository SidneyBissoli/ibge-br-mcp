import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeVizinhos } from "../src/tools/vizinhos.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Minimal Municipio shape used by the tool
function mun(id: number, nome: string, sigla = "SP") {
  return {
    id,
    nome,
    microrregiao: { mesorregiao: { UF: { sigla } } },
  };
}

const municipioMatriz = mun(3550308, "São Paulo");

// State municipality list — several share the mesoregion prefix 3515 (4-digit
// prefix of 3550308 is "3550", so neighbors must start with "3550")
const stateMunicipios = [
  mun(3550308, "São Paulo"),
  mun(3550100, "São Lourenço da Serra"),
  mun(3550209, "São Pedro"),
  mun(3304557, "Rio de Janeiro", "RJ"), // different prefix, excluded
];

const malhaFeature = { type: "Feature", geometry: { type: "MultiPolygon", coordinates: [] } };

describe("ibge_vizinhos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("by code", () => {
    it("returns neighbors in the same mesoregion", async () => {
      // 1. /municipios/3550308  2. /estados/35/municipios
      // 3. malha (fetchWithRetry)  4. /estados/35/municipios (cache hit)
      mockFetch
        .mockResolvedValueOnce(mockResponse(municipioMatriz))
        .mockResolvedValueOnce(mockResponse(stateMunicipios))
        .mockResolvedValueOnce(mockResponse(malhaFeature));

      const result = await ibgeVizinhos({ municipio: "3550308", incluir_dados: false });

      expect(result).toContain("Municípios Próximos: São Paulo");
      expect(result).toContain("**Código IBGE:** 3550308");
      // same-prefix municipalities show up, the matriz and the RJ one don't
      expect(result).toContain("São Lourenço da Serra");
      expect(result).toContain("São Pedro");
      expect(result).not.toContain("Rio de Janeiro");
      expect(result).toContain("mesma mesorregião");
    });

    it("enriches with population when incluir_dados=true", async () => {
      // base 3 fetches, then one SIDRA population fetch per neighbor (2 neighbors)
      mockFetch
        .mockResolvedValueOnce(mockResponse(municipioMatriz))
        .mockResolvedValueOnce(mockResponse(stateMunicipios))
        .mockResolvedValueOnce(mockResponse(malhaFeature))
        .mockResolvedValueOnce(mockResponse([{ V: "Valor" }, { V: "10000" }]))
        .mockResolvedValueOnce(mockResponse([{ V: "Valor" }, { V: "20000" }]));

      const result = await ibgeVizinhos({ municipio: "3550308", incluir_dados: true });

      expect(result).toContain("População");
      expect(result).toContain("10.000");
    });

    it("falls back when the malha fetch fails (no neighbors)", async () => {
      // municipio ok, state list ok, malha rejects -> getVizinhosFromMalha returns []
      mockFetch
        .mockResolvedValueOnce(mockResponse(municipioMatriz))
        .mockResolvedValueOnce(mockResponse(stateMunicipios))
        .mockRejectedValueOnce(new Error("HTTP 500: boom"));

      const result = await ibgeVizinhos({ municipio: "3550308" });

      expect(result).toContain("Municípios Vizinhos: São Paulo");
      expect(result).toContain("Não foi possível determinar os municípios vizinhos");
    });

    it("reports a not-found municipality when the lookup fails", async () => {
      // Code with a valid UF prefix (35) so it passes isValidIbgeCode, but the
      // lookup 404s -> getMunicipioInfo swallows the error and returns null.
      mockFetch.mockRejectedValueOnce(new Error("HTTP 404: Not Found"));
      const result = await ibgeVizinhos({ municipio: "3599999" });
      expect(result).toContain("não encontrado");
    });

    it("rejects a 7-digit code with an invalid UF prefix", async () => {
      const result = await ibgeVizinhos({ municipio: "9999999" });
      expect(result).toContain("inválido");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("by name + uf", () => {
    it("requires uf when searching by name", async () => {
      const result = await ibgeVizinhos({ municipio: "Campinas" });
      expect(result).toContain("uf");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects an unrecognizable uf", async () => {
      const result = await ibgeVizinhos({ municipio: "Campinas", uf: "ZZ" });
      expect(result).toContain("uf");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("resolves a municipality by name and lists its neighbors", async () => {
      // 1. /estados/35/municipios (findMunicipioByName)
      // 2. /estados/35/municipios (getMunicipiosByUf — cache hit, same url)
      // 3. malha  (4. cache hit)
      mockFetch
        .mockResolvedValueOnce(mockResponse(stateMunicipios))
        .mockResolvedValueOnce(mockResponse(malhaFeature));

      const result = await ibgeVizinhos({ municipio: "São Paulo", uf: "SP" });

      expect(result).toContain("Municípios Próximos: São Paulo");
      expect(result).toContain("São Pedro");
    });

    it("accepts uf as sigla, name or code interchangeably", async () => {
      // sigla SP -> /estados/35/...
      mockFetch
        .mockResolvedValueOnce(mockResponse(stateMunicipios))
        .mockResolvedValueOnce(mockResponse(malhaFeature));
      await ibgeVizinhos({ municipio: "São Paulo", uf: "SP" });
      expect(String(mockFetch.mock.calls[0]?.[0])).toContain("/estados/35/municipios");

      cache.clear();
      vi.clearAllMocks();
      // numeric code 35
      mockFetch
        .mockResolvedValueOnce(mockResponse(stateMunicipios))
        .mockResolvedValueOnce(mockResponse(malhaFeature));
      await ibgeVizinhos({ municipio: "São Paulo", uf: "35" });
      expect(String(mockFetch.mock.calls[0]?.[0])).toContain("/estados/35/municipios");

      cache.clear();
      vi.clearAllMocks();
      // full name
      mockFetch
        .mockResolvedValueOnce(mockResponse(stateMunicipios))
        .mockResolvedValueOnce(mockResponse(malhaFeature));
      await ibgeVizinhos({ municipio: "São Paulo", uf: "São Paulo" });
      expect(String(mockFetch.mock.calls[0]?.[0])).toContain("/estados/35/municipios");
    });

    it("reports not-found when the named municipality is absent", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(stateMunicipios));
      const result = await ibgeVizinhos({ municipio: "Xyzqqq", uf: "SP" });
      expect(result).toContain("não encontrado");
    });
  });
});
