import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ibgePaises, ALIASES_INDICADORES_PAISES } from "../src/tools/paises.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

/** Real responses of the IBGE Países API, recorded by curl on 15/10/2026. */
function fixture<T>(nome: string): T {
  return JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", nome), "utf8")
  ) as T;
}
const paisBR = fixture<unknown[]>("paises-br.json");
const indicadoresBR = fixture<unknown[]>("paises-br-indicadores.json");
const indicadoresFaixaEscala = fixture<unknown[]>("paises-br-indicadores-faixa-escala.json");
const indicadoresSeriesVazias = fixture<unknown[]>("paises-ar-indicadores-series-vazias.json");
const catalogo = fixture<Array<{ id: number; indicador: string }>>(
  "paises-indicadores-catalogo.json"
);

function lastUrl(): string {
  return String(mockFetch.mock.calls.at(-1)?.[0]);
}

const brasil = {
  id: { M49: 76, "ISO-3166-1-ALPHA-2": "BR", "ISO-3166-1-ALPHA-3": "BRA" },
  nome: { abreviado: "Brasil", "abreviado-EN": "Brazil", "abreviado-ES": "Brasil" },
  area: { total: "8515767.049" },
  localizacao: {
    regiao: { id: { M49: 19 }, nome: "Américas" },
    "sub-regiao": { id: { M49: 419 }, nome: "América Latina e Caribe" },
  },
  linguas: [{ nome: "Português" }],
  "unidades-monetarias": [
    { id: { "ISO-4217-ALPHA": "BRL", "ISO-4217-NUMERICO": "986" }, nome: "Real" },
  ],
  historico: "Texto histórico do Brasil.",
};

const argentina = {
  id: { M49: 32, "ISO-3166-1-ALPHA-2": "AR", "ISO-3166-1-ALPHA-3": "ARG" },
  nome: { abreviado: "Argentina" },
  localizacao: { regiao: { id: { M49: 19 }, nome: "Américas" } },
};

const franca = {
  id: { M49: 250, "ISO-3166-1-ALPHA-2": "FR", "ISO-3166-1-ALPHA-3": "FRA" },
  nome: { abreviado: "França" },
  localizacao: { regiao: { id: { M49: 150 }, nome: "Europa" } },
};

describe("ibge_paises", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("listar", () => {
    it("lists all countries in a table", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([brasil, argentina, franca]));

      const { markdown: result } = await ibgePaises({ tipo: "listar" });

      expect(result).toContain("Países");
      expect(result).toContain("Total:** 3 países");
      expect(result).toContain("Brasil");
      expect(result).toContain("Argentina");
      expect(result).toContain("Américas");
    });

    it("reports empty result when the API returns nothing", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([]));
      const { markdown: result } = await ibgePaises({ tipo: "listar" });
      expect(result).toContain("Nenhum");
    });

    it("filters by regiao (americas keeps only id 19)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([brasil, argentina, franca]));

      const { markdown: result } = await ibgePaises({ tipo: "listar", regiao: "americas" });

      expect(result).toContain("Região: americas");
      expect(result).toContain("Brasil");
      expect(result).toContain("Argentina");
      expect(result).not.toContain("França");
    });

    it("filters by busca substring (case-insensitive)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([brasil, argentina, franca]));

      const { markdown: result } = await ibgePaises({ tipo: "listar", busca: "bras" });

      expect(result).toContain('Busca: "bras"');
      expect(result).toContain("Brasil");
      expect(result).not.toContain("Argentina");
    });

    it("reports empty result when busca matches nothing", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([brasil, argentina, franca]));
      const { markdown: result } = await ibgePaises({ tipo: "listar", busca: "zzzzz" });
      expect(result).toContain('Nenhum país encontrado para "zzzzz"');
    });
  });

  describe("buscar", () => {
    it("requires a busca term", async () => {
      const { markdown: result } = await ibgePaises({ tipo: "buscar" });
      expect(result).toContain("termo de busca");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("delegates to listing with the search filter", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([brasil, argentina, franca]));
      const { markdown: result } = await ibgePaises({ tipo: "buscar", busca: "argent" });
      expect(result).toContain("Argentina");
      expect(result).not.toContain("Brasil");
    });
  });

  describe("detalhes", () => {
    it("requires a pais code", async () => {
      const { markdown: result } = await ibgePaises({ tipo: "detalhes" });
      expect(result).toContain("ISO-ALPHA-2");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("renders identification, location, area, languages, currency, history and indicators", async () => {
      // 1st fetch: country detail; 2nd fetch: indicators
      mockFetch.mockResolvedValueOnce(mockResponse([brasil]));
      mockFetch.mockResolvedValueOnce(mockResponse(indicadoresBR));

      const { markdown: result } = await ibgePaises({ tipo: "detalhes", pais: "br" });

      expect(lastUrl()).toContain("/indicadores/");
      expect(result).toContain("## Brasil");
      expect(result).toContain("Código M49:** 76");
      expect(result).toContain("ISO Alpha-2:** BR");
      expect(result).toContain("Américas");
      expect(result).toContain("km²");
      expect(result).toContain("Português");
      expect(result).toContain("Real (BRL)");
      expect(result).toContain("Texto histórico");
      expect(result).toContain("População - População total:** 211140729 habitantes (2023)");
      expect(result).toContain("Ferramentas Relacionadas");
    });

    // Real shape of /paises/{p}/indicadores/{ids} (fixtures recorded by curl
    // on 15/10/2026): `serie` is a LIST of one-key objects in chronological
    // order, opened by {"-": null}, with 5-year ranges interleaved and nulls
    // at the tail. The original mock was a `Record` copied from the type —
    // the very shape the code mistook the list for.
    it("reads the latest non-null value of the real list-shaped series", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(paisBR));
      mockFetch.mockResolvedValueOnce(mockResponse(indicadoresBR));

      const { markdown, structured } = await ibgePaises({ tipo: "detalhes", pais: "BR" });

      expect(lastUrl()).toMatch(/\/paises\/BR\/indicadores\/77849\|77827\|77823\|77831\|77830$/);
      expect(markdown).not.toContain("[object Object]");
      const pais = (structured as { pais: Record<string, unknown> }).pais;
      const porId = new Map(
        (pais.indicadores as Array<{ id: number }>).map((i) => [i.id, i] as const)
      );
      expect(porId.get(77849)).toEqual({
        id: 77849,
        indicador: "População - População total",
        valor: "211140729",
        ano: "2023",
        unidade: "habitantes",
        multiplicador: 1,
      });
      expect(porId.get(77827)).toMatchObject({ valor: "2173665655937.27", ano: "2023", unidade: "US$" });
      expect(porId.get(77823)).toMatchObject({ valor: "10294.87", ano: "2023" });
      // Trailing nulls are skipped: the last published year is 2022.
      expect(porId.get(77830)).toMatchObject({ valor: "73.425", ano: "2022", unidade: "anos" });
      // The HDI comes without `unidade` in the source.
      expect(porId.get(77831)).toMatchObject({ valor: "0.76", ano: "2022", unidade: null, multiplicador: null });
    });

    // Real answer for Argentina (15/10/2026): every indicator with `series: []`.
    it("a country the source has no series for: indicators reported without value", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([argentina]));
      mockFetch.mockResolvedValueOnce(mockResponse(indicadoresSeriesVazias));

      const { markdown, structured } = await ibgePaises({
        tipo: "detalhes",
        pais: "AR",
        indicadores: "idh|pib_per_capita",
      });

      const pais = (structured as { pais: Record<string, unknown> }).pais;
      expect(pais.indicadores).toBeUndefined();
      expect(pais.indicadoresSemValor).toEqual([
        { id: 77831, indicador: "Indicadores sociais - Índice de desenvolvimento humano" },
        { id: 77823, indicador: "Economia - PIB per capita" },
      ]);
      expect(markdown).not.toContain("[object Object]");
    });

    it("keeps the area's decimal fraction (the source writes it with a comma)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(paisBR));
      mockFetch.mockResolvedValueOnce(mockResponse(indicadoresBR));

      const { structured } = await ibgePaises({ tipo: "detalhes", pais: "BR" });

      expect((structured as { pais: { areaTotalKm2: number } }).pais.areaTotalKm2).toBe(8509360.85);
    });

    it("honours `indicadores` (ids): range periods, text values and the scale", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(paisBR));
      mockFetch.mockResolvedValueOnce(mockResponse(indicadoresFaixaEscala));

      const { markdown, structured } = await ibgePaises({
        tipo: "detalhes",
        pais: "BR",
        indicadores: "77834|77841",
      });

      expect(lastUrl()).toMatch(/\/indicadores\/77834\|77841$/);
      const lista = (structured as { pais: { indicadores: unknown[] } }).pais.indicadores;
      expect(lista).toContainEqual(
        expect.objectContaining({ id: 77834, valor: "3.9", ano: "2021-2023", unidade: "%" })
      );
      expect(lista).toContainEqual(
        expect.objectContaining({ id: 77841, valor: "22.70", ano: "2023", unidade: "m³", multiplicador: 1e9 })
      );
      expect(markdown).toContain("multiplicador");
    });

    it("honours `indicadores` given as aliases", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(paisBR));
      mockFetch.mockResolvedValueOnce(mockResponse(indicadoresBR));

      await ibgePaises({ tipo: "detalhes", pais: "BR", indicadores: "idh|populacao" });

      expect(lastUrl()).toMatch(/\/indicadores\/77831\|77849$/);
    });

    it("rejects an unknown alias before calling the source", async () => {
      const r = await ibgePaises({ tipo: "detalhes", pais: "BR", indicadores: "mortalidade_infantil" });

      expect(r.isError).toBe(true);
      expect(r.markdown).toContain("mortalidade_infantil");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("an indicator with no published value is reported apart, not dropped", async () => {
      const semValor = structuredClone(indicadoresBR[0]) as {
        series: Array<{ serie: Array<Record<string, string | null>> }>;
      };
      semValor.series[0].serie = semValor.series[0].serie.map((o) => ({
        [Object.keys(o)[0]]: null,
      }));
      mockFetch.mockResolvedValueOnce(mockResponse(paisBR));
      mockFetch.mockResolvedValueOnce(mockResponse([semValor]));

      const { markdown, structured, provenance } = await ibgePaises({ tipo: "detalhes", pais: "BR" });

      const pais = (structured as { pais: Record<string, unknown> }).pais;
      expect(pais.indicadores).toBeUndefined();
      expect(pais.indicadoresSemValor).toEqual([
        { id: 77823, indicador: "Economia - PIB per capita" },
      ]);
      expect(markdown).toContain("PIB per capita:** sem valor publicado");
      // Still a part read from the indicators endpoint.
      const fontes = (provenance as { field_sources?: Array<{ fields: string[]; source_url: string }> })
        .field_sources;
      expect(fontes?.find((f) => f.fields.includes("pais.indicadoresSemValor"))?.source_url).toContain(
        "/indicadores/"
      );
    });

    it("still renders details when the indicators fetch fails", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([brasil]));
      mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));

      const { markdown: result } = await ibgePaises({ tipo: "detalhes", pais: "BR" });

      expect(result).toContain("## Brasil");
      expect(result).toContain("Ferramentas Relacionadas");
    });

    it("returns notFound for an unknown country", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([]));
      const { markdown: result } = await ibgePaises({ tipo: "detalhes", pais: "ZZ" });
      expect(result).toContain("não encontrado");
    });
  });

  describe("indicadores", () => {
    it("derives the catalog from the source, with unit and scale", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(catalogo));

      const { markdown, structured } = await ibgePaises({ tipo: "indicadores" });

      expect(lastUrl()).toMatch(/\/paises\/indicadores\/?$/);
      expect(markdown).toContain("Indicadores de Países Disponíveis");
      const lista = (structured as { indicadores: Array<Record<string, unknown>> }).indicadores;
      expect(lista).toHaveLength(catalogo.length);
      expect(lista).toContainEqual({
        id: 77849,
        nome: "População - População total",
        alias: "populacao",
        unidade: "habitantes",
        multiplicador: 1,
      });
      expect(lista).toContainEqual(
        expect.objectContaining({ id: 77831, alias: "idh", unidade: null, multiplicador: null })
      );
      // No alias → the id itself, which is what `indicadores` accepts.
      expect(lista).toContainEqual(
        expect.objectContaining({ id: 77842, alias: "77842", multiplicador: 1000 })
      );
    });

    // Each alias is a hand-written id: check it against the PUBLISHED catalog
    // (real copy in tests/fixtures), so a wrong id cannot pass as the
    // meaning the alias promises — the defect of 5.9.0 and earlier.
    it.each([
      ["populacao", /População total$/],
      ["densidade", /Densidade demográfica$/],
      ["pib", /Total do PIB$/],
      ["pib_per_capita", /PIB per capita$/],
      ["idh", /Índice de desenvolvimento humano$/],
      ["expectativa_vida", /Esperança de vida ao nascer$/],
    ])("alias %s points at the indicator it names", (alias, nome) => {
      const id = ALIASES_INDICADORES_PAISES[alias];
      expect(catalogo.find((i) => i.id === id)?.indicador).toMatch(nome);
    });

    it("every alias is covered by the check above", () => {
      expect(Object.keys(ALIASES_INDICADORES_PAISES).sort()).toEqual(
        ["densidade", "expectativa_vida", "idh", "pib", "pib_per_capita", "populacao"]
      );
    });
  });

  describe("errors", () => {
    it("surfaces upstream HTTP errors for listing", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));
      const { markdown: result } = await ibgePaises({ tipo: "listar" });
      expect(result).toContain("Erro");
    });
  });
});
