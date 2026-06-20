import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeGeocodigo } from "../src/tools/geocodigo.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function lastUrl(): string {
  return String(mockFetch.mock.calls.at(-1)?.[0]);
}

// IBGE /municipios/{id} shape (full hierarchy)
const municipioSP = {
  id: 3550308,
  nome: "São Paulo",
  microrregiao: {
    id: 35061,
    nome: "São Paulo",
    mesorregiao: {
      id: 3515,
      nome: "Metropolitana de São Paulo",
      UF: {
        id: 35,
        sigla: "SP",
        nome: "São Paulo",
        regiao: { id: 3, sigla: "SE", nome: "Sudeste" },
      },
    },
  },
  "regiao-imediata": {
    id: 350001,
    nome: "São Paulo",
    "regiao-intermediaria": { id: 3501, nome: "São Paulo" },
  },
};

describe("ibge_geocodigo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("decode by code", () => {
    it("decodes a region code (1 digit) without calling the API", async () => {
      const { markdown: result } = await ibgeGeocodigo({ codigo: "3" });
      expect(result).toContain("Região: Sudeste");
      expect(result).toContain("São Paulo");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects an invalid region code", async () => {
      const { markdown: result } = await ibgeGeocodigo({ codigo: "9" });
      expect(result).toContain("Código de região inválido");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("decodes a UF code (2 digits) without calling the API", async () => {
      const { markdown: result } = await ibgeGeocodigo({ codigo: "35" });
      expect(result).toContain("Estado: São Paulo");
      expect(result).toContain("Sigla:");
      expect(result).toContain("SP");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects an invalid UF code", async () => {
      const { markdown: result } = await ibgeGeocodigo({ codigo: "99" });
      expect(result).toContain("Código de UF inválido");
    });

    it("decodes a municipality code (7 digits) via the localidades API", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(municipioSP));
      const { markdown: result } = await ibgeGeocodigo({ codigo: "3550308" });
      expect(lastUrl()).toContain("/municipios/3550308");
      expect(result).toContain("Município: São Paulo");
      expect(result).toContain("Hierarquia Geográfica");
      expect(result).toContain("355030"); // SIDRA 6-digit code
      expect(result).toContain("Região Imediata");
    });

    it("handles a not-found municipality gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 404: Not Found"));
      const { markdown: result } = await ibgeGeocodigo({ codigo: "9999999" });
      expect(result).toContain("Município não encontrado");
    });

    it("decodes a district code (9 digits)", async () => {
      const distrito = {
        id: 355030805,
        nome: "Sé",
        municipio: municipioSP,
      };
      mockFetch.mockResolvedValueOnce(mockResponse(distrito));
      const { markdown: result } = await ibgeGeocodigo({ codigo: "355030805" });
      expect(lastUrl()).toContain("/distritos/355030805");
      expect(result).toContain("Distrito: Sé");
    });

    it("handles a not-found district gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 404: Not Found"));
      const { markdown: result } = await ibgeGeocodigo({ codigo: "999999999" });
      expect(result).toContain("Distrito não encontrado");
    });

    it("rejects a code with an invalid number of digits", async () => {
      const { markdown: result } = await ibgeGeocodigo({ codigo: "12345" });
      expect(result).toContain("Código IBGE inválido");
    });
  });

  describe("search by name", () => {
    it("resolves a state name directly without calling the API", async () => {
      const { markdown: result } = await ibgeGeocodigo({ nome: "Sudeste" });
      expect(result).toContain("Região: Sudeste");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("resolves a state sigla directly", async () => {
      const { markdown: result } = await ibgeGeocodigo({ nome: "RJ" });
      expect(result).toContain("Estado: Rio de Janeiro");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns a list when multiple municipalities match", async () => {
      const municipios = [
        { id: 3100104, nome: "Santa Rita do Sapucaí" },
        { id: 3100203, nome: "Santa Rita de Caldas" },
      ];
      mockFetch.mockResolvedValueOnce(mockResponse(municipios));
      const { markdown: result } = await ibgeGeocodigo({ nome: "Santa Rita" });
      expect(result).toContain('Resultados para "Santa Rita"');
      expect(result).toContain("Santa Rita do Sapucaí");
      expect(result).toContain("Encontrados 2 municípios");
    });

    it("returns detailed info for a single municipality match (second fetch)", async () => {
      // First fetch: municipality list filtered by name; second: decodeMunicipio
      mockFetch
        .mockResolvedValueOnce(mockResponse([{ id: 3550308, nome: "São Paulo" }]))
        .mockResolvedValueOnce(mockResponse(municipioSP));
      const { markdown: result } = await ibgeGeocodigo({ nome: "São Paulo", uf: "SP" });
      expect(result).toContain("Município: São Paulo");
      expect(result).toContain("Hierarquia Geográfica");
    });

    it("restricts the search to a UF, accepting sigla / name / code interchangeably", async () => {
      // Use a non-matching name so exactly one fetch (the list) is consumed each
      // iteration; we only care that the UF was resolved into the endpoint.
      // uf as sigla
      mockFetch.mockResolvedValueOnce(mockResponse([{ id: 3304557, nome: "Rio de Janeiro" }]));
      await ibgeGeocodigo({ nome: "Zzzqqq", uf: "RJ" });
      expect(String(mockFetch.mock.calls[0]?.[0])).toContain("/estados/33/municipios");

      cache.clear();
      vi.clearAllMocks();
      // uf as numeric code
      mockFetch.mockResolvedValueOnce(mockResponse([{ id: 3304557, nome: "Rio de Janeiro" }]));
      await ibgeGeocodigo({ nome: "Zzzqqq", uf: "33" });
      expect(String(mockFetch.mock.calls[0]?.[0])).toContain("/estados/33/municipios");

      cache.clear();
      vi.clearAllMocks();
      // uf as full name
      mockFetch.mockResolvedValueOnce(mockResponse([{ id: 3304557, nome: "Rio de Janeiro" }]));
      await ibgeGeocodigo({ nome: "Zzzqqq", uf: "Rio de Janeiro" });
      expect(String(mockFetch.mock.calls[0]?.[0])).toContain("/estados/33/municipios");
    });

    it("reports no matches when nothing is found", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([{ id: 3550308, nome: "São Paulo" }]));
      const { markdown: result } = await ibgeGeocodigo({ nome: "Xyzqqq" });
      expect(result).toContain("Nenhuma localidade encontrada");
    });

    it("surfaces an upstream error during name search", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));
      const { markdown: result } = await ibgeGeocodigo({ nome: "Algumacoisa" });
      expect(result).toContain("Erro");
    });
  });

  describe("help", () => {
    it("shows help when no input is given", async () => {
      const { markdown: result } = await ibgeGeocodigo({});
      expect(result).toContain("Decodificador de códigos IBGE");
      expect(result).toContain("Estrutura dos códigos IBGE");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
