/**
 * SIDRA pela API de Agregados v3 (src/sidra-agregados.ts).
 *
 * Em 15/09/2026 o `apisidra.ibge.gov.br` ficou atrás de um desafio do
 * Cloudflare que nenhum cliente programático passa (60 de 60 requisições em
 * 403, medido em 16/09). As ferramentas continuam falando a gramática do
 * apisidra; o que estes testes cobrem é a tradução para a v3 — cada forma de
 * caminho que as seis ferramentas montam — e a frase de erro recomposta dos
 * metadados, já que a v3 responde 500 sem dizer qual parâmetro recusou.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  fetchSidra,
  lerCaminhoSidra,
  periodosAgregados,
  traduzirCaminhoSidra,
} from "../src/sidra-agregados.js";
import { UpstreamError } from "../src/retry.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const V3 = "https://servicodados.ibge.gov.br/api/v3/agregados";

describe("lerCaminhoSidra", () => {
  it("lê tabela, nível, localidades, variáveis e período", () => {
    expect(lerCaminhoSidra("/t/6579/n3/all/v/allxp/p/last")).toEqual({
      tabela: "6579",
      nivel: "3",
      localidades: "all",
      variaveis: "allxp",
      periodos: "last",
      classificacoes: [],
    });
  });

  it("lê classificações múltiplas, na ordem", () => {
    expect(lerCaminhoSidra("/t/9514/n1/all/v/93/p/2022/c2/6794/c287/all").classificacoes).toEqual([
      { id: "2", categorias: "6794" },
      { id: "287", categorias: "all" },
    ]);
  });

  it("ignora as opções de formatação do apisidra (f, h, d)", () => {
    const c = lerCaminhoSidra("/t/4709/n6/3550308/v/93/p/last/f/n/h/n/d/2");
    expect(c).toMatchObject({ tabela: "4709", nivel: "6", localidades: "3550308", variaveis: "93" });
  });

  it("decodifica 'last%204' como 'last 4'", () => {
    expect(lerCaminhoSidra("/t/1419/n1/all/v/63/p/last%204").periodos).toBe("last 4");
  });

  it("caminho sem um dos quatro pares obrigatórios é erro de programação", () => {
    expect(() => lerCaminhoSidra("/t/6579/n3/all/v/allxp")).toThrow(/incompleto/);
    expect(() => lerCaminhoSidra("/n3/all/v/allxp/p/last")).toThrow(/incompleto/);
  });
});

describe("periodosAgregados", () => {
  it("last → -1, last N → -N; o resto passa como está", () => {
    expect(periodosAgregados("last")).toBe("-1");
    expect(periodosAgregados("LAST")).toBe("-1");
    expect(periodosAgregados("last 4")).toBe("-4");
    expect(periodosAgregados("all")).toBe("all");
    expect(periodosAgregados("first")).toBe("first");
    expect(periodosAgregados("2022")).toBe("2022");
    expect(periodosAgregados("2010-2020")).toBe("2010-2020");
    expect(periodosAgregados("2010,2020")).toBe("2010,2020");
    expect(periodosAgregados("202412")).toBe("202412");
  });
});

describe("traduzirCaminhoSidra", () => {
  it("consulta simples: a URL da v3 com view=flat", () => {
    expect(traduzirCaminhoSidra("/t/6579/n3/all/v/allxp/p/last")).toBe(
      `${V3}/6579/periodos/-1/variaveis/allxp?localidades=N3[all]&view=flat`
    );
  });

  it("lista de localidades e período explícito", () => {
    expect(traduzirCaminhoSidra("/t/6579/n6/3550308,3304557/v/9324/p/2022")).toBe(
      `${V3}/6579/periodos/2022/variaveis/9324?localidades=N6[3550308,3304557]&view=flat`
    );
  });

  it("classificações viram classificacao=id[cats]|id[cats]", () => {
    expect(traduzirCaminhoSidra("/t/9514/n1/all/v/93/p/2022/c2/6794/c287/all")).toBe(
      `${V3}/9514/periodos/2022/variaveis/93?localidades=N1[all]&classificacao=2[6794]|287[all]&view=flat`
    );
  });

  it("o /f/n de ibge_vizinhos não vai para a URL", () => {
    expect(traduzirCaminhoSidra("/t/4709/n6/3550308/v/93/p/last/f/n")).toBe(
      `${V3}/4709/periodos/-1/variaveis/93?localidades=N6[3550308]&view=flat`
    );
  });

  it("intervalo e lista de períodos passam intactos", () => {
    expect(traduzirCaminhoSidra("/t/6579/n1/all/v/9324/p/2010-2012")).toContain("/periodos/2010-2012/");
    expect(traduzirCaminhoSidra("/t/6579/n1/all/v/9324/p/2010,2020")).toContain("/periodos/2010,2020/");
  });
});

describe("fetchSidra", () => {
  const cabecalho = { NC: "Nível Territorial (Código)", NN: "Nível Territorial", V: "Valor", D1C: "Unidade da Federação (Código)", D1N: "Unidade da Federação" };
  const linha = { NC: "3", NN: "Unidade da Federação", V: "1757338", D1C: "11", D1N: "Rondônia" };
  const metadados6579 = {
    id: 6579,
    nivelTerritorial: { Administrativo: ["N1", "N2", "N6", "N3"], Especial: [], IBGE: [] },
    variaveis: [{ id: 9324, nome: "População residente estimada" }],
    classificacoes: [],
  };

  beforeEach(() => {
    mockFetch.mockReset();
    cache.clear();
  });

  it("devolve as linhas no formato do apisidra e a URL consultada, que é a da v3", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([cabecalho, linha]));
    const r = await fetchSidra("/t/6579/n3/all/v/9324/p/last");
    expect(r.url).toBe(`${V3}/6579/periodos/-1/variaveis/9324?localidades=N3[all]&view=flat`);
    expect(String(mockFetch.mock.calls[0][0])).toBe(r.url);
    expect(r.data).toEqual([cabecalho, linha]);
    expect(r.chaveCache).toBeTruthy();
  });

  it("resposta vazia da fonte (só cabeçalho) passa como está: vazio é resultado, não falha", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([cabecalho]));
    const r = await fetchSidra("/t/6579/n3/all/v/9324/p/2023");
    expect(r.data).toEqual([cabecalho]);
  });

  // A v3 responde 500 "Internal server error" a QUALQUER parâmetro inválido
  // (conferido em 16/09/2026 para tabela, variável, nível e localidade). Sem a
  // frase, o chamador só pode tentar outra combinação às cegas — foi para
  // acabar com isso que o UpstreamError nasceu, e a 5.0.1 não pode regredir.
  describe("500 sem explicação vira a frase que o apisidra dava", () => {
    const erro500 = () => mockResponse({ statusCode: 500, message: "Internal server error" }, 500);

    it("tabela que não existe: metadados também falham → 'tabela inválida'", async () => {
      mockFetch.mockResolvedValueOnce(erro500()).mockResolvedValueOnce(erro500());
      const e = await fetchSidra("/t/99999/n1/all/v/all/p/last").catch((x) => x);
      expect(e).toBeInstanceOf(UpstreamError);
      expect(e.status).toBe(400);
      expect(e.detalhe).toBe("Tabela 99999: tabela inválida");
      expect(String(mockFetch.mock.calls[1][0])).toBe(`${V3}/99999/metadados`);
    });

    it("nível territorial que a tabela não publica", async () => {
      mockFetch.mockResolvedValueOnce(erro500()).mockResolvedValueOnce(mockResponse(metadados6579));
      const e = await fetchSidra("/t/6579/n7/all/v/9324/p/last").catch((x) => x);
      expect(e.status).toBe(400);
      expect(e.detalhe).toContain("Parâmetro N7 (Nível territorial) incompatível com a tabela 6579");
      expect(e.detalhe).toContain("N1, N2, N6, N3");
    });

    it("variável fora da tabela", async () => {
      mockFetch.mockResolvedValueOnce(erro500()).mockResolvedValueOnce(mockResponse(metadados6579));
      const e = await fetchSidra("/t/6579/n3/all/v/9999/p/last").catch((x) => x);
      expect(e.detalhe).toContain("Parâmetro V (Variável) com código 9999 inexistente na tabela 6579");
      expect(e.detalhe).toContain("9324");
    });

    it("classificação fora da tabela", async () => {
      mockFetch.mockResolvedValueOnce(erro500()).mockResolvedValueOnce(mockResponse(metadados6579));
      const e = await fetchSidra("/t/6579/n3/all/v/9324/p/last/c2/6794").catch((x) => x);
      expect(e.detalhe).toContain("Parâmetro C2 (Classificação) inexistente na tabela 6579");
    });

    it("tudo confere nos metadados: a frase aponta localidade e período, sem escolher", async () => {
      mockFetch.mockResolvedValueOnce(erro500()).mockResolvedValueOnce(mockResponse(metadados6579));
      const e = await fetchSidra("/t/6579/n6/9999999/v/9324/p/last").catch((x) => x);
      expect(e).toBeInstanceOf(UpstreamError);
      expect(e.status).toBe(500);
      expect(e.detalhe).toContain("localidade (9999999)");
      expect(e.detalhe).toContain("período (last)");
    });

    it("'allxp' não é conferido contra a lista de variáveis", async () => {
      mockFetch.mockResolvedValueOnce(erro500()).mockResolvedValueOnce(mockResponse(metadados6579));
      const e = await fetchSidra("/t/6579/n6/9999999/v/allxp/p/last").catch((x) => x);
      expect(e.detalhe).not.toContain("Variável");
    });

    it("falha de rede ao ler os metadados: o erro original sobe intacto", async () => {
      mockFetch.mockResolvedValueOnce(erro500()).mockRejectedValueOnce(new Error("rede caiu"));
      const e = await fetchSidra("/t/6579/n3/all/v/9324/p/last").catch((x) => x);
      expect(e).toBeInstanceOf(UpstreamError);
      expect(e.status).toBe(500);
      expect(e.detalhe ?? "").not.toContain("localidade");
    });
  });

  it("4xx da fonte sobe como veio, sem consultar metadados", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse("Bad Request", 400));
    const e = await fetchSidra("/t/6579/n3/all/v/9324/p/last").catch((x) => x);
    expect(e).toBeInstanceOf(UpstreamError);
    expect(e.status).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
