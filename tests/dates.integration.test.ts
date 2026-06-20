import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeNoticias } from "../src/tools/noticias.js";
import { ibgeCalendario } from "../src/tools/calendario.js";
import { cache } from "../src/cache.js";

// Mock fetch globally
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

function lastUrl(): string {
  const calls = mockFetch.mock.calls;
  return String(calls[calls.length - 1][0]);
}

describe("Date normalization across tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("noticias — converts canonical date to MM-DD-AAAA", () => {
    it("converts day-first input to the month-first format the IBGE API expects", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ items: [], count: 0, page: 1, totalPages: 0 }));

      await ibgeNoticias({ de: "01/03/2026", ate: "31/03/2026" });

      const url = lastUrl();
      expect(url).toContain("de=03-01-2026");
      expect(url).toContain("ate=03-31-2026");
    });

    it("rejects an invalid date without calling the API", async () => {
      const { markdown: result } = await ibgeNoticias({ de: "99/99/2026" });

      expect(result).toContain("Data inválida");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("calendario — converts canonical date to MM-DD-AAAA", () => {
    it("converts day-first input to the month-first format the IBGE API expects", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ items: [], count: 0, page: 1, totalPages: 0 }));

      await ibgeCalendario({ de: "01/03/2026", ate: "31/03/2026", tipo: "todos" });

      const url = lastUrl();
      expect(url).toContain("de=03-01-2026");
      expect(url).toContain("ate=03-31-2026");
    });

    it("rejects an invalid date without calling the API", async () => {
      const { markdown: result } = await ibgeCalendario({ de: "31-31-2026", tipo: "todos" });

      expect(result).toContain("Data inválida");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("calendario — renders real IBGE API fields", () => {
    it("groups by data_divulgacao and shows nome_produto", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          count: 1,
          page: 1,
          totalPages: 1,
          items: [
            {
              id: 4228,
              titulo: "Índice de Preços ao Produtor",
              descricao: "",
              data_divulgacao: "31/03/2026 12:00:00",
              tipo_id: 1,
              tipo: "Divulgação de Indicadores",
              produto_id: 9282,
              nome_produto: "IPP",
              link: "",
            },
          ],
        })
      );

      const { markdown: result } = await ibgeCalendario({ tipo: "todos" });

      expect(result).toContain("Março 2026");
      expect(result).toContain("31/03");
      expect(result).toContain("IPP");
      expect(result).not.toContain("NaN");
    });
  });
});
