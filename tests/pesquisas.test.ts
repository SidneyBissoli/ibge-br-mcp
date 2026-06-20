import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgePesquisas } from "../src/tools/pesquisas.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const data = [
  {
    id: "33",
    nome: "Estimativas de população",
    agregados: [{ id: "6579", nome: "População residente estimada" }],
  },
  {
    id: "40",
    nome: "PNAD Contínua",
    agregados: [
      { id: "4093", nome: "Pessoas de 14 anos ou mais ocupadas" },
      { id: "4094", nome: "Taxa de desocupação" },
    ],
  },
  {
    id: "10",
    nome: "PIB dos Municípios",
    agregados: [{ id: "5938", nome: "Produto Interno Bruto" }],
  },
];

describe("ibgePesquisas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists all surveys with a summary table and categories", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(data));

    const { markdown: result } = await ibgePesquisas({});

    expect(result).toContain("Pesquisas do IBGE");
    expect(result).toContain("Total:** 3 pesquisas");
    expect(result).toContain("Estimativas de população");
    expect(result).toContain("PNAD Contínua");
    // category grouping (PNAD -> Trabalho e Renda, PIB -> Economia, população -> Demografia)
    expect(result).toContain("Pesquisas por Categoria");
    expect(result).toContain("Trabalho e Renda");
    expect(result).toContain("Economia");
    expect(result).toContain("Demografia");
  });

  it("filters by busca term", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(data));

    const { markdown: result } = await ibgePesquisas({ busca: "pnad" });

    expect(result).toContain('**Busca:** "pnad"');
    expect(result).toContain("PNAD Contínua");
    expect(result).not.toContain("PIB dos Municípios");
  });

  it("shows details of a specific survey by code", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(data));

    const { markdown: result } = await ibgePesquisas({ detalhes: "40" });

    expect(result).toContain("Pesquisa: PNAD Contínua");
    expect(result).toContain("**Código:** 40");
    expect(result).toContain("**Total de tabelas:** 2");
    expect(result).toContain("Tabelas Disponíveis");
    expect(result).toContain("4093");
    expect(result).toContain("Taxa de desocupação");
  });

  it("returns a not-found message for an unknown detalhes code", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(data));

    const { markdown: result } = await ibgePesquisas({ detalhes: "zzz999" });

    expect(result).toContain('Pesquisa "zzz999" não encontrada');
  });

  it("returns a no-results message for a busca with no matches", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(data));

    const { markdown: result } = await ibgePesquisas({ busca: "zzzznada" });

    expect(result).toContain("Nenhuma pesquisa encontrada para:");
  });

  it("returns a plain no-results message when the upstream list is empty", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));

    const { markdown: result } = await ibgePesquisas({});

    expect(result).toBe("Nenhuma pesquisa encontrada.");
  });

  it("surfaces an upstream HTTP error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));

    const { markdown: result } = await ibgePesquisas({});

    expect(result).toContain("Erro");
  });
});
