import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeSidraMetadados } from "../src/tools/sidra-metadados.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function lastUrl(): string {
  return String(mockFetch.mock.calls.at(-1)?.[0]);
}

const metadados = {
  id: "6579",
  nome: "Estimativas de população residente",
  URL: "https://sidra.ibge.gov.br/tabela/6579",
  pesquisa: "Estimativas de população",
  assunto: "População residente estimada",
  periodicidade: { frequencia: "anual", inicio: 2001, fim: 2021 },
  nivelTerritorial: {
    Administrativo: ["N1", "N2", "N3", "N6"],
    Especial: [],
    IBGE: [],
  },
  variaveis: [
    {
      id: 9324,
      nome: "População residente estimada",
      unidade: "Pessoas",
      classificacoes: [
        {
          id: 2,
          nome: "Sexo",
          categorias: [
            { id: 6794, nome: "Total" },
            { id: 4, nome: "Homens" },
            { id: 5, nome: "Mulheres" },
          ],
        },
      ],
    },
  ],
};

const periodos = [
  { id: "2020", literals: ["2020"], modificacao: "2021-01-01" },
  { id: "2021", literals: ["2021"], modificacao: "2022-01-01" },
];

describe("ibgeSidraMetadados", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches metadata and periods and renders the full report", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(metadados))
      .mockResolvedValueOnce(mockResponse(periodos));

    const result = await ibgeSidraMetadados({
      tabela: "6579",
      incluir_periodos: true,
      incluir_localidades: false,
    });

    expect(result).toContain("Metadados da Tabela 6579");
    expect(result).toContain("Estimativas de população residente");
    expect(result).toContain("Informações Gerais");
    // territorial levels mapped
    expect(result).toContain("Unidade da Federação");
    expect(result).toContain("Município");
    // variables
    expect(result).toContain("9324");
    expect(result).toContain("População residente estimada");
    // classification categories
    expect(result).toContain("Classificações da Variável 9324");
    expect(result).toContain("Sexo");
    expect(result).toContain("Homens");
    // periods
    expect(result).toContain("Períodos Disponíveis");
    expect(result).toContain("2021");
    // usage hint
    expect(result).toContain("Como usar esta tabela");
  });

  it("hits the /metadados and /periodos endpoints", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(metadados))
      .mockResolvedValueOnce(mockResponse(periodos));

    await ibgeSidraMetadados({
      tabela: "6579",
      incluir_periodos: true,
      incluir_localidades: false,
    });

    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/6579/metadados"))).toBe(true);
    expect(urls.some((u) => u.includes("/6579/periodos"))).toBe(true);
  });

  it("skips period fetch when incluir_periodos is false", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(metadados));

    const result = await ibgeSidraMetadados({
      tabela: "6579",
      incluir_periodos: false,
      incluir_localidades: false,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(lastUrl()).toContain("/metadados");
    expect(result).not.toContain("Períodos Disponíveis");
  });

  it("truncates categories when more than 20 exist", async () => {
    const manyCats = {
      ...metadados,
      variaveis: [
        {
          id: 100,
          nome: "Var grande",
          unidade: "x",
          classificacoes: [
            {
              id: 9,
              nome: "Classif grande",
              categorias: Array.from({ length: 25 }, (_, i) => ({
                id: i + 1,
                nome: `Cat ${i + 1}`,
              })),
            },
          ],
        },
      ],
    };
    mockFetch.mockResolvedValueOnce(mockResponse(manyCats));

    const result = await ibgeSidraMetadados({
      tabela: "6579",
      incluir_periodos: false,
      incluir_localidades: false,
    });

    expect(result).toContain("25 categorias disponíveis");
    expect(result).toContain("e mais 15 categorias");
  });

  it("handles missing territorial levels and no variables", async () => {
    const bare = {
      ...metadados,
      nivelTerritorial: { Administrativo: [], Especial: [], IBGE: [] },
      variaveis: [],
    };
    mockFetch.mockResolvedValueOnce(mockResponse(bare));

    const result = await ibgeSidraMetadados({
      tabela: "6579",
      incluir_periodos: false,
      incluir_localidades: false,
    });

    expect(result).toContain("_Informação não disponível_");
    expect(result).toContain("_Nenhuma variável encontrada_");
  });

  it("returns a friendly not-found message on a 404", async () => {
    mockFetch.mockRejectedValueOnce(new Error("HTTP 404: Not Found"));

    const result = await ibgeSidraMetadados({
      tabela: "99999",
      incluir_periodos: true,
      incluir_localidades: false,
    });

    expect(result).toContain("Tabela 99999 não encontrada");
    expect(result).toContain("ibge_sidra_tabelas");
  });

  it("surfaces a non-404 upstream error via parseHttpError", async () => {
    mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));

    const result = await ibgeSidraMetadados({
      tabela: "6579",
      incluir_periodos: true,
      incluir_localidades: false,
    });

    expect(result).toContain("Erro");
    expect(result).toContain("ibge_sidra_tabelas");
  });

  it("still succeeds when the periods fetch fails (ignored)", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(metadados))
      .mockRejectedValueOnce(new Error("HTTP 404: Not Found"));

    const result = await ibgeSidraMetadados({
      tabela: "6579",
      incluir_periodos: true,
      incluir_localidades: false,
    });

    expect(result).toContain("Metadados da Tabela 6579");
    expect(result).not.toContain("Períodos Disponíveis");
  });
});
