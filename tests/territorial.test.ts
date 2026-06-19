import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeIndicadores } from "../src/tools/indicadores.js";
import { ibgeCenso } from "../src/tools/censo.js";
import { ibgeDatasaude } from "../src/tools/datasaude.js";
import { cache } from "../src/cache.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

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

// A minimal SIDRA-shaped response (header row + one data row).
const sidraRows = [
  { D1N: "Brasil", V: "100", MN: "Pessoas" },
  { D1N: "Brasil", V: "100", MN: "Pessoas" },
];

describe("Territorial level validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ibge_indicadores supports only 1/2/3", () => {
    it("rejects municipality level (6) without calling the API", async () => {
      const result = await ibgeIndicadores({ indicador: "desemprego", nivel_territorial: "6" });

      expect(result.isError).toBe(true);
      expect(result.markdown).toContain("Nível territorial inválido");
      expect(result.markdown).toContain('"6"');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("accepts UF level (3) and queries the API", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(sidraRows));

      await ibgeIndicadores({ indicador: "desemprego", nivel_territorial: "3" });

      expect(String(mockFetch.mock.calls.at(-1)?.[0])).toContain("/n3/");
    });
  });

  describe("ibge_censo supports up to municipality (6)", () => {
    it("rejects an unsupported level (9) without calling the API", async () => {
      const result = await ibgeCenso({ tema: "populacao", nivel_territorial: "9" });

      expect(result.isError).toBe(true);
      expect(result.markdown).toContain("Nível territorial inválido");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("accepts municipality level (6) and queries the API", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(sidraRows));

      await ibgeCenso({ tema: "populacao", nivel_territorial: "6", localidades: "3550308" });

      expect(String(mockFetch.mock.calls.at(-1)?.[0])).toContain("/n6/");
    });
  });

  describe("ibge_datasaude rejects unsupported levels", () => {
    it("rejects level 9 without calling the API", async () => {
      const result = await ibgeDatasaude({ indicador: "esperanca_vida", nivel_territorial: "9" });

      expect(result.isError).toBe(true);
      expect(result.markdown).toContain("Nível territorial inválido");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
