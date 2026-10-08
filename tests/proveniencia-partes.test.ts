/**
 * Responses that merge reads of different ages (contract §3, measured on
 * 08/10/2026 against 5.8.0). Until then every tool dated its block by ONE cache
 * key — the "main" read — so a response with a part cached since yesterday and
 * a part fetched now went out saying "extracted now". The rule: the block's
 * `retrieved_at` is the OLDEST of the parts, `served_from_cache` is true only
 * if every part came from cache, and `field_sources` names each part.
 *
 * The clock is faked (only `Date`), so "yesterday" is real to the cache and to
 * the network collector alike; `fetch` is routed by URL.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderConcise, type CanonicalProvenance } from "@sbissoli/mcp-provenance";
import { cache, cachedFetch, cacheKey, CACHE_TTL } from "../src/cache.js";
import { ibgeComparar } from "../src/tools/comparar.js";
import { ibgeCidades } from "../src/tools/cidades.js";
import { ibgeSidraMetadados } from "../src/tools/sidra-metadados.js";
import { ibgeSidraTabelas } from "../src/tools/sidra-tabelas.js";
import { ibgeSidra } from "../src/tools/sidra.js";
import { ibgePaises } from "../src/tools/paises.js";
import { ibgeVizinhos } from "../src/tools/vizinhos.js";
import { deepResearchFetch, deepResearchSearch, limparIndice } from "../src/tools/deep-research.js";
import { comColetorDeRede } from "../src/retry.js";
import { mockResponse } from "./helpers.js";

const API = "https://servicodados.ibge.gov.br/api";
const HORA = 3600_000;
const T0 = Date.parse("2026-10-07T12:00:00.000Z");

/** Every trip that reached the (mocked) network, with the fake clock's instant. */
let idas: Array<{ instante: number; url: string }>;

const CABECALHO_FLAT = {
  NC: "Nível Territorial (Código)",
  NN: "Nível Territorial",
  D1C: "Município (Código)",
  D1N: "Município",
  D2C: "Ano (Código)",
  D2N: "Ano",
  V: "Valor",
  MN: "Unidade de Medida",
};

function corpo(url: string): unknown {
  if (/\/localidades\/(municipios|estados)\/\d+$/.test(url)) {
    const id = url.split("/").pop() ?? "";
    return {
      id: Number(id),
      nome: `Lugar ${id}`,
      ...(id.length === 2 ? { sigla: `U${id}` } : {}),
      regiao: { id: 3, sigla: "SE", nome: "Sudeste" },
      microrregiao: {
        id: 35061,
        nome: "São Paulo",
        mesorregiao: {
          id: 3515,
          nome: "Metropolitana de São Paulo",
          UF: { id: 35, sigla: "SP", nome: "São Paulo", regiao: { id: 3, sigla: "SE", nome: "Sudeste" } },
        },
      },
    };
  }
  if (/\/localidades\/estados\/\d+\/municipios$/.test(url)) {
    return [
      { id: 3550308, nome: "São Paulo", microrregiao: { mesorregiao: { UF: { sigla: "SP" } } } },
      { id: 3550407, nome: "Vizinho Um", microrregiao: { mesorregiao: { UF: { sigla: "SP" } } } },
      { id: 3550506, nome: "Vizinho Dois", microrregiao: { mesorregiao: { UF: { sigla: "SP" } } } },
    ];
  }
  if (url.includes("/localidades/municipios?")) {
    return [{ "municipio-id": 3550308, "municipio-nome": "São Paulo", "UF-sigla": "SP" }];
  }
  if (url.includes("/malhas/")) return { type: "FeatureCollection", features: [] };
  if (url.includes("/pesquisas/") && url.includes("/resultados/")) {
    return [{ id: 1, res: [{ localidade: "x", res: { "2022": "123" } }] }];
  }
  if (/\/agregados\/\d+\/metadados$/.test(url)) {
    return {
      id: 6579,
      nome: "Estimativas",
      URL: "https://sidra.ibge.gov.br/tabela/6579",
      pesquisa: "Estimativas de População",
      assunto: "População",
      periodicidade: { frequencia: "anual", inicio: 2001, fim: 2024 },
      nivelTerritorial: { Administrativo: ["N1", "N6"] },
      variaveis: [{ id: 9324, nome: "População", unidade: "Pessoas" }],
      classificacoes: [],
    };
  }
  if (/\/agregados\/\d+\/periodos$/.test(url)) {
    return [
      { id: "2021", literals: ["2021"], modificacao: "x" },
      { id: "2024", literals: ["2024"], modificacao: "x" },
    ];
  }
  if (/\/agregados$/.test(url)) {
    return [
      { id: "1", nome: "Pesquisa", agregados: [{ id: "6579", nome: "Estimativas de população" }] },
    ];
  }
  if (url.includes("/agregados/") && url.includes("view=flat")) {
    if (url.includes("/periodos/2023/")) return [CABECALHO_FLAT]; // the year the table skips
    return [
      CABECALHO_FLAT,
      { ...CABECALHO_FLAT, D1C: "3550308", D1N: "São Paulo - SP", D2C: "2022", D2N: "2022", V: "11451999" },
      { ...CABECALHO_FLAT, D1C: "3304557", D1N: "Rio de Janeiro - RJ", D2C: "2022", D2N: "2022", V: "6211223" },
    ];
  }
  if (url.includes("/paises/BR/indicadores/")) {
    return [{ id: 77827, indicador: "Área total", series: [{ serie: { "2020": "8510000" } }] }];
  }
  if (url.endsWith("/paises/BR")) {
    return [
      {
        id: { M49: 76, "ISO-3166-1-ALPHA-2": "BR", "ISO-3166-1-ALPHA-3": "BRA" },
        nome: { abreviado: "Brasil" },
      },
    ];
  }
  return [];
}

function fetchRoteado() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    idas.push({ instante: Date.now(), url });
    return mockResponse(corpo(url));
  });
}

const em = (ms: number) => vi.setSystemTime(new Date(ms));
const ms = (iso: string | null) => (iso === null ? NaN : Date.parse(iso));

/** The top must be the minimum of the parts — by construction, not by luck. */
function confereTopo(p: CanonicalProvenance): void {
  const partes = p.field_sources ?? [];
  expect(partes.length).toBeGreaterThan(1);
  const menor = Math.min(...partes.map((f) => ms(f.retrieved_at)));
  // The block is formatted to the second; it never says later than the oldest part.
  expect(ms(p.retrieved_at)).toBeLessThanOrEqual(menor);
  expect(menor - ms(p.retrieved_at)).toBeLessThan(1000);
  // And it reaches the wire: contract 1.2 projects field_sources in the concise block.
  expect(renderConcise(p).field_sources?.length).toBe(partes.length);
}

function parte(p: CanonicalProvenance, campo: string) {
  const f = p.field_sources?.find((x) => x.fields.includes(campo));
  expect(f, `parte com o campo ${campo}`).toBeDefined();
  return f!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  em(T0);
  cache.clear();
  limparIndice();
  idas = [];
  global.fetch = fetchRoteado() as unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ibge_comparar — SIDRA (15 min) + locality names (24 h)", () => {
  it("2 h later: values fetched now, names from cache → top at the names' instant", async () => {
    await ibgeComparar({ indicador: "populacao", localidades: "3550308,3304557" });
    em(T0 + 2 * HORA);
    const r = await ibgeComparar({ indicador: "populacao", localidades: "3550308,3304557" });
    const p = r.provenance as CanonicalProvenance;

    confereTopo(p);
    expect(ms(p.retrieved_at)).toBe(T0);
    expect(p.served_from_cache).toBe(false); // the values were fetched now
    const valores = parte(p, "localidades[].valor");
    expect(ms(valores.retrieved_at)).toBe(T0 + 2 * HORA);
    expect(valores.served_from_cache).toBe(false);
    const nome = parte(p, "localidades[3550308].nome");
    expect(ms(nome.retrieved_at)).toBe(T0);
    expect(nome.served_from_cache).toBe(true);
    expect(nome.source_url).toBe(`${API}/v1/localidades/municipios/3550308`);
    // The cache hit is not a trip to the source: only the SIDRA read is counted.
    expect(p.retrieval?.requests).toBe(1);
  });

  it("a name that failed (code used as label) is not a part", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/municipios/3304557")) return mockResponse([]); // absent
      return mockResponse(corpo(url));
    }) as unknown as typeof fetch;
    const r = await ibgeComparar({ indicador: "populacao", localidades: "3550308,3304557" });
    const p = r.provenance as CanonicalProvenance;
    const campos = (p.field_sources ?? []).flatMap((f) => f.fields);
    expect(campos).toContain("localidades[3550308].nome");
    expect(campos).not.toContain("localidades[3304557].nome");
  });
});

describe("ibge_cidades panorama — name (24 h) + eight indicators (1 h)", () => {
  it("2 h later: indicators fetched now, name from cache → top at the name's instant", async () => {
    await ibgeCidades({ tipo: "panorama", municipio: "3550308" });
    em(T0 + 2 * HORA);
    const r = await ibgeCidades({ tipo: "panorama", municipio: "3550308" });
    const p = r.provenance as CanonicalProvenance;

    confereTopo(p);
    expect(ms(p.retrieved_at)).toBe(T0);
    expect(p.served_from_cache).toBe(false);
    const nome = parte(p, "nome");
    expect(nome.served_from_cache).toBe(true);
    expect(ms(nome.retrieved_at)).toBe(T0);
    expect(p.field_sources).toHaveLength(9); // name + 8 indicators
  });

  it("all from cache → served_from_cache true and no retrieval (nothing measured)", async () => {
    await ibgeCidades({ tipo: "panorama", municipio: "3550308" });
    em(T0 + 10 * 60_000);
    const r = await ibgeCidades({ tipo: "panorama", municipio: "3550308" });
    const p = r.provenance as CanonicalProvenance;
    expect(p.served_from_cache).toBe(true);
    expect(p.retrieval).toBeNull();
    expect(ms(p.retrieved_at)).toBe(T0);
  });

  it("populacao failed: the block points at an indicator that IS in the response", async () => {
    // A stale record of populacao from an older call — the old builder dated
    // the block by it even when populacao was not in the answer.
    const urlPop = `${API}/v1/pesquisas/33/indicadores/29171/resultados/3550308`;
    await comColetorDeRede(() => cachedFetch(urlPop, cacheKey(urlPop), CACHE_TTL.MEDIUM));
    em(T0 + 3 * HORA); // the populacao entry expired; its record did not
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === urlPop) return mockResponse({ erro: "x" }, 404);
      return mockResponse(corpo(url));
    }) as unknown as typeof fetch;

    const r = await ibgeCidades({ tipo: "panorama", municipio: "3550308" });
    const p = r.provenance as CanonicalProvenance;
    expect(p.source_url).not.toBe(urlPop);
    expect((p.field_sources ?? []).map((f) => f.source_url)).not.toContain(urlPop);
    expect(ms(p.retrieved_at)).toBe(T0 + 3 * HORA); // not the stale T0
  });
});

describe("ibge_sidra_metadados — metadata + period list (cached apart)", () => {
  it("period list cached 20 h ago, metadata fetched now → top at the periods' instant", async () => {
    const urlPer = `${API}/v3/agregados/6579/periodos`;
    // Seeded the way the empty-result diagnosis of ibge_sidra does (same key).
    await comColetorDeRede(() => cachedFetch(urlPer, cacheKey(urlPer), CACHE_TTL.STATIC));
    em(T0 + 20 * HORA);
    const r = await ibgeSidraMetadados({
      tabela: "6579",
      incluir_periodos: true,
      incluir_localidades: false,
    });
    const p = r.provenance as CanonicalProvenance;

    confereTopo(p);
    expect(ms(p.retrieved_at)).toBe(T0);
    expect(p.served_from_cache).toBe(false);
    expect(parte(p, "periodos").served_from_cache).toBe(true);
    expect(ms(parte(p, "variaveis").retrieved_at)).toBe(T0 + 20 * HORA);
  });

  it("without the period list there is one read and no field_sources", async () => {
    const r = await ibgeSidraMetadados({
      tabela: "6579",
      incluir_periodos: false,
      incluir_localidades: false,
    });
    const p = r.provenance as CanonicalProvenance;
    expect(p.field_sources).toBeNull();
    expect(renderConcise(p)).not.toHaveProperty("field_sources");
  });
});

describe("search — the index outlives the request cache", () => {
  it("a later refetch of /agregados by ibge_sidra_tabelas does not re-date the index", async () => {
    await ibgeSidraTabelas({}); // /agregados extracted at T0
    em(T0 + 23 * HORA);
    await deepResearchSearch("populacao"); // index built at T0+23h from the T0 hit
    em(T0 + 25 * HORA); // the cache entry expired; the index lives until T0+47h
    await ibgeSidraTabelas({}); // /agregados re-extracted at T0+25h
    const { provenance: p } = await deepResearchSearch("populacao");

    confereTopo(p);
    expect(ms(p.retrieved_at)).toBe(T0); // the content searched, not the refetch
    expect(p.served_from_cache).toBe(true);
    expect(ms(parte(p, "results[sidra:*]").retrieved_at)).toBe(T0);
    expect(ms(parte(p, "results[mun:*]").retrieved_at)).toBe(T0 + 23 * HORA);
  });
});

describe("ibge_sidra — empty result explained by the period list", () => {
  it("the explanation's period list (cached) and the empty data (now) are both parts", async () => {
    const urlPer = `${API}/v3/agregados/6579/periodos`;
    await comColetorDeRede(() => cachedFetch(urlPer, cacheKey(urlPer), CACHE_TTL.STATIC));
    em(T0 + 5 * HORA);
    const r = await ibgeSidra({ tabela: "6579", nivel_territorial: "1", periodos: "2023" });
    expect(r.markdown).toContain("não publica");
    const p = r.provenance as CanonicalProvenance;
    confereTopo(p);
    expect(ms(p.retrieved_at)).toBe(T0);
    expect(parte(p, "periodos_disponiveis").served_from_cache).toBe(true);
    expect(parte(p, "registros").served_from_cache).toBe(false);
  });
});

describe("ibge_paises — country record (24 h) + indicators (1 h)", () => {
  it("country refetched while the indicators are cached → top at the indicators' instant", async () => {
    // Indicators cached at T0+23h30, country record at T0 (expires at T0+24h).
    const urlPais = `${API}/v1/paises/BR`;
    await comColetorDeRede(() => cachedFetch(urlPais, cacheKey(urlPais), CACHE_TTL.STATIC));
    em(T0 + 23.5 * HORA);
    const urlInd = `${API}/v1/paises/BR/indicadores/77827|77821|77823|77830`;
    await comColetorDeRede(() => cachedFetch(urlInd, cacheKey(urlInd), CACHE_TTL.MEDIUM));
    em(T0 + 24 * HORA + 60_000);
    const r = await ibgePaises({ tipo: "detalhes", pais: "BR" });
    const p = r.provenance as CanonicalProvenance;

    confereTopo(p);
    expect(ms(p.retrieved_at)).toBe(T0 + 23.5 * HORA);
    expect(parte(p, "pais.indicadores").served_from_cache).toBe(true);
    expect(parte(p, "pais.nome").served_from_cache).toBe(false);
  });
});

describe("ibge_vizinhos — state list + the municipality's own record + populations", () => {
  it("name cached by another tool earlier → top at the name's instant", async () => {
    const urlMun = `${API}/v1/localidades/municipios/3550308`;
    await comColetorDeRede(() => cachedFetch(urlMun, cacheKey(urlMun), CACHE_TTL.STATIC));
    em(T0 + 6 * HORA);
    const r = await ibgeVizinhos({ municipio: "3550308", incluir_dados: true });
    const p = r.provenance as CanonicalProvenance;

    confereTopo(p);
    expect(ms(p.retrieved_at)).toBe(T0);
    expect(parte(p, "municipio.nome").served_from_cache).toBe(true);
    expect(parte(p, "vizinhos[].nome").served_from_cache).toBe(false);
    expect(parte(p, "vizinhos[3550407].populacao").dataset_id).toBe("4709");
    // The mesh request only checks existence: it is not a part.
    expect((p.field_sources ?? []).some((f) => f.source_url.includes("/malhas/"))).toBe(false);
  });
});

describe("fetch (municipality) — hierarchy (24 h) + SIDRA population (15 min)", () => {
  it("hierarchy cached since yesterday → top at the hierarchy's instant", async () => {
    await deepResearchSearch("são paulo"); // builds the index (mun:3550308)
    const urlMun = `${API}/v1/localidades/municipios/3550308`;
    await comColetorDeRede(() => cachedFetch(urlMun, cacheKey(urlMun), CACHE_TTL.STATIC));
    em(T0 + 20 * HORA);
    const r = await deepResearchFetch("mun:3550308");
    expect(r).not.toBeNull();
    const p = r!.provenance;

    confereTopo(p);
    expect(ms(p.retrieved_at)).toBe(T0);
    expect(p.source_url).toContain("/agregados/6579/");
    expect(parte(p, "text.hierarquia").served_from_cache).toBe(true);
    expect(parte(p, "text.populacao").served_from_cache).toBe(false);
  });
});
