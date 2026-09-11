/**
 * `ibge_malhas_tema` sobre o WFS do IBGE Geosserviços.
 *
 * A versão anterior deste arquivo era verde sobre uma ferramenta MORTA: ela
 * mockava `fetch` e conferia que a URL contém `/malhas/biomas`, caminho que a
 * API de malhas responde com 404 desde sempre. Os casos abaixo guardam o que
 * sustenta a versão nova — a camada certa, o `propertyName` que evita baixar
 * 9 MB de polígono, o filtro CQL e as mensagens que ensinam. O que nenhum mock
 * pode afirmar (que a camada existe e responde) está em
 * tests/malhas-tema-contract.integration.test.ts, contra o serviço real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeMalhasTema } from "../src/tools/malhas-tema.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function lastUrl(): URL {
  return new URL(String(mockFetch.mock.calls.at(-1)?.[0]));
}

/** Resposta do GeoServer no formato que ele devolve: total + feições. */
function wfs(features: Array<Record<string, unknown>>, total = features.length) {
  return {
    type: "FeatureCollection",
    numberMatched: total,
    numberReturned: features.length,
    totalFeatures: total,
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::4674" } },
    features: features.map((properties, i) => ({
      type: "Feature",
      geometry: null,
      properties,
      bbox: [-50 - i, -10 - i, -40 - i, -5 - i],
    })),
  };
}

const biomas = wfs([
  { cd_bioma: 1, nm_bioma: "Amazônia" },
  { cd_bioma: 2, nm_bioma: "Caatinga" },
  { cd_bioma: 3, nm_bioma: "Cerrado" },
]);

describe("ibge_malhas_tema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("catálogo", () => {
    it('tema="listar" não toca na rede', async () => {
      const { markdown, structured } = await ibgeMalhasTema({ tema: "listar", limite: 50 });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(markdown).toContain("Recortes temáticos disponíveis");
      expect((structured as { temas: unknown[] }).temas).toHaveLength(7);
    });

    it("o catálogo lista os sete recortes que a ferramenta serve", async () => {
      const { structured } = await ibgeMalhasTema({ tema: "listar", limite: 50 });
      const temas = (structured as { temas: Array<{ tema: string }> }).temas.map((t) => t.tema);
      expect(temas).toEqual([
        "biomas",
        "amazonia_legal",
        "semiarido",
        "costeiro",
        "fronteira",
        "metropolitana",
        "ride",
      ]);
    });
  });

  describe("a requisição ao WFS", () => {
    it("vai ao Geosserviços, não à API de malhas", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(biomas));
      await ibgeMalhasTema({ tema: "biomas", limite: 50 });
      const url = lastUrl();
      expect(url.host).toBe("geoservicos.ibge.gov.br");
      expect(url.pathname).toBe("/geoserver/ows");
      // O caminho antigo, que respondia 404 e passava no teste anterior.
      expect(url.href).not.toContain("/malhas/biomas");
    });

    it("pede a camada certa, em GeoJSON, SEM geometria", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(biomas));
      await ibgeMalhasTema({ tema: "biomas", limite: 50 });
      const q = lastUrl().searchParams;
      expect(q.get("typeNames")).toBe("CGMAT:pbqg22_62_Biomas_Biomas");
      expect(q.get("outputFormat")).toBe("application/json");
      expect(q.get("request")).toBe("GetFeature");
      // O propertyName é o que troca 9 MB por 1,4 KB. Sem ele, a ferramenta
      // baixa o polígono inteiro do bioma para jogar fora.
      expect(q.get("propertyName")).toBe("cd_bioma,nm_bioma");
    });

    it("RM e RIDE saem da MESMA camada, separadas por filtro CQL", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(wfs([{ RM: "RM de Belém", FIRST_TIPO: "RM" }])));
      await ibgeMalhasTema({ tema: "metropolitana", limite: 50 });
      const rm = lastUrl().searchParams;
      expect(rm.get("typeNames")).toBe("CGEO:RegioesMetropolitanas");
      expect(rm.get("CQL_FILTER")).toBe("FIRST_TIPO='RM'");

      cache.clear();
      mockFetch.mockResolvedValueOnce(mockResponse(wfs([{ RM: "RIDE DF", FIRST_TIPO: "RIDE" }])));
      await ibgeMalhasTema({ tema: "ride", limite: 50 });
      expect(lastUrl().searchParams.get("CQL_FILTER")).toBe("FIRST_TIPO='RIDE'");
    });

    it("o código vira filtro CQL, numérico ou com aspas conforme o campo", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(wfs([{ cd_bioma: 1, nm_bioma: "Amazônia" }])));
      await ibgeMalhasTema({ tema: "biomas", codigo: "1", limite: 50 });
      expect(lastUrl().searchParams.get("CQL_FILTER")).toBe("cd_bioma=1");

      cache.clear();
      mockFetch.mockResolvedValueOnce(
        mockResponse(wfs([{ cd_mun: "3550308", nm_mun: "São Paulo", nm_muncost: "-" }]))
      );
      await ibgeMalhasTema({ tema: "costeiro", codigo: "3550308", limite: 50 });
      expect(lastUrl().searchParams.get("CQL_FILTER")).toBe("cd_mun='3550308'");
    });

    it("o limite vai como count", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(biomas));
      await ibgeMalhasTema({ tema: "biomas", limite: 7 });
      expect(lastUrl().searchParams.get("count")).toBe("7");
    });
  });

  describe("resposta", () => {
    it("traz o total da fonte, os atributos e a URL da geometria", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(wfs(biomas.features.map((f) => f.properties), 6)));
      const { markdown, structured } = await ibgeMalhasTema({ tema: "biomas", limite: 3 });

      const s = structured as {
        feicoes: number;
        feicoes_retornadas: number;
        camada: string;
        url_geometria: string;
        registros: Array<Record<string, unknown>>;
      };
      expect(s.feicoes).toBe(6);
      expect(s.feicoes_retornadas).toBe(3);
      expect(s.camada).toBe("CGMAT:pbqg22_62_Biomas_Biomas");
      expect(s.registros[0].nm_bioma).toBe("Amazônia");
      expect(markdown).toContain("Amazônia");
      expect(markdown).toContain("EPSG:4674");
      expect(markdown).toContain("mostrando 3");

      // A URL da geometria é a MESMA camada e filtro, mas sem propertyName —
      // é o que faz dela um download que serve para alguma coisa.
      const geo = new URL(s.url_geometria);
      expect(geo.searchParams.get("typeNames")).toBe("CGMAT:pbqg22_62_Biomas_Biomas");
      expect(geo.searchParams.has("propertyName")).toBe(false);
      expect(geo.searchParams.has("count")).toBe(false);
    });

    it("nunca devolve geometria na resposta", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(biomas));
      const { markdown, structured } = await ibgeMalhasTema({ tema: "biomas", limite: 50 });
      expect(JSON.stringify(structured)).not.toContain("coordinates");
      expect(markdown).not.toContain("coordinates");
    });
  });

  describe("erros que ensinam", () => {
    it("código num recorte que não tem código diz quais têm", async () => {
      const { markdown, isError } = await ibgeMalhasTema({
        tema: "semiarido",
        codigo: "1",
        limite: 50,
      });
      expect(isError).toBe(true);
      expect(markdown).toContain("não tem código por feição");
      expect(markdown).toContain("biomas");
      expect(markdown).toContain("costeiro");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("código não numérico onde o campo é numérico é recusado antes da rede", async () => {
      const { markdown, isError } = await ibgeMalhasTema({
        tema: "biomas",
        codigo: "amazonia",
        limite: 50,
      });
      expect(isError).toBe(true);
      expect(markdown).toContain("código do bioma");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("recorte vazio vira mensagem, não tabela em branco", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(wfs([], 0)));
      const { markdown, isError } = await ibgeMalhasTema({
        tema: "biomas",
        codigo: "99",
        limite: 50,
      });
      expect(isError).toBe(true);
      expect(markdown).toContain("Nenhuma feição encontrada");
      expect(markdown).toContain("99");
    });

    it("falha da fonte vira erro formatado, com a camada nomeada", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 503: Service Unavailable"));
      const { markdown, isError } = await ibgeMalhasTema({ tema: "biomas", limite: 50 });
      expect(isError).toBe(true);
      expect(markdown).toContain("ibge_malhas_tema");
      expect(markdown).toContain("CGMAT:pbqg22_62_Biomas_Biomas");
    });
  });
});
