/**
 * Provenance block (portfolio contract; version in `provenanceContext`) — pt-BR adapter over
 * `@sbissoli/mcp-provenance`. The canonical model, the `concise`/`detailed`
 * projections, serialization determinism, timezone handling and the footer
 * wording live in the package; this module binds them to the IBGE server:
 *
 *  - one `ProvenanceContext` for the whole server (namespace
 *    `br.com.sidneybissoli.ibge`, pt-BR footer, Brasília time, `concise` mode);
 *  - the source registry (`FONTES_IBGE`) — one entry per IBGE API consumed;
 *  - the normative license block (no explicit license upstream — the legal
 *    basis is LAI + Decreto 8.777/2016, verbatim verification `ibge/docs/01`,
 *    2026-08-08). Never use the IBGE logo/brand;
 *  - `provenienciaIbge(...)`, the per-call builder every tool uses. It pulls
 *    the REAL extraction instant (`retrieved_at`) and `served_from_cache` from
 *    the cache layer via `lastFetchMeta` (contract: cache hits keep the
 *    original fetch instant — it is the legally relevant extraction date) —
 *    or, for a response that merges several reads (`partes`, since 5.8.1),
 *    from what the call's collector saw of each one: the OLDEST instant on top,
 *    cache only if every part was, one `field_sources` entry per part — and
 *    since 5.4.0 the `retrieval` block (v1.1) from the network collector of the
 *    call (`@sbissoli/mcp-upstream`, opened by `withMetrics` — see `retry.ts`):
 *    how many requests went to the IBGE, how many attempts they took and which
 *    anomalies were overcome. `null` when nothing was measured — response served
 *    only from cache, or a direct call outside a tool (tests) — never an
 *    invented `{ requests: 1, attempts: 1 }`.
 *
 * Emission happens in `toMcpResult` (`structured.ts`): tools attach the
 * canonical block to their `StructuredToolResult` and the handler emits the
 * three channels — `structuredContent.provenance` + `attribution` (parseable,
 * visible to the model), `_meta` under namespaced keys (out-of-band, zero
 * model tokens), and the compact text footer appended to the Markdown.
 *
 * `derived` semantics (same rule as senado-br-mcp): raw data that is only
 * filtered/paginated/reserialized → `false`; the D2 statistics modes
 * (aggregation/rankings computed server-side) → `true` + `derivation_note`.
 */

import { z } from "zod";
import {
  attributionList,
  CONCISE_BLOCK_JSON_SCHEMA,
  ConciseBlockSchema,
  createProvenanceContext,
  renderConcise,
  type CanonicalProvenance,
  type ConciseBlock,
} from "@sbissoli/mcp-provenance";
import { currentCall } from "@sbissoli/mcp-upstream/als";
import { lastFetchMeta } from "./cache.js";
import { API_ENDPOINTS } from "./config.js";

/** Single provenance context for the server: `_meta` namespace, locale, timezone, mode. */
export const provenanceContext = createProvenanceContext({
  metaNamespace: "br.com.sidneybissoli.ibge",
  locale: "pt-BR",
  timezone: { offset: "-03:00", label: "horário de Brasília" },
  defaultMode: "concise",
  // 1.2: `field_sources` goes out on responses that merge sub-sources — since
  // 5.8.1 the tools that read several endpoints in one answer pass them as
  // `partes` (see `provenienciaIbge`). The 1.3 keys are already declared by the
  // schema; emitting them is the next step.
  contractVersion: "1.2",
});

/** Canonical envelope (post-validation); its `contract_version` is `provenanceContext.contractVersion`. */
export type Provenance = CanonicalProvenance;

/** Namespaced `_meta` keys (stable — audit/UI consumers read by these keys). */
export const PROVENANCE_META_KEY = provenanceContext.metaKeys.provenance;
export const ATTRIBUTION_META_KEY = provenanceContext.metaKeys.attribution;

/**
 * Normative license block (shared by every response): the IBGE APIs declare no
 * license of their own — the legal regime is LAI (Lei 12.527/2011) + Decreto
 * 8.777/2016 (unrestricted reuse, free use, obligation limited to crediting
 * the source). Verbatim verification: `ibge/docs/01`, 2026-08-08.
 */
export const IBGE_LICENSE = {
  id: null,
  name: "Dados abertos do Poder Executivo federal (Lei 12.527/2011; Decreto 8.777/2016)",
  url: null,
  terms_url: "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2016/decreto/d8777.htm",
  verified_at: "2026-08-08",
} as const;

/**
 * What the SIDRA does to numbers already published — the same sentence the
 * server instructions carry (`SERVER_INSTRUCTIONS` in `server.ts`; a test keeps
 * the two together). It is the `revision.note` of the two SIDRA-backed sources.
 */
export const NOTA_REVISAO_SIDRA =
  "O IBGE revisa números já divulgados (PIB trimestral a cada divulgação, reponderação da PNAD, revisões anuais de PIM, PMC e PMS) e a API não guarda a versão anterior.";

/**
 * Revision status of the IBGE sources (contract v1.3, owner's decision of
 * 08/10/2026): `current` for every one — the value is the version in force at
 * the extraction instant and the source may revise it. `final` needs proof from
 * the source and nobody uses it yet. The note is the source's own story when the
 * server already tells it (SIDRA), `null` otherwise — never a new claim.
 */
const REVISAO_VIGENTE = { status: "current", note: null } as const;
const REVISAO_SIDRA = { status: "current", note: NOTA_REVISAO_SIDRA } as const;

/**
 * Source registry — one entry per IBGE API this server consumes. `name` is
 * what the concise projection shows as `source`; `endpoint` is the base URL
 * actually queried; `revision` is fixed per source (see `REVISAO_VIGENTE`).
 * Text only, never the IBGE logo/brand (docs/01).
 */
export const FONTES_IBGE = {
  LOCALIDADES: {
    name: "IBGE — API de Localidades",
    endpoint: API_ENDPOINTS.IBGE.LOCALIDADES,
    revision: REVISAO_VIGENTE,
  },
  SIDRA: {
    name: "IBGE — SIDRA (Banco de Tabelas Estatísticas)",
    endpoint: API_ENDPOINTS.SIDRA,
    revision: REVISAO_SIDRA,
  },
  AGREGADOS: {
    name: "IBGE — API de Agregados (SIDRA)",
    endpoint: API_ENDPOINTS.IBGE.AGREGADOS,
    revision: REVISAO_SIDRA,
  },
  NOMES: {
    name: "IBGE — API de Nomes (Censo Demográfico 2010)",
    endpoint: API_ENDPOINTS.IBGE.NOMES,
    revision: REVISAO_VIGENTE,
  },
  MALHAS: {
    name: "IBGE — API de Malhas Geográficas",
    endpoint: API_ENDPOINTS.IBGE.MALHAS,
    revision: REVISAO_VIGENTE,
  },
  GEOSERVICOS: {
    name: "IBGE — Geosserviços (WFS, IBGE Geociências)",
    endpoint: API_ENDPOINTS.IBGE.GEOSERVICOS,
    revision: REVISAO_VIGENTE,
  },
  NOTICIAS: {
    name: "IBGE — API de Notícias",
    endpoint: API_ENDPOINTS.IBGE.NOTICIAS,
    revision: REVISAO_VIGENTE,
  },
  POPULACAO: {
    name: "IBGE — API de Projeções de População",
    endpoint: API_ENDPOINTS.IBGE.POPULACAO,
    revision: REVISAO_VIGENTE,
  },
  CNAE: {
    name: "IBGE — API CNAE",
    endpoint: API_ENDPOINTS.IBGE.CNAE,
    revision: REVISAO_VIGENTE,
  },
  CALENDARIO: {
    name: "IBGE — API de Calendário de Divulgações",
    endpoint: API_ENDPOINTS.IBGE.CALENDARIO,
    revision: REVISAO_VIGENTE,
  },
  PAISES: {
    name: "IBGE — API de Países",
    endpoint: API_ENDPOINTS.IBGE.PAISES,
    revision: REVISAO_VIGENTE,
  },
  PESQUISAS: {
    name: "IBGE — API de Pesquisas (Cidades@)",
    endpoint: API_ENDPOINTS.IBGE.PESQUISAS,
    revision: REVISAO_VIGENTE,
  },
} as const;

export type FonteIbge = keyof typeof FONTES_IBGE;

/** "dd/mm/aaaa" of an instant in Brasília time, for the citation text. */
function dataCitacao(retrievedAt: Date | string): string {
  const iso =
    retrievedAt instanceof Date
      ? // -03:00 fixed offset (Brazil has no DST since 2019).
        new Date(retrievedAt.getTime() - 3 * 60 * 60 * 1000).toISOString()
      : retrievedAt;
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export interface ProvenienciaIbgeOptions {
  /** Which IBGE API answered this response. */
  fonte: FonteIbge;
  /** The URL effectively queried (canonical reproduction of the request). */
  url: string;
  /**
   * Cache key of the main `cachedFetch` call — used to pull the REAL upstream
   * extraction instant and `served_from_cache` from the cache layer. Omit only
   * for static catalogs maintained in code (contract: builder default).
   */
  chaveCache?: string;
  /** "[pesquisa/tabela]" of the citation, e.g. "SIDRA, Tabela 6579 (Estimativas de população)". */
  pesquisa: string;
  /** Dataset identifier within the source (e.g. the SIDRA table code), when there is one. */
  dataset?: string;
  /** Reference period exposed by the source (SIDRA period); null/omitted when not exposed. */
  dataVintage?: string | null;
  /** D2 statistics modes: the server derived aggregates from the raw records. */
  derivado?: { nota: string };
  /**
   * The parts of a response that MERGES several reads (endpoints, sources, or
   * the same API at different instants) — one entry per part, the main one
   * included. With `partes`, `chaveCache` is not read: each part's instant and
   * cache status come from what THIS call read (the collector's accesses —
   * network trips and cache hits alike, `cachedFetch` records both), the top
   * `retrieved_at` is the OLDEST of them, `served_from_cache` is true only if
   * every part came from cache, and `field_sources` carries one entry per part
   * (contract §3). A part this call did not read is not in the response and is
   * dropped — the block never points at data it does not carry.
   */
  partes?: ParteDaResposta[];
  /**
   * Extraction already known to the caller — for data the server holds in its
   * own memory beyond the request cache (the deep-research index), whose
   * instant no access of this call can tell. Wins over `chaveCache`.
   */
  extracao?: { retrievedAt: Date; servedFromCache: boolean | null };
}

/** One part of a merged response: the payload fields it produced and where it lives. */
export interface ParteDaResposta {
  /** Payload fields this part produced (what `field_sources[].fields` names). */
  fields: string[];
  /** The URL of this part (what it reproduces); default filter of the accesses. */
  url: string;
  /** Which accesses of the call belong to this part. Default: URL equal to `url`. */
  filtro?: (url: string) => boolean;
  /** Instant known to the caller instead of the collector (see `extracao`). */
  extracao?: { retrievedAt: Date; servedFromCache: boolean | null };
  /** Instant known to the caller, used only when the collector did not see this part. */
  reserva?: { retrievedAt: Date; servedFromCache: boolean | null };
  dataset?: string | null;
  dataVintage?: string | null;
}

/** A part as read: its instant and cache status, or `null` when this call did not read it. */
interface ParteLida {
  fields: string[];
  source_url: string;
  dataset_id: string | null;
  data_vintage: string | null;
  retrieved_at: string;
  served_from_cache: boolean | null;
}

function lerPartes(partes: ParteDaResposta[]): ParteLida[] {
  const call = currentCall();
  const lidas: ParteLida[] = [];
  for (const p of partes) {
    const base = {
      fields: p.fields,
      source_url: p.url,
      dataset_id: p.dataset ?? null,
      data_vintage: p.dataVintage ?? null,
    };
    const conhecida = (e: { retrievedAt: Date; servedFromCache: boolean | null }): ParteLida => ({
      ...base,
      retrieved_at: e.retrievedAt.toISOString(),
      served_from_cache: e.servedFromCache,
    });
    if (p.extracao) {
      lidas.push(conhecida(p.extracao));
      continue;
    }
    const lida = call?.fieldSource({
      fields: p.fields,
      source_url: p.url,
      filter: p.filtro ?? ((u: string) => u === p.url),
    });
    if (lida && lida.retrieved_at !== null) {
      lidas.push({
        ...base,
        retrieved_at: lida.retrieved_at,
        served_from_cache: lida.served_from_cache,
      });
    } else if (p.reserva) {
      lidas.push(conhecida(p.reserva));
    }
    // Otherwise this call did not read the part: it is not in the response.
  }
  return lidas;
}

/** True only if every part came from cache; false if any was fetched now; null if any is unknown. */
function cacheDasPartes(lidas: ParteLida[]): boolean | null {
  if (lidas.some((p) => p.served_from_cache === false)) return false;
  if (lidas.some((p) => p.served_from_cache === null)) return null;
  return true;
}

/**
 * Builds the canonical provenance block for one tool response. Citation
 * follows the pattern fixed by the verbatim verification (docs/01):
 * "Fonte: IBGE — [pesquisa/tabela], [URL], extraído em [data]."
 */
export function provenienciaIbge(opts: ProvenienciaIbgeOptions): Provenance {
  const fonte = FONTES_IBGE[opts.fonte];
  const lidas = opts.partes ? lerPartes(opts.partes) : [];
  let meta: { retrievedAt: Date; servedFromCache: boolean | null } | null;
  if (lidas.length > 0) {
    // The OLDEST part is the top: "nothing here is older than this" (§3) — by
    // construction, so the lib's 1.2 check (top newer than a sub-source is a
    // `ProvenanceContractError`) can never fire.
    meta = {
      retrievedAt: new Date(Math.min(...lidas.map((p) => Date.parse(p.retrieved_at)))),
      servedFromCache: cacheDasPartes(lidas),
    };
  } else if (opts.extracao) {
    meta = opts.extracao;
  } else {
    meta = opts.chaveCache ? lastFetchMeta(opts.chaveCache) : null;
  }
  const retrievedAt = meta?.retrievedAt ?? new Date();
  // `field_sources` only when the response really merged sub-sources: a single
  // part read is a single extraction, and the contract leaves the key out then.
  const fieldSources = lidas.length > 1 ? lidas : undefined;

  return provenanceContext.build({
    source: { name: fonte.name, agency: "IBGE", database: null, endpoint: fonte.endpoint },
    source_url: opts.url,
    ...(opts.dataset !== undefined ? { dataset: opts.dataset } : {}),
    data_vintage: opts.dataVintage ?? null,
    retrieved_at: retrievedAt,
    citation: `Fonte: IBGE — ${opts.pesquisa}, ${opts.url}, extraído em ${dataCitacao(retrievedAt)}.`,
    license: IBGE_LICENSE,
    derived: opts.derivado !== undefined,
    ...(opts.derivado !== undefined ? { derivation_note: opts.derivado.nota } : {}),
    // Informed now, on the wire only once the context emits 1.3 (the lib drops
    // it from 1.1/1.2 blocks).
    revision: fonte.revision,
    served_from_cache: meta ? meta.servedFromCache : null,
    // The REAL count of this call (requests, attempts, anomalies), measured by
    // the collector `withMetrics` opened; `null` = not measured (cache only, or
    // no collector), which the contract prefers over an invented clean block.
    retrieval: currentCall()?.retrieval() ?? null,
    ...(fieldSources ? { field_sources: fieldSources } : {}),
  });
}

/** Fixed derivation note for the D2 statistics modes (estatisticas/agruparPor/topN). */
export const NOTA_DERIVACAO_ESTATISTICAS =
  "Estatísticas (distribuição, agregados e rankings) computadas pelo servidor a partir dos registros brutos retornados pela fonte; os valores individuais permanecem os originais do IBGE.";

/**
 * Reference period of a SIDRA-style result, extracted from the standard period
 * column when the source exposes one (docs/03: "período SIDRA quando exposto;
 * null senão"). Distinct values are joined as a deterministic range
 * ("2022" or "2020–2023"); no period column → null.
 *
 * The range shows the readable label but is ORDERED by the period code SIDRA
 * sends alongside it ("Mês (Código)" 202403 next to "Mês" "março 2024"). Until
 * 5.7.0 the labels were sorted as text, which is right only for bare years:
 * January–December 2024 came out as "abril 2024–setembro 2024", and "1º
 * trimestre 2024" sorted before "2º trimestre 2023". Without a code column the
 * label itself is the key (years, the only case where text order is time order).
 */
export function extrairPeriodoSidra(
  colunas: string[],
  registros: Array<Record<string, string>>
): string | null {
  const candidatas = colunas.filter((c) =>
    /^(ano|trimestre|m[eê]s|semestre|per[ií]odo)\b/i.test(c)
  );
  // SIDRA exposes "(Código)"/plain column pairs — show the readable label,
  // order by its code.
  const rotulo = candidatas.find((c) => !/\(c[oó]digo\)/i.test(c)) ?? candidatas[0];
  if (!rotulo) return null;
  const base = rotulo.replace(/\s*\(c[oó]digo\)\s*$/i, "");
  const colunaCodigo = candidatas.find(
    (c) =>
      c !== rotulo && /\(c[oó]digo\)/i.test(c) && c.replace(/\s*\(c[oó]digo\)\s*$/i, "") === base
  );

  const porRotulo = new Map<string, string>();
  for (const r of registros) {
    const v = r[rotulo];
    if (!v || porRotulo.has(v)) continue;
    porRotulo.set(v, colunaCodigo ? (r[colunaCodigo] ?? v) : v);
  }
  if (porRotulo.size === 0) return null;

  const chave = (codigo: string): number | string =>
    /^\d+$/.test(codigo) ? Number(codigo) : codigo;
  const ordenados = [...porRotulo.entries()].sort(([, a], [, b]) => {
    const ka = chave(a);
    const kb = chave(b);
    if (typeof ka === "number" && typeof kb === "number") return ka - kb;
    return String(ka).localeCompare(String(kb));
  });
  const primeiro = ordenados[0]?.[0] ?? null;
  const ultimo = ordenados[ordenados.length - 1]?.[0] ?? null;
  if (primeiro === null || ultimo === null) return null;
  return primeiro === ultimo ? primeiro : `${primeiro}–${ultimo}`;
}

/**
 * IBGE wording for the top-level keys of the concise block. Typed against the
 * package's shape on purpose: a key the contract adds and this map does not
 * describe fails to compile, instead of reaching the client undescribed.
 */
const DESCRICOES_IBGE: Record<keyof typeof ConciseBlockSchema.shape, string> = {
  source: "Fonte oficial do dado (API do IBGE consultada)",
  source_url: "URL canônica que reproduz a consulta",
  data_vintage: "Período de referência do dado segundo a fonte; null se a fonte não expõe",
  retrieved_at: "Instante real da extração no upstream (ISO-8601, horário de Brasília)",
  retrieval:
    "Diagnóstico de origem desta chamada: idas à API do IBGE, tentativas somadas e anomalias contornadas; unstable=true quando houve anomalia. null quando nada foi medido (resposta servida só do cache)",
  citation: "Citação pronta para uso",
  license: "Regime legal do dado",
  field_sources:
    "Proveniência por sub-fonte: presente só quando a resposta junta partes extraídas de origens ou em momentos distintos, uma entrada por grupo de campos; ausente quando a resposta vem de uma única extração",
  notices:
    "Avisos que o IBGE publica junto com o dado (quebra de série, unidade, atualização), copiados como vieram; ausente quando não há aviso",
  derived:
    "Presente (true) só quando o servidor calculou o valor — estatísticas, rankings, comparações — em vez de repassá-lo como veio do IBGE",
  derivation_note: "O que o servidor calculou; presente junto com derived",
  revision:
    "Se o dado ainda pode mudar no IBGE: current = versão vigente na extração, que o IBGE pode revisar depois; provisional = preliminar; final = não muda mais. note traz o específico da fonte quando há",
};

/** The subset of JSON Schema the walker reads: descriptions, and where the children are. */
interface NoJsonSchema {
  description?: string;
  type?: string | readonly string[];
  properties?: Record<string, NoJsonSchema>;
  items?: NoJsonSchema;
  oneOf?: readonly NoJsonSchema[];
}

/**
 * Grafts descriptions onto a zod schema, node by node, from the JSON Schema
 * the package publishes for the same projection (`overrides` win at the top
 * level). The SHAPE — keys, types, strictness — stays the package's.
 */
function descreverPeloJsonSchema(
  schema: z.ZodType,
  no: NoJsonSchema | undefined,
  overrides: Partial<Record<string, string>> = {},
  /** Description of THIS node; `undefined` = the JSON Schema's, `""` = none (the parent carries it). */
  texto: string | undefined = no?.description
): z.ZodType {
  let saida: z.ZodType;
  if (schema instanceof z.ZodNullable) {
    // `x | null` is `oneOf: [x, null]` (retrieval) or `type: [x, "null"]` (vintage).
    const interno = no?.oneOf ? no.oneOf.find((n) => n.type !== "null") : no;
    saida = descreverPeloJsonSchema(schema.unwrap() as z.ZodType, interno, {}, "").nullable();
  } else if (schema instanceof z.ZodOptional) {
    // The keys added after v1.1 (`field_sources`, and the four of v1.3) are
    // optional: walk into them so the package's text reaches their children,
    // and keep them optional — out of `required` in the listed schema.
    saida = descreverPeloJsonSchema(schema.unwrap() as z.ZodType, no, {}, "").optional();
  } else if (schema instanceof z.ZodArray) {
    // `clone` keeps the array's checks (`.min(1)` of field_sources/notices);
    // rebuilding it with `z.array(...)` would drop them.
    saida = schema.clone({
      ...schema.def,
      element: descreverPeloJsonSchema(schema.element as z.ZodType, no?.items),
    });
  } else if (schema instanceof z.ZodObject) {
    saida = z.strictObject(
      Object.fromEntries(
        Object.entries(schema.shape).map(([chave, filho]) => [
          chave,
          descreverPeloJsonSchema(
            filho as z.ZodType,
            no?.properties?.[chave],
            {},
            overrides[chave] ?? no?.properties?.[chave]?.description
          ),
        ])
      )
    );
  } else {
    saida = schema;
  }
  return texto ? saida.describe(texto) : saida;
}

/**
 * Concise projection of a block — the shape embedded in `structuredContent`
 * and `_meta`, and the `provenance` node of every tool's `outputSchema`.
 *
 * The shape is the package's `ConciseBlockSchema`, not a transcription. Found
 * on 26/09/2026: this module transcribed the six v1.0 keys by hand, the SDK
 * validates `structuredContent` against the sealed `outputSchema` at runtime,
 * and raising the package to a contract with a new key (v1.1, `retrieval`)
 * without touching the transcription failed EVERY tool call — "must NOT have
 * additional properties", 48 tests. Importing the shape means a new key
 * arrives together with the lib that emits it. Descriptions are the IBGE
 * wording at the top level and the package's own pt-BR text underneath.
 */
export const provenanceBlockSchema = descreverPeloJsonSchema(
  ConciseBlockSchema,
  CONCISE_BLOCK_JSON_SCHEMA,
  DESCRICOES_IBGE
) as typeof ConciseBlockSchema;

/**
 * Extends a tool's output schema with the provenance channel of the contract:
 * the concise block + the `attribution` URL list (MCP RFC #711). Every
 * successful response carries both (wired in `toMcpResult`).
 */
export function comProveniencia<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return schema.extend({
    provenance: provenanceBlockSchema.describe(
      "Bloco de proveniência do portfólio: fonte, URL, período, extração, diagnóstico de origem e licença"
    ),
    attribution: z
      .array(z.string())
      .describe("URLs canônicas das fontes desta resposta (lista de atribuição)"),
  });
}

/** Concise projection + attribution list for a block (used by `toMcpResult`). */
export function projetarProveniencia(p: Provenance): {
  provenance: ConciseBlock;
  attribution: string[];
} {
  return { provenance: renderConcise(p), attribution: attributionList([p]) };
}

/** Compact text footer for the Markdown channel (wording owned by the package). */
export function rodapeProveniencia(p: Provenance): string {
  return provenanceContext.footer(p);
}
