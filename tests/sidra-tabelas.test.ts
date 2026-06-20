import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeSidraTabelas } from "../src/tools/sidra-tabelas.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const agregadosData = [
  {
    id: "33",
    nome: "Estimativas de população",
    agregados: [
      { id: "6579", nome: "População residente estimada" },
      { id: "6580", nome: "Outra estimativa de população" },
    ],
  },
  {
    id: "10",
    nome: "PIB dos Municípios",
    agregados: [{ id: "5938", nome: "Produto Interno Bruto a preços correntes" }],
  },
];

describe("ibgeSidraTabelas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists all tables grouped by pesquisa", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(agregadosData));

    const { markdown: result } = await ibgeSidraTabelas({ limite: 20 });

    expect(result).toContain("Tabelas SIDRA (Agregados)");
    expect(result).toContain("33 - Estimativas de população");
    expect(result).toContain("10 - PIB dos Municípios");
    expect(result).toContain("6579");
    expect(result).toContain("População residente estimada");
    expect(result).toContain("Mostrando:** 3 de 3 tabelas");
  });

  it("filters by pesquisa term", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(agregadosData));

    const { markdown: result } = await ibgeSidraTabelas({ pesquisa: "pib", limite: 20 });

    expect(result).toContain('**Pesquisa:** "pib"');
    expect(result).toContain("PIB dos Municípios");
    expect(result).not.toContain("População residente estimada");
  });

  it("filters by busca term against table name", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(agregadosData));

    const { markdown: result } = await ibgeSidraTabelas({ busca: "residente", limite: 20 });

    expect(result).toContain('**Busca:** "residente"');
    expect(result).toContain("População residente estimada");
    expect(result).not.toContain("Produto Interno Bruto");
  });

  it("applies the limite (slices the result set)", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(agregadosData));

    const { markdown: result } = await ibgeSidraTabelas({ limite: 1 });

    expect(result).toContain("Mostrando:** 1 de 3 tabelas");
  });

  it("returns a no-results message when criteria match nothing", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(agregadosData));

    const { markdown: result } = await ibgeSidraTabelas({ busca: "zzzznada", limite: 20 });

    expect(result).toContain("Nenhuma tabela encontrada para os critérios especificados");
  });

  it("returns a plain no-results message when the upstream list is empty", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));

    const { markdown: result } = await ibgeSidraTabelas({ limite: 20 });

    expect(result).toBe("Nenhuma tabela encontrada.");
  });

  it("surfaces an upstream HTTP error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));

    const { markdown: result } = await ibgeSidraTabelas({ limite: 20 });

    expect(result).toContain("Erro");
  });
});
