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

    it("includes resolucao when greater than 0", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));
      await ibgeMalhas({ localidade: "BR", resolucao: "2" });
      expect(lastUrl()).toContain("resolucao=2");
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
