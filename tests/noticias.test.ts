import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeNoticias } from "../src/tools/noticias.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function lastUrl(): string {
  return String(mockFetch.mock.calls.at(-1)?.[0]);
}

function noticiasResponse(items: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    count: items.length,
    page: 1,
    totalPages: 1,
    nextPage: 0,
    previousPage: 0,
    showingFrom: 1,
    showingTo: items.length,
    items,
    ...overrides,
  };
}

const noticiaItem = {
  id: 1,
  tipo: "Notícia",
  titulo: "PIB cresce no trimestre",
  introducao: "O <b>PIB</b> cresceu &amp; surpreendeu.",
  data_publicacao: "2024-03-15 10:00:00",
  produto_id: 9282,
  produtos: "PIB",
  editorias: "economicas",
  imagens: "",
  produtos_relacionados: "",
  destaque: true,
  link: "https://agenciadenoticias.ibge.gov.br/x",
};

const releaseItem = {
  id: 2,
  tipo: "Release",
  titulo: "Divulgação do IPCA",
  introducao: "Resultado mensal.",
  data_publicacao: "2024-03-10 09:00:00",
  produto_id: 9283,
  produtos: "null",
  editorias: "",
  imagens: "",
  produtos_relacionados: "",
  destaque: false,
  link: "https://agenciadenoticias.ibge.gov.br/y",
};

describe("ibge_noticias", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("happy path / formatting", () => {
    it("renders header metadata and a notícia with decoded HTML and badge", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(noticiasResponse([noticiaItem])));

      const result = await ibgeNoticias({ quantidade: 10, pagina: 1 });

      expect(result).toContain("Notícias e Releases do IBGE");
      expect(result).toContain("Total:** 1 notícias encontradas");
      expect(result).toContain("Página:** 1 de 1");
      expect(result).toContain("📰 PIB cresce no trimestre");
      expect(result).toContain("Editoria:** economicas");
      expect(result).toContain("Produtos:** PIB");
      expect(result).toContain("⭐ Destaque");
      // HTML tags stripped and entities decoded
      expect(result).toContain("PIB cresceu & surpreendeu");
      expect(result).not.toContain("<b>");
      expect(result).toContain("[Leia mais](https://agenciadenoticias.ibge.gov.br/x)");
    });

    it("renders a release with its badge and omits 'null' produtos / empty editoria", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(noticiasResponse([releaseItem])));

      const result = await ibgeNoticias({ quantidade: 10, pagina: 1 });

      expect(result).toContain("📢 Divulgação do IPCA");
      expect(result).not.toContain("Produtos:** null");
      expect(result).not.toContain("Editoria:**");
    });

    it("shows the search term in the header", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(noticiasResponse([noticiaItem])));

      const result = await ibgeNoticias({ busca: "pib", quantidade: 10, pagina: 1 });

      expect(lastUrl()).toContain("busca=pib");
      expect(result).toContain('Busca:** "pib"');
    });
  });

  describe("query string building", () => {
    it("includes qtd, page, tipo and destaque flags", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(noticiasResponse([noticiaItem])));

      await ibgeNoticias({
        quantidade: 25,
        pagina: 2,
        tipo: "release",
        destaque: true,
      });

      const url = lastUrl();
      expect(url).toContain("qtd=25");
      expect(url).toContain("page=2");
      expect(url).toContain("tipo=release");
      expect(url).toContain("destaque=1");
    });

    it("encodes destaque=0 when explicitly false", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(noticiasResponse([noticiaItem])));

      await ibgeNoticias({ quantidade: 10, pagina: 1, destaque: false });

      expect(lastUrl()).toContain("destaque=0");
    });

    it("converts DD/MM/AAAA date filters to MM-DD-AAAA", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(noticiasResponse([])));

      await ibgeNoticias({ de: "01/03/2026", ate: "31/03/2026", quantidade: 10, pagina: 1 });

      const url = lastUrl();
      expect(url).toContain("de=03-01-2026");
      expect(url).toContain("ate=03-31-2026");
    });
  });

  describe("pagination footer", () => {
    it("emits a next-page hint when there are more pages", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          noticiasResponse([noticiaItem], { totalPages: 3, page: 1, nextPage: 2, count: 30 })
        )
      );

      const result = await ibgeNoticias({ quantidade: 10, pagina: 1 });

      expect(result).toContain("Página 1 de 3");
      expect(result).toContain("Use pagina=2 para a próxima página");
    });
  });

  describe("empty / invalid / error branches", () => {
    it("returns a plain empty message when no items", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(noticiasResponse([])));
      const result = await ibgeNoticias({ quantidade: 10, pagina: 1 });
      expect(result).toBe("Nenhuma notícia encontrada.");
    });

    it("returns a search-specific empty message when no items and busca set", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(noticiasResponse([])));
      const result = await ibgeNoticias({ busca: "xyz", quantidade: 10, pagina: 1 });
      expect(result).toBe('Nenhuma notícia encontrada para: "xyz"');
    });

    it("rejects an invalid 'de' date without calling the API", async () => {
      const result = await ibgeNoticias({ de: "99/99/2026", quantidade: 10, pagina: 1 });
      expect(result).toContain("Data inválida");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects an invalid 'ate' date without calling the API", async () => {
      const result = await ibgeNoticias({ ate: "32/13/2026", quantidade: 10, pagina: 1 });
      expect(result).toContain("Data inválida");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("surfaces an upstream HTTP error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));
      const result = await ibgeNoticias({ busca: "pib", quantidade: 10, pagina: 1 });
      expect(result).toContain("Erro");
    });
  });
});
