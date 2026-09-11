import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeMalhas } from "../src/tools/malhas.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const featureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [] },
      properties: { codarea: "35", nome: "São Paulo" },
    },
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [] },
      properties: { codarea: "33", nome: "Rio de Janeiro" },
    },
  ],
};

const singleFeature = {
  type: "Feature",
  geometry: { type: "MultiPolygon", coordinates: [] },
  properties: { codarea: "3550308", nome: "São Paulo" },
};

function lastUrl(): string {
  return String(mockFetch.mock.calls.at(-1)?.[0]);
}

describe("ibge_malhas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("endpoint routing by localidade", () => {
    it("routes BR to /paises/BR", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));
      await ibgeMalhas({ localidade: "BR" });
      expect(lastUrl()).toContain("/paises/BR");
    });

    it("routes a state sigla to /estados/{sigla}", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(singleFeature));
      await ibgeMalhas({ localidade: "SP" });
      expect(lastUrl()).toContain("/estados/SP");
    });

    it("routes a 2-digit code to /estados/{code}", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(singleFeature));
      await ibgeMalhas({ localidade: "35" });
      expect(lastUrl()).toContain("/estados/35");
    });

    it("routes a 7-digit code to /municipios/{code}", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(singleFeature));
      await ibgeMalhas({ localidade: "3550308" });
      expect(lastUrl()).toContain("/municipios/3550308");
    });

    it("uses an explicit tipo when provided", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));
      await ibgeMalhas({ localidade: "BR", tipo: "regioes" });
      expect(lastUrl()).toContain("/regioes/BR");
    });
  });

  describe("query parameters", () => {
    it("maps geojson to its mime type and omits resolucao=0", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));
      await ibgeMalhas({ localidade: "BR", formato: "geojson", resolucao: "0" });
      const url = lastUrl();
      expect(url).toContain(encodeURIComponent("application/vnd.geo+json"));
      expect(url).not.toContain("resolucao=");
    });

    // O vocabulário da v3 não é o da v2. Estes casos guardam a TRADUÇÃO:
    // `resolucao` vira `intrarregiao` e `qualidade` vira palavra. A versão
    // anterior deste arquivo afirmava `resolucao=2` na URL e passava — a API
    // respondia 400 a toda chamada. Ver o cabeçalho de src/tools/malhas.ts.
    it("translates resolucao into the v3 intrarregiao and never sends resolucao", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));
      await ibgeMalhas({ localidade: "BR", resolucao: "2" });
      const url = lastUrl();
      expect(url).toContain("intrarregiao=UF");
      expect(url).not.toContain("resolucao=");
    });

    it("sends qualidade as a v3 word, by default maxima", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));
      await ibgeMalhas({ localidade: "BR" });
      expect(lastUrl()).toContain("qualidade=maxima");
    });

    it("translates the legacy numeric qualidade", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));
      await ibgeMalhas({ localidade: "BR", qualidade: "3" });
      const url = lastUrl();
      expect(url).toContain("qualidade=intermediaria");
      expect(url).not.toContain("qualidade=3");
    });

    it("lets an explicit intrarregiao win over resolucao", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));
      await ibgeMalhas({ localidade: "BR", resolucao: "2", intrarregiao: "municipio" });
      expect(lastUrl()).toContain("intrarregiao=municipio");
    });

    it("never sends a query parameter outside the v3 vocabulary", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));
      await ibgeMalhas({ localidade: "33", resolucao: "5", qualidade: "1" });
      const chaves = [...new URL(lastUrl()).searchParams.keys()];
      expect(chaves.sort()).toEqual(["formato", "intrarregiao", "qualidade"]);
    });
  });

  describe("divisão interna que o nível não comporta", () => {
    it("refuses resolucao=2 on a municipality without calling the API", async () => {
      const { markdown: result, isError } = await ibgeMalhas({
        localidade: "3550308",
        resolucao: "2",
      });

      expect(isError).toBe(true);
      expect(result).toContain("não aceita divisão interna");
      expect(result).toContain('resolucao="0"');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("teaches which divisions a state accepts", async () => {
      const { markdown: result, isError } = await ibgeMalhas({
        localidade: "33",
        intrarregiao: "regiao",
      });

      expect(isError).toBe(true);
      expect(result).toContain("mesorregiao");
      expect(result).toContain("microrregiao");
      expect(result).toContain("municipio");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("formatting", () => {
    it("summarizes a FeatureCollection (counts, geometry types, sample)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));

      const { markdown: result } = await ibgeMalhas({ localidade: "BR", resolucao: "2" });

      expect(result).toContain("Malha Geográfica: BR");
      expect(result).toContain("Número de features");
      expect(result).toContain("MultiPolygon: 1");
      expect(result).toContain("Polygon: 1");
      expect(result).toContain("Amostra de Features");
      expect(result).toContain("São Paulo");
    });

    it("summarizes a single Feature", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(singleFeature));

      const { markdown: result } = await ibgeMalhas({ localidade: "3550308" });

      expect(result).toContain("Tipo de geometria");
      expect(result).toContain("MultiPolygon");
    });
  });

  describe("svg format", () => {
    it("returns a URL/instructions without calling the API", async () => {
      const { markdown: result } = await ibgeMalhas({ localidade: "BR", formato: "svg" });

      expect(result).toContain("Malha Geográfica (SVG): BR");
      expect(result).toContain("URL para Download");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("errors", () => {
    it("returns a notFound message on a 404", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 404: Not Found"));

      const { markdown: result } = await ibgeMalhas({ localidade: "9999999" });

      expect(result).toContain("não encontrado");
    });

    it("surfaces other upstream errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 503: Service Unavailable"));

      const { markdown: result } = await ibgeMalhas({ localidade: "SP" });

      expect(result).toContain("Erro");
    });
  });
});
