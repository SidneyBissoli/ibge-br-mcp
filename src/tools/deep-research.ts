/**
 * `search` / `fetch` — the ChatGPT Deep Research contract (OpenAI), over the
 * IBGE catalog. The contract, the envelope, the ranking and the registration
 * live in `@sbissoli/mcp-search` (portfolio package); this module is the IBGE
 * adapter: what can be found (the index) and how a document reads (the text).
 *
 * Why these two tools exist: ChatGPT deep research, company knowledge and the
 * research workflows of the Responses API only use an MCP server that exposes
 * exactly `search` and `fetch` — the `ibge_*` tools, however rich, are
 * invisible to them. They are the ONLY tools without the `ibge_` prefix
 * (name fixed by OpenAI; `tests/evals/fixtures.test.ts` carries the allowlist).
 *
 * The index (built once per process, rebuilt after `CACHE_TTL.STATIC`):
 *  - `sidra:<tabela>` — every SIDRA table (API de Agregados, the same GET
 *    `ibge_sidra_tabelas` uses), url `https://sidra.ibge.gov.br/tabela/<cod>`;
 *  - `mun:<codigo7>` — the 5,570 municipalities (API de Localidades, flat
 *    `view=nivelado` — half the parse of the nested form), url = Cidades@
 *    panorama page;
 *  - `ind:<chave>` — the known indicators of `ibge_indicadores` (static
 *    dictionary), url = SIDRA page of the backing table.
 *
 * `fetch` renders the document by calling the real tool impls for that id
 * (`ibgeSidraMetadados`; `ibgeLocalidade` + `ibgeSidra` table 6579 for a
 * municipality; `ibgeIndicadores`) and reuses their Markdown as `text` and
 * their provenance block as the envelope extras — so the provenance gate
 * (`tests/provenance-wiring.test.ts`) covers these two the same way it covers
 * the other tools. The municipality document is deliberately NOT the Cidades@
 * panorama (`ibge_cidades`): measured on 2026-09-02 it took 24 s to >60 s per
 * call (the Cidades@ API), and Deep Research fetches documents in series —
 * hierarchy + latest population estimate answer in well under a second, and
 * the text points to `ibge_cidades` for the full panorama.
 */

import {
  attributionList,
  renderConcise,
} from "@sbissoli/mcp-provenance";
import {
  createIndex,
  type EnvelopeExtras,
  type FetchDocument,
  type FetchReply,
  type IndexEntry,
  type SearchIndex,
  type SearchReply,
} from "@sbissoli/mcp-search";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { normalizeText } from "../config.js";
import { withMetrics } from "../metrics.js";
import type { StructuredToolResult } from "../structured.js";
import {
  ATTRIBUTION_META_KEY,
  PROVENANCE_META_KEY,
  provenienciaIbge,
  type Provenance,
} from "../provenance.js";
import { INDICADORES_CONHECIDOS, ibgeIndicadores, indicadoresSchema } from "./indicadores.js";
import { ibgeSidraMetadados, sidraMetadadosSchema } from "./sidra-metadados.js";
import { ibgeLocalidade, localidadeSchema } from "./localidade.js";
import { ibgeSidra, sidraSchema } from "./sidra.js";

/** Prefixes of the document ids, one per kind of document the index holds. */
export const DEEP_RESEARCH_ID_PREFIXES = {
  sidra: "sidra:",
  municipio: "mun:",
  indicador: "ind:",
} as const;

/** Where the citation of a document points (canonical public pages, never the API). */
export const SIDRA_TABELA_URL = "https://sidra.ibge.gov.br/tabela/";
export const CIDADES_PANORAMA_URL = "https://cidades.ibge.gov.br/brasil/";

/** Results per `search` call (the contract has no paging; ten is what the examples show). */
export const DEEP_RESEARCH_LIMIT = 10;

/** SIDRA table/variable of the population estimate quoted in a municipality document. */
const POPULACAO_ESTIMADA = { tabela: "6579", variavel: "9324" } as const;

interface AgregadoItem {
  id: string;
  nome: string;
}

interface PesquisaComAgregados {
  id: string;
  nome: string;
  agregados: AgregadoItem[];
}

/**
 * URL slug of a municipality on cidades.ibge.gov.br: accents stripped,
 * lower case, apostrophes dropped ("Santa Bárbara d'Oeste" → "santa-barbara-doeste"),
 * any other run of non-alphanumerics becomes one hyphen ("Mogi Guaçu" →
 * "mogi-guacu", "Xique-Xique" → "xique-xique").
 */
export function slugCidades(nome: string): string {
  return normalizeText(nome)
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Canonical panorama page of a municipality on Cidades@. */
export function urlPanorama(uf: string, nome: string): string {
  return `${CIDADES_PANORAMA_URL}${uf.toLowerCase()}/${slugCidades(nome)}/panorama`;
}

/** One row of `/localidades/municipios?view=nivelado` (flat; only the fields the index uses). */
export interface MunicipioNivelado {
  "municipio-id": number;
  "municipio-nome": string;
  "UF-sigla": string;
}

/** The static part of the index: the known indicators of `ibge_indicadores`. */
export function entradasIndicadores(): IndexEntry[] {
  return Object.entries(INDICADORES_CONHECIDOS).map(([chave, ind]) => ({
    id: `${DEEP_RESEARCH_ID_PREFIXES.indicador}${chave}`,
    title: `${ind.nome} (indicador ${chave})`,
    url: `${SIDRA_TABELA_URL}${ind.tabela}`,
    keywords: [chave, ind.categoria, ind.periodicidade, `tabela ${ind.tabela}`],
    text: ind.descricao,
  }));
}

/** SIDRA tables → index entries (same payload `ibge_sidra_tabelas` reads). */
export function entradasSidra(pesquisas: PesquisaComAgregados[]): IndexEntry[] {
  const entradas: IndexEntry[] = [];
  for (const pesquisa of pesquisas) {
    for (const agregado of pesquisa.agregados) {
      entradas.push({
        id: `${DEEP_RESEARCH_ID_PREFIXES.sidra}${agregado.id}`,
        title: `Tabela ${agregado.id} — ${agregado.nome}`,
        url: `${SIDRA_TABELA_URL}${agregado.id}`,
        keywords: [agregado.id, pesquisa.id, pesquisa.nome],
      });
    }
  }
  return entradas;
}

/** Municipalities → index entries. Skips rows without a UF sigla (none today; defensive). */
export function entradasMunicipios(municipios: MunicipioNivelado[]): IndexEntry[] {
  const entradas: IndexEntry[] = [];
  for (const m of municipios) {
    const uf = m["UF-sigla"];
    const id = m["municipio-id"];
    const nome = m["municipio-nome"];
    if (!uf || !id || !nome) continue;
    entradas.push({
      id: `${DEEP_RESEARCH_ID_PREFIXES.municipio}${id}`,
      title: `${nome} (${uf})`,
      url: urlPanorama(uf, nome),
      keywords: [String(id), uf, "município"],
    });
  }
  return entradas;
}

interface IndiceCarregado {
  index: SearchIndex;
  porId: Map<string, IndexEntry>;
  /** Cache key of the SIDRA catalog GET — anchors the provenance of `search`. */
  chaveCache: string;
  url: string;
  criadoEm: number;
}

/** `CACHE_TTL` is in minutes (cache.ts); the index age is compared in ms. */
const INDICE_TTL_MS = CACHE_TTL.STATIC * 60 * 1000;

let indiceAtual: IndiceCarregado | null = null;
let carregando: Promise<IndiceCarregado> | null = null;

async function construirIndice(): Promise<IndiceCarregado> {
  const urlAgregados = IBGE_API.AGREGADOS;
  const chaveAgregados = cacheKey(urlAgregados);
  const urlMunicipios = `${IBGE_API.LOCALIDADES}/municipios?orderBy=nome&view=nivelado`;
  const [pesquisas, municipios] = await Promise.all([
    cachedFetch<PesquisaComAgregados[]>(urlAgregados, chaveAgregados, CACHE_TTL.STATIC),
    cachedFetch<MunicipioNivelado[]>(urlMunicipios, cacheKey(urlMunicipios), CACHE_TTL.STATIC),
  ]);
  // Order matters for ties: official catalog first, then places, then the
  // static dictionary.
  const entradas = [
    ...entradasSidra(pesquisas),
    ...entradasMunicipios(municipios),
    ...entradasIndicadores(),
  ];
  return {
    index: createIndex(entradas),
    porId: new Map(entradas.map((e) => [e.id, e])),
    chaveCache: chaveAgregados,
    url: urlAgregados,
    criadoEm: Date.now(),
  };
}

/**
 * The index, built on first use and kept for `CACHE_TTL.STATIC` (the same
 * TTL the upstream payloads live in the cache). Concurrent first calls share
 * one build. A failed build is not kept — the next call retries.
 */
export async function obterIndice(): Promise<IndiceCarregado> {
  if (indiceAtual && Date.now() - indiceAtual.criadoEm < INDICE_TTL_MS) return indiceAtual;
  if (!carregando) {
    carregando = construirIndice()
      .then((i) => {
        indiceAtual = i;
        return i;
      })
      .finally(() => {
        carregando = null;
      });
  }
  return carregando;
}

/** Drops the index (tests). */
export function limparIndice(): void {
  indiceAtual = null;
  carregando = null;
}

/** Envelope extras from a provenance block: the two channels `toMcpResult` also emits. */
export function extrasProveniencia(p: Provenance): EnvelopeExtras {
  const provenance = renderConcise(p);
  const attribution = attributionList([p]);
  return {
    structured: { provenance, attribution },
    meta: { [PROVENANCE_META_KEY]: provenance, [ATTRIBUTION_META_KEY]: attribution },
  };
}

/** What `search`/`fetch` produce before the envelope: the object + the provenance to attach. */
export interface DeepResearchSearch {
  results: SearchReply["results"];
  provenance: Provenance;
}

export interface DeepResearchFetch {
  document: FetchDocument;
  provenance: Provenance;
}

/**
 * `search`: rank the query against the index. Provenance anchors on the SIDRA
 * catalog GET (the real extraction instant of the largest source); the
 * citation names all three sources.
 */
export async function deepResearchSearch(query: string): Promise<DeepResearchSearch> {
  return withMetrics("search", "agregados", async () => {
    const indice = await obterIndice();
    return {
      results: indice.index.search(query, { limit: DEEP_RESEARCH_LIMIT }),
      provenance: provenienciaIbge({
        fonte: "AGREGADOS",
        url: indice.url,
        chaveCache: indice.chaveCache,
        pesquisa:
          "índice de busca (tabelas SIDRA pela API de Agregados, municípios pela API de Localidades, indicadores conhecidos)",
      }),
    };
  });
}

/** Text of a document = the tool's Markdown, minus nothing: the provenance footer is not in it. */
function textoDe(result: StructuredToolResult, tool: string): string {
  if (result.isError === true || result.provenance === undefined) {
    // The tool already rendered a pt-BR error; surface it as the failure reason.
    throw new Error(result.markdown || `\`${tool}\` não devolveu conteúdo`);
  }
  return result.markdown;
}

/**
 * `fetch`: resolve the id in the index (unknown → `null`), then render the
 * document with the real tool for that kind. Upstream failures throw with the
 * tool's own pt-BR message (the factory turns it into an error result).
 */
export async function deepResearchFetch(id: string): Promise<DeepResearchFetch | null> {
  return withMetrics("fetch", "agregados", async () => {
    const indice = await obterIndice();
    const entrada = indice.porId.get(id);
    if (!entrada) return null;

    const base = { id: entrada.id, title: entrada.title, url: entrada.url };

    if (id.startsWith(DEEP_RESEARCH_ID_PREFIXES.sidra)) {
      const tabela = id.slice(DEEP_RESEARCH_ID_PREFIXES.sidra.length);
      // Inputs go through the tool's own schema so its defaults apply.
      const r = await ibgeSidraMetadados(
        sidraMetadadosSchema.parse({ tabela, incluir_periodos: true, incluir_localidades: true })
      );
      const text = textoDe(r, "ibge_sidra_metadados");
      const pesquisa = r.structured?.pesquisa;
      return {
        document: {
          ...base,
          text,
          metadata: {
            tipo: "tabela_sidra",
            tabela,
            ...(typeof pesquisa === "string" ? { pesquisa } : {}),
            consultar_com: "ibge_sidra",
          },
        },
        provenance: r.provenance as Provenance,
      };
    }

    if (id.startsWith(DEEP_RESEARCH_ID_PREFIXES.municipio)) {
      const municipio = id.slice(DEEP_RESEARCH_ID_PREFIXES.municipio.length);
      // Hierarchy (static reference) + the latest population estimate (SIDRA
      // 6579, variable 9324, level N6). Provenance = the SIDRA block: it is
      // the dated datum; the hierarchy is reference data.
      const [hierarquia, populacao] = await Promise.all([
        ibgeLocalidade(localidadeSchema.parse({ codigo: Number(municipio), tipo: "municipio" })),
        ibgeSidra(
          sidraSchema.parse({
            tabela: POPULACAO_ESTIMADA.tabela,
            variaveis: POPULACAO_ESTIMADA.variavel,
            nivel_territorial: "6",
            localidades: municipio,
            periodos: "last",
          })
        ),
      ]);
      const text = [
        `# ${entrada.title}`,
        "",
        textoDe(hierarquia, "ibge_localidade"),
        "",
        "## População residente estimada (SIDRA, Tabela 6579)",
        "",
        textoDe(populacao, "ibge_sidra"),
        "",
        `_Panorama completo (PIB per capita, IDH, escolarização, receitas): \`ibge_cidades\` com municipio="${municipio}"; página pública: ${entrada.url}._`,
      ].join("\n");
      return {
        document: {
          ...base,
          text,
          metadata: {
            tipo: "municipio",
            codigo: municipio,
            populacao_tabela: POPULACAO_ESTIMADA.tabela,
            consultar_com: "ibge_cidades",
          },
        },
        provenance: populacao.provenance as Provenance,
      };
    }

    const chave = id.slice(DEEP_RESEARCH_ID_PREFIXES.indicador.length);
    const ind = INDICADORES_CONHECIDOS[chave];
    const r = await ibgeIndicadores(
      indicadoresSchema.parse({ indicador: chave, nivel_territorial: "1", periodos: "last 5" })
    );
    const text = textoDe(r, "ibge_indicadores");
    return {
      document: {
        ...base,
        text,
        metadata: {
          tipo: "indicador",
          indicador: chave,
          ...(ind ? { tabela: ind.tabela, periodicidade: ind.periodicidade, categoria: ind.categoria } : {}),
          consultar_com: "ibge_indicadores",
        },
      },
      provenance: r.provenance as Provenance,
    };
  });
}

/** Adapters to the factory's reply shapes (`registerAll` wires these). */
export async function searchParaFabrica(query: string): Promise<SearchReply> {
  const { results, provenance } = await deepResearchSearch(query);
  return { results, extras: extrasProveniencia(provenance) };
}

export async function fetchParaFabrica(id: string): Promise<FetchReply | null> {
  const r = await deepResearchFetch(id);
  if (r === null) return null;
  return { document: r.document, extras: extrasProveniencia(r.provenance) };
}
