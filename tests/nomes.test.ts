import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeNomes, ibgeNomesFrequencia, ibgeNomesRanking } from "../src/tools/nomes.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function lastUrl(): string {
  return String(mockFetch.mock.calls.at(-1)?.[0]);
}

const mariaFrequencia = [
  {
    nome: "MARIA",
    sexo: "F",
    localidade: "BR",
    res: [
      { periodo: "[1930,1940[", frequencia: 100000 },
      { periodo: "[1940,1950[", frequencia: 200000 },
    ],
  },
];

const ranking = [
  {
    localidade: "BR",
    sexo: null,
    res: [
      { nome: "MARIA", frequencia: 11734129, ranking: 1 },
      { nome: "JOSE", frequencia: 5754529, ranking: 2 },
      { nome: "ANA", frequencia: 3079729, ranking: 3 },
    ],
  },
];

describe("ibge_nomes_frequencia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats a frequency response with totals", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(mariaFrequencia));
    const result = await ibgeNomesFrequencia({ nomes: "Maria" });
    expect(lastUrl()).toContain("/MARIA");
    expect(result).toContain("Frequência de Nomes no Brasil");
    expect(result).toContain("MARIA");
    expect(result).toContain("Feminino");
    expect(result).toContain("300.000"); // total
  });

  it("passes sexo and localidade as query params", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(mariaFrequencia));
    await ibgeNomesFrequencia({ nomes: "Maria", sexo: "F", localidade: "33" });
    const url = lastUrl();
    expect(url).toContain("sexo=F");
    expect(url).toContain("localidade=33");
  });

  it("strips whitespace and uppercases multi-name input", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(mariaFrequencia));
    await ibgeNomesFrequencia({ nomes: "joão, josé" });
    expect(lastUrl()).toContain(encodeURIComponent("JOÃO,JOSÉ"));
  });

  it("reports no data on a 404", async () => {
    mockFetch.mockRejectedValueOnce(new Error("HTTP 404: Not Found"));
    const result = await ibgeNomesFrequencia({ nomes: "Zzzqqq" });
    expect(result).toContain("Nenhum dado encontrado");
  });

  it("reports no data on an empty array", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    const result = await ibgeNomesFrequencia({ nomes: "Zzzqqq" });
    expect(result).toContain("Nenhum dado encontrado");
  });

  it("surfaces a non-404 upstream error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));
    const result = await ibgeNomesFrequencia({ nomes: "Maria" });
    expect(result).toContain("Erro");
  });
});

describe("ibge_nomes_ranking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats a general ranking", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(ranking));
    const result = await ibgeNomesRanking({ limite: 20 });
    expect(lastUrl()).toContain("/ranking");
    expect(result).toContain("Ranking de Nomes mais Frequentes");
    expect(result).toContain("Todas as décadas");
    expect(result).toContain("MARIA");
    expect(result).toContain("1º");
  });

  it("passes decada / sexo / localidade and honors limite", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(ranking));
    const result = await ibgeNomesRanking({
      decada: 2000,
      sexo: "F",
      localidade: "35",
      limite: 2,
    });
    const url = lastUrl();
    expect(url).toContain("decada=2000");
    expect(url).toContain("sexo=F");
    expect(url).toContain("localidade=35");
    expect(result).toContain("Década:");
    expect(result).toContain("2000");
    expect(result).toContain("Feminino");
    // limite=2 -> only first two names shown
    expect(result).toContain("JOSE");
    expect(result).not.toContain("ANA");
  });

  it("reports no data on an empty ranking", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    const result = await ibgeNomesRanking({ limite: 20 });
    expect(result).toContain("Nenhum dado encontrado");
  });

  it("surfaces an upstream error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));
    const result = await ibgeNomesRanking({ limite: 20 });
    expect(result).toContain("Erro");
  });
});

describe("ibgeNomes (router)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes tipo='frequencia' to the frequency handler", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(mariaFrequencia));
    const result = await ibgeNomes({ tipo: "frequencia", nomes: "Maria", limite: 20 });
    expect(result).toContain("Frequência de Nomes no Brasil");
  });

  it("requires nomes for tipo='frequencia'", async () => {
    const result = await ibgeNomes({ tipo: "frequencia", limite: 20 });
    expect(result).toContain("informe o(s) nome(s)");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("routes tipo='ranking' to the ranking handler", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(ranking));
    const result = await ibgeNomes({ tipo: "ranking", decada: 2010, limite: 20 });
    expect(result).toContain("Ranking de Nomes mais Frequentes");
  });
});
