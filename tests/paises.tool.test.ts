import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgePaises } from "../src/tools/paises.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function lastUrl(): string {
  return String(mockFetch.mock.calls.at(-1)?.[0]);
}

const brasil = {
  id: { M49: 76, "ISO-3166-1-ALPHA-2": "BR", "ISO-3166-1-ALPHA-3": "BRA" },
  nome: { abreviado: "Brasil", "abreviado-EN": "Brazil", "abreviado-ES": "Brasil" },
  area: { total: "8515767.049" },
  localizacao: {
    regiao: { id: { M49: 19 }, nome: "Américas" },
    "sub-regiao": { id: { M49: 419 }, nome: "América Latina e Caribe" },
  },
  linguas: [{ nome: "Português" }],
  "unidades-monetarias": [
    { id: { "ISO-4217-ALPHA": "BRL", "ISO-4217-NUMERICO": "986" }, nome: "Real" },
  ],
  historico: "Texto histórico do Brasil.",
};

const argentina = {
  id: { M49: 32, "ISO-3166-1-ALPHA-2": "AR", "ISO-3166-1-ALPHA-3": "ARG" },
  nome: { abreviado: "Argentina" },
  localizacao: { regiao: { id: { M49: 19 }, nome: "Américas" } },
};

const franca = {
  id: { M49: 250, "ISO-3166-1-ALPHA-2": "FR", "ISO-3166-1-ALPHA-3": "FRA" },
  nome: { abreviado: "França" },
  localizacao: { regiao: { id: { M49: 150 }, nome: "Europa" } },
};

describe("ibge_paises", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("listar", () => {
    it("lists all countries in a table", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([brasil, argentina, franca]));

      const { markdown: result } = await ibgePaises({ tipo: "listar" });

      expect(result).toContain("Países");
      expect(result).toContain("Total:** 3 países");
      expect(result).toContain("Brasil");
      expect(result).toContain("Argentina");
      expect(result).toContain("Américas");
    });

    it("reports empty result when the API returns nothing", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([]));
      const { markdown: result } = await ibgePaises({ tipo: "listar" });
      expect(result).toContain("Nenhum");
    });

    it("filters by regiao (americas keeps only id 19)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([brasil, argentina, franca]));

      const { markdown: result } = await ibgePaises({ tipo: "listar", regiao: "americas" });

      expect(result).toContain("Região: americas");
      expect(result).toContain("Brasil");
      expect(result).toContain("Argentina");
      expect(result).not.toContain("França");
    });

    it("filters by busca substring (case-insensitive)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([brasil, argentina, franca]));

      const { markdown: result } = await ibgePaises({ tipo: "listar", busca: "bras" });

      expect(result).toContain('Busca: "bras"');
      expect(result).toContain("Brasil");
      expect(result).not.toContain("Argentina");
    });

    it("reports empty result when busca matches nothing", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([brasil, argentina, franca]));
      const { markdown: result } = await ibgePaises({ tipo: "listar", busca: "zzzzz" });
      expect(result).toContain('Nenhum país encontrado para "zzzzz"');
    });
  });

  describe("buscar", () => {
    it("requires a busca term", async () => {
      const { markdown: result } = await ibgePaises({ tipo: "buscar" });
      expect(result).toContain("termo de busca");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("delegates to listing with the search filter", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([brasil, argentina, franca]));
      const { markdown: result } = await ibgePaises({ tipo: "buscar", busca: "argent" });
      expect(result).toContain("Argentina");
      expect(result).not.toContain("Brasil");
    });
  });

  describe("detalhes", () => {
    it("requires a pais code", async () => {
      const { markdown: result } = await ibgePaises({ tipo: "detalhes" });
      expect(result).toContain("ISO-ALPHA-2");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("renders identification, location, area, languages, currency, history and indicators", async () => {
      // 1st fetch: country detail; 2nd fetch: indicators
      mockFetch.mockResolvedValueOnce(mockResponse([brasil]));
      mockFetch.mockResolvedValueOnce(
        mockResponse([
          {
            id: 77827,
            indicador: "População total",
            series: [{ pais: "BR", serie: { "2021": "213000000", "2020": "211000000" } }],
          },
        ])
      );

      const { markdown: result } = await ibgePaises({ tipo: "detalhes", pais: "br" });

      expect(lastUrl()).toContain("/indicadores/");
      expect(result).toContain("## Brasil");
      expect(result).toContain("Código M49:** 76");
      expect(result).toContain("ISO Alpha-2:** BR");
      expect(result).toContain("Américas");
      expect(result).toContain("km²");
      expect(result).toContain("Português");
      expect(result).toContain("Real (BRL)");
      expect(result).toContain("Texto histórico");
      expect(result).toContain("População total:** 213000000 (2021)");
      expect(result).toContain("Ferramentas Relacionadas");
    });

    it("still renders details when the indicators fetch fails", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([brasil]));
      mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));

      const { markdown: result } = await ibgePaises({ tipo: "detalhes", pais: "BR" });

      expect(result).toContain("## Brasil");
      expect(result).toContain("Ferramentas Relacionadas");
    });

    it("returns notFound for an unknown country", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([]));
      const { markdown: result } = await ibgePaises({ tipo: "detalhes", pais: "ZZ" });
      expect(result).toContain("não encontrado");
    });
  });

  describe("indicadores", () => {
    it("lists available indicators without calling the API", async () => {
      const { markdown: result } = await ibgePaises({ tipo: "indicadores" });
      expect(result).toContain("Indicadores de Países Disponíveis");
      expect(result).toContain("População total");
      expect(result).toContain("pib_per_capita");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("errors", () => {
    it("surfaces upstream HTTP errors for listing", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));
      const { markdown: result } = await ibgePaises({ tipo: "listar" });
      expect(result).toContain("Erro");
    });
  });
});
