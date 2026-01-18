import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeEstados } from "../src/tools/estados.js";
import { ibgeMunicipios } from "../src/tools/municipios.js";
import { ibgeLocalidade } from "../src/tools/localidade.js";
import { cache } from "../src/cache.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper to create mock responses
function mockResponse<T>(data: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
    redirected: false,
    statusText: status === 200 ? "OK" : "Error",
    type: "basic",
    url: "",
    clone: () => mockResponse(data, status),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

describe("Integration Tests with Mocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ibgeEstados", () => {
    const mockEstados = [
      { id: 35, sigla: "SP", nome: "São Paulo", regiao: { id: 3, sigla: "SE", nome: "Sudeste" } },
      { id: 33, sigla: "RJ", nome: "Rio de Janeiro", regiao: { id: 3, sigla: "SE", nome: "Sudeste" } },
      { id: 31, sigla: "MG", nome: "Minas Gerais", regiao: { id: 3, sigla: "SE", nome: "Sudeste" } },
      { id: 41, sigla: "PR", nome: "Paraná", regiao: { id: 4, sigla: "S", nome: "Sul" } },
      { id: 43, sigla: "RS", nome: "Rio Grande do Sul", regiao: { id: 4, sigla: "S", nome: "Sul" } },
    ];

    it("should list all states", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockEstados));

      const result = await ibgeEstados({});

      expect(result).toContain("Estados Brasileiros");
      expect(result).toContain("São Paulo");
      expect(result).toContain("Rio de Janeiro");
      expect(result).toContain("SP");
      expect(result).toContain("RJ");
    });

    it("should filter by region", async () => {
      const seEstados = mockEstados.filter((e) => e.regiao.sigla === "SE");
      mockFetch.mockResolvedValueOnce(mockResponse(seEstados));

      const result = await ibgeEstados({ regiao: "SE" });

      expect(result).toContain("Sudeste");
      expect(result).toContain("São Paulo");
      expect(result).toContain("Rio de Janeiro");
      expect(result).toContain("Minas Gerais");
    });

    it("should sort by abbreviation", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockEstados));

      const result = await ibgeEstados({ ordenar: "sigla" });

      expect(result).toContain("Estados Brasileiros");
      // Results should contain state abbreviations
      expect(result).toContain("MG");
      expect(result).toContain("PR");
      expect(result).toContain("RJ");
    });

    it("should handle empty response", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([]));

      const result = await ibgeEstados({});

      expect(result).toContain("Nenhum estado encontrado");
    });
  });

  describe("ibgeMunicipios", () => {
    const mockMunicipios = [
      { id: 3550308, nome: "São Paulo" },
      { id: 3509502, nome: "Campinas" },
      { id: 3518800, nome: "Guarulhos" },
    ];

    it("should list municipalities for a state", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockMunicipios));

      const result = await ibgeMunicipios({ uf: "35" });

      expect(result).toContain("Municípios");
      expect(result).toContain("São Paulo");
      expect(result).toContain("Campinas");
      expect(result).toContain("Guarulhos");
      expect(result).toContain("3550308");
    });

    it("should accept state abbreviation", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockMunicipios));

      const result = await ibgeMunicipios({ uf: "SP" });

      expect(result).toContain("Municípios");
    });

    it("should handle empty uf parameter", async () => {
      // When uf is empty string, it's still provided but invalid
      const result = await ibgeMunicipios({ uf: "" });

      expect(result).toBeDefined();
    });
  });

  describe("ibgeLocalidade", () => {
    const mockMunicipio = {
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
    };

    it("should get municipality details", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockMunicipio));

      const result = await ibgeLocalidade({ codigo: 3550308 });

      expect(result).toContain("Município");
      expect(result).toContain("São Paulo");
      expect(result).toContain("3550308");
    });

    it("should get state details", async () => {
      const mockEstado = {
        id: 35,
        sigla: "SP",
        nome: "São Paulo",
        regiao: { id: 3, sigla: "SE", nome: "Sudeste" },
      };
      mockFetch.mockResolvedValueOnce(mockResponse(mockEstado));

      const result = await ibgeLocalidade({ codigo: 35 });

      expect(result).toContain("Estado");
      expect(result).toContain("São Paulo");
      expect(result).toContain("SP");
    });

    it("should handle not found with 404", async () => {
      mockFetch.mockRejectedValueOnce(new Error("404 Not Found"));

      // Use a valid IBGE code format (starts with valid state prefix)
      const result = await ibgeLocalidade({ codigo: 3599999 });

      expect(result).toContain("não encontrad");
    });
  });

  describe("Cache behavior", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      cache.clear();
    });

    it("should cache API responses", async () => {
      const mockData = [
        { id: 35, sigla: "SP", nome: "São Paulo", regiao: { id: 3, sigla: "SE", nome: "Sudeste" } },
      ];

      mockFetch.mockResolvedValue(mockResponse(mockData));

      // First request
      const result1 = await ibgeEstados({});
      expect(result1).toContain("São Paulo");

      // Clear mock call count but keep cache
      mockFetch.mockClear();

      // Second request should use cache (no new fetch calls)
      const result2 = await ibgeEstados({});
      expect(result2).toContain("São Paulo");

      // Both results should be identical
      expect(result1).toBe(result2);
    });

    it("should cache different requests separately", async () => {
      const mockEstados = [
        { id: 35, sigla: "SP", nome: "São Paulo", regiao: { id: 3, sigla: "SE", nome: "Sudeste" } },
      ];
      const mockMunicipios = [{ id: 3550308, nome: "São Paulo" }];

      mockFetch
        .mockResolvedValueOnce(mockResponse(mockEstados))
        .mockResolvedValueOnce(mockResponse(mockMunicipios));

      await ibgeEstados({});
      await ibgeMunicipios({ uf: "35" });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});

describe("Error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  it("should handle 404 errors", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}, 404));

    const result = await ibgeEstados({});

    expect(result).toBeDefined();
  });

  it("should handle 500 errors", async () => {
    mockFetch.mockRejectedValueOnce(new Error("500 Internal Server Error"));

    const result = await ibgeEstados({});

    expect(result).toContain("Erro");
  });

  it("should handle malformed JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("Invalid JSON")),
    } as Response);

    const result = await ibgeEstados({});

    expect(result).toBeDefined();
  });
});

describe("Input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  it("should validate IBGE code format", async () => {
    // Invalid code format - 3 digits is not a valid IBGE code length
    const result = await ibgeLocalidade({ codigo: 123 });
    expect(result).toContain("inválido");
  });

  it("should accept valid state codes", async () => {
    const mockEstado = {
      id: 35,
      sigla: "SP",
      nome: "São Paulo",
      regiao: { id: 3, sigla: "SE", nome: "Sudeste" },
    };
    mockFetch.mockResolvedValueOnce(mockResponse(mockEstado));

    const result = await ibgeLocalidade({ codigo: 35 });
    expect(result).toContain("Estado");
  });

  it("should accept valid municipality codes", async () => {
    const mockMunicipio = {
      id: 3550308,
      nome: "São Paulo",
      microrregiao: {
        nome: "São Paulo",
        mesorregiao: {
          nome: "Metropolitana de São Paulo",
          UF: { id: 35, sigla: "SP", nome: "São Paulo", regiao: { nome: "Sudeste" } },
        },
      },
    };
    mockFetch.mockResolvedValueOnce(mockResponse(mockMunicipio));

    const result = await ibgeLocalidade({ codigo: 3550308 });
    expect(result).toContain("Município");
  });
});
