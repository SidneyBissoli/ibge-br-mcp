import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeMalhasTema } from "../src/tools/malhas-tema.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function lastUrl(): string {
  return String(mockFetch.mock.calls.at(-1)?.[0]);
}

const featureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [] },
      properties: { codarea: "1", nome: "Amazônia" },
    },
    {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [] },
      properties: { codarea: "2", nome: "Cerrado" },
    },
  ],
};

const singleFeature = {
  type: "Feature",
  geometry: { type: "MultiPolygon", coordinates: [] },
  properties: { codarea: "1", nome: "Amazônia" },
};

describe("ibge_malhas_tema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("listar mode", () => {
    it("lists available themes without calling the API", async () => {
      const { markdown: result } = await ibgeMalhasTema({
        tema: "listar",
        formato: "geojson",
        resolucao: "0",
        qualidade: "4",
      });

      expect(result).toContain("Temas de Malhas Geográficas Disponíveis");
      expect(result).toContain("biomas");
      expect(result).toContain("Códigos de Biomas");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("theme URL routing", () => {
    it("routes biomas (no code) to /biomas", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));
      await ibgeMalhasTema({
        tema: "biomas",
        formato: "geojson",
        resolucao: "0",
        qualidade: "4",
      });
      expect(lastUrl()).toContain("/malhas/biomas?");
    });

    it("routes biomas with a code to /biomas/{codigo}", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(singleFeature));
      await ibgeMalhasTema({
        tema: "biomas",
        codigo: "1",
        formato: "geojson",
        resolucao: "0",
        qualidade: "4",
      });
      expect(lastUrl()).toContain("/malhas/biomas/1?");
    });

    it("routes amazonia_legal to /amazonia-legal", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));
      await ibgeMalhasTema({
        tema: "amazonia_legal",
        formato: "geojson",
        resolucao: "0",
        qualidade: "4",
      });
      expect(lastUrl()).toContain("/malhas/amazonia-legal?");
    });

    it("routes metropolitana with a code to /regioes-metropolitanas/{codigo}", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(singleFeature));
      await ibgeMalhasTema({
        tema: "metropolitana",
        codigo: "3501",
        formato: "geojson",
        resolucao: "0",
        qualidade: "4",
      });
      expect(lastUrl()).toContain("/malhas/regioes-metropolitanas/3501?");
    });

    it("routes ride to /RIDEs", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));
      await ibgeMalhasTema({
        tema: "ride",
        formato: "geojson",
        resolucao: "0",
        qualidade: "4",
      });
      expect(lastUrl()).toContain("/malhas/RIDEs?");
    });
  });

  describe("query parameters", () => {
    it("maps geojson to its mime type and omits resolucao=0", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));
      await ibgeMalhasTema({
        tema: "biomas",
        formato: "geojson",
        resolucao: "0",
        qualidade: "4",
      });
      const url = lastUrl();
      expect(url).toContain(encodeURIComponent("application/vnd.geo+json"));
      expect(url).not.toContain("resolucao=");
      expect(url).toContain("qualidade=4");
    });

    it("includes resolucao when set to 5", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));
      await ibgeMalhasTema({
        tema: "biomas",
        formato: "geojson",
        resolucao: "5",
        qualidade: "4",
      });
      expect(lastUrl()).toContain("resolucao=5");
    });
  });

  describe("formatting", () => {
    it("summarizes a FeatureCollection (features, properties, sample table)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(featureCollection));

      const { markdown: result } = await ibgeMalhasTema({
        tema: "biomas",
        formato: "geojson",
        resolucao: "0",
        qualidade: "4",
      });

      expect(result).toContain("Malha Temática: Biomas");
      expect(result).toContain("FeatureCollection");
      expect(result).toContain("**Features** | 2");
      expect(result).toContain("Amazônia");
      expect(result).toContain("Cerrado");
      expect(result).toContain("URL para Download");
    });

    it("notes a large feature count without a sample table", async () => {
      const many = {
        type: "FeatureCollection",
        features: Array.from({ length: 12 }, (_, i) => ({
          type: "Feature",
          geometry: { type: "MultiPolygon", coordinates: [] },
          properties: { codarea: String(i), nome: `Item ${i}` },
        })),
      };
      mockFetch.mockResolvedValueOnce(mockResponse(many));

      const { markdown: result } = await ibgeMalhasTema({
        tema: "biomas",
        formato: "geojson",
        resolucao: "0",
        qualidade: "4",
      });

      expect(result).toContain("12 features no total");
    });
  });

  describe("svg format", () => {
    it("returns a download URL without calling the API", async () => {
      const { markdown: result } = await ibgeMalhasTema({
        tema: "biomas",
        formato: "svg",
        resolucao: "0",
        qualidade: "4",
      });

      expect(result).toContain("Malha Temática (SVG): Biomas");
      expect(result).toContain("URL para Download/Visualização");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("errors", () => {
    it("returns a not-found message on a 404", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 404: Not Found"));

      const { markdown: result } = await ibgeMalhasTema({
        tema: "biomas",
        codigo: "99",
        formato: "geojson",
        resolucao: "0",
        qualidade: "4",
      });

      expect(result).toContain("Malha temática não encontrada");
      expect(result).toContain("99");
    });

    it("surfaces other upstream errors via parseHttpError", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));

      const { markdown: result } = await ibgeMalhasTema({
        tema: "biomas",
        formato: "geojson",
        resolucao: "0",
        qualidade: "4",
      });

      expect(result).toContain("Erro");
    });
  });
});
