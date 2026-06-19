import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgePopulacao, ibgePopulacaoSidra } from "../src/tools/populacao.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function lastUrl(): string {
  return String(mockFetch.mock.calls.at(-1)?.[0]);
}

const estimativa = {
  localidade: "BR",
  horario: "18/06/2026 10:00:00",
  projecao: {
    populacao: 215300000,
    periodoMedio: {
      incrementoPopulacional: 5000,
      nascimento: 20, // < 60 -> "segundos"
      obito: 3700, // > 60 min -> "h min"
    },
  },
};

describe("ibgePopulacao", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the population projection report", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(estimativa));

    const result = await ibgePopulacao({ localidade: "BR" });

    expect(result).toContain("Projeção da População do Brasil");
    expect(result).toContain("18/06/2026 10:00:00");
    expect(result).toContain("População Atual");
    expect(result).toContain("215.300.000");
    expect(result).toContain("Incremento populacional");
    expect(result).toContain("5.000");
    // nascimento 20s -> seconds branch
    expect(result).toContain("20 segundos");
    // obito 3700s -> 1h 1min branch
    expect(result).toContain("1h 1min");
    expect(result).toContain("Fonte: IBGE");
  });

  it("calls the populacao endpoint with the localidade", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(estimativa));

    await ibgePopulacao({ localidade: "BR" });

    expect(lastUrl()).toContain("/BR");
  });

  it("formats minutes-only durations", async () => {
    const min = {
      ...estimativa,
      projecao: {
        ...estimativa.projecao,
        periodoMedio: {
          incrementoPopulacional: 100,
          nascimento: 120, // exactly 2 minutes -> "2 minutos"
          obito: 150, // 2 min 30 seg
        },
      },
    };
    mockFetch.mockResolvedValueOnce(mockResponse(min));

    const result = await ibgePopulacao({ localidade: "BR" });

    expect(result).toContain("2 minutos");
    expect(result).toContain("2 min 30 seg");
  });

  it("surfaces an upstream HTTP error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));

    const result = await ibgePopulacao({ localidade: "BR" });

    expect(result).toContain("Erro");
  });
});

describe("ibgePopulacaoSidra", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the SIDRA url and returns raw JSON", async () => {
    const payload = [{ V: "215000000", D1N: "Brasil" }];
    mockFetch.mockResolvedValueOnce(mockResponse(payload));

    const result = await ibgePopulacaoSidra("6579", "1", "2021");

    const url = lastUrl();
    expect(url).toContain("/t/6579");
    expect(url).toContain("/n1");
    expect(url).toContain("/p/2021");
    expect(url).toContain("/v/all");
    expect(JSON.parse(result)).toEqual(payload);
  });

  it("surfaces an upstream HTTP error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("HTTP 404: Not Found"));

    const result = await ibgePopulacaoSidra("6579", "1", "2021");

    expect(result).toContain("não encontrado");
  });
});
