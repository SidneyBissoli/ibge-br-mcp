import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeCnae } from "../src/tools/cnae.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function lastUrl(): string {
  return String(mockFetch.mock.calls.at(-1)?.[0]);
}

const secao = { id: "J", descricao: "Informação e comunicação", observacoes: ["nota 1"] };

const divisao = {
  id: "62",
  descricao: "Atividades dos serviços de tecnologia da informação",
  secao,
};

const grupo = { id: "62.0", descricao: "Atividades dos serviços de TI", divisao };

const classe = { id: "6201", descricao: "Desenvolvimento de programas sob encomenda", grupo };

const subclasse = {
  id: "6201-5/01",
  descricao: "Desenvolvimento de programas de computador sob encomenda",
  classe,
};

const subclasseList = [
  { id: "6201-5/01", descricao: "Desenvolvimento de programas de computador sob encomenda" },
  { id: "6202-3/00", descricao: "Desenvolvimento e licenciamento de software customizável" },
  { id: "5611-2/01", descricao: "Restaurantes e similares" },
];

describe("ibge_cnae", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("default structure overview", () => {
    it("shows the hierarchy overview without calling the API", async () => {
      const { markdown: result } = await ibgeCnae({ limite: 20 });
      expect(result).toContain("CNAE - Classificação Nacional de Atividades Econômicas");
      expect(result).toContain("Estrutura Hierárquica");
      expect(result).toContain("Subclasse");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("search by term", () => {
    it("filters subclasses by description and renders a table", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(subclasseList));

      const { markdown: result } = await ibgeCnae({ busca: "software", limite: 20 });

      expect(lastUrl()).toContain("/cnae/subclasses");
      expect(result).toContain('Busca CNAE: "software"');
      expect(result).toContain("Desenvolvimento e licenciamento");
      // restaurante row should be filtered out
      expect(result).not.toContain("Restaurantes e similares");
    });

    it("uses the provided nivel as the search endpoint", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(subclasseList));

      await ibgeCnae({ busca: "software", nivel: "classes", limite: 20 });

      expect(lastUrl()).toContain("/cnae/classes");
    });

    it("returns a no-results message when nothing matches", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(subclasseList));

      const { markdown: result } = await ibgeCnae({ busca: "inexistente-xyz", limite: 20 });

      expect(result).toContain("Nenhuma atividade encontrada");
      expect(result).toContain("ibge_cnae(nivel=");
    });

    it("notes truncation when the result hits the limit", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(subclasseList));

      const { markdown: result } = await ibgeCnae({ busca: "Desenvolvimento", limite: 1 });

      expect(result).toContain("Mostrando primeiros 1 resultados");
    });
  });

  describe("get by code", () => {
    it("resolves a section code (single letter)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(secao));

      const { markdown: result } = await ibgeCnae({ codigo: "J", limite: 20 });

      expect(lastUrl()).toContain("/cnae/secoes/J");
      expect(result).toContain("CNAE J");
      expect(result).toContain("Informação e comunicação");
      expect(result).toContain("Observações");
    });

    it("resolves a division code (2 digits)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(divisao));

      const { markdown: result } = await ibgeCnae({ codigo: "62", limite: 20 });

      expect(lastUrl()).toContain("/cnae/divisoes/62");
      expect(result).toContain("Hierarquia");
      expect(result).toContain("**Divisão:**");
    });

    it("resolves a group code (3 digits)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(grupo));

      const { markdown: result } = await ibgeCnae({ codigo: "620", limite: 20 });

      expect(lastUrl()).toContain("/cnae/grupos/620");
      expect(result).toContain("**Grupo:**");
    });

    it("resolves a class code (uses first 4 digits)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(classe));

      const { markdown: result } = await ibgeCnae({ codigo: "6201-5", limite: 20 });

      expect(lastUrl()).toContain("/cnae/classes/6201");
      expect(result).toContain("**Classe:**");
    });

    it("resolves a subclass code (7 digits) with full hierarchy", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(subclasse));

      const { markdown: result } = await ibgeCnae({ codigo: "6201-5/01", limite: 20 });

      expect(lastUrl()).toContain("/cnae/subclasses/6201501");
      expect(result).toContain("**Seção:**");
      expect(result).toContain("**Subclasse:**");
    });

    it("rejects an invalid code format without calling the API", async () => {
      const { markdown: result } = await ibgeCnae({ codigo: "123456789", limite: 20 });

      expect(result).toContain("codigo");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("list by level", () => {
    it("lists divisoes and reports the total", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([divisao, { id: "01", descricao: "Agricultura" }]));

      const { markdown: result } = await ibgeCnae({ nivel: "divisoes", limite: 20 });

      expect(lastUrl()).toContain("/cnae/divisoes");
      expect(result).toContain("CNAE - Divisões");
      expect(result).toContain("Total: 2 registros");
    });

    it("notes truncation when more registers than the limit", async () => {
      const many = Array.from({ length: 5 }, (_, i) => ({
        id: String(i),
        descricao: `Item ${i}`,
      }));
      mockFetch.mockResolvedValueOnce(mockResponse(many));

      const { markdown: result } = await ibgeCnae({ nivel: "secoes", limite: 2 });

      expect(result).toContain("Mostrando 2 de 5 registros");
    });
  });

  describe("errors", () => {
    it("surfaces an upstream HTTP error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));

      const { markdown: result } = await ibgeCnae({ codigo: "J", limite: 20 });

      expect(result).toContain("Erro");
    });
  });
});
