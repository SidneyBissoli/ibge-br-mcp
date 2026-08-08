/**
 * Provenance block (portfolio contract v1.0) — pt-BR adapter over
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
 *    original fetch instant — it is the legally relevant extraction date).
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
  createProvenanceContext,
  renderConcise,
  type CanonicalProvenance,
  type ConciseBlock,
} from "@sbissoli/mcp-provenance";
import { lastFetchMeta } from "./cache.js";
import { API_ENDPOINTS } from "./config.js";

/** Single provenance context for the server: `_meta` namespace, locale, timezone, mode. */
export const provenanceContext = createProvenanceContext({
  metaNamespace: "br.com.sidneybissoli.ibge",
  locale: "pt-BR",
  timezone: { offset: "-03:00", label: "horário de Brasília" },
  defaultMode: "concise",
});

/** Canonical envelope v1.0 (post-validation). */
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
 * Source registry — one entry per IBGE API this server consumes. `name` is
 * what the concise projection shows as `source`; `endpoint` is the base URL
 * actually queried. Text only, never the IBGE logo/brand (docs/01).
 */
export const FONTES_IBGE = {
  LOCALIDADES: {
    name: "IBGE — API de Localidades",
    endpoint: API_ENDPOINTS.IBGE.LOCALIDADES,
  },
  SIDRA: {
    name: "IBGE — SIDRA (Banco de Tabelas Estatísticas)",
    endpoint: API_ENDPOINTS.SIDRA,
  },
  AGREGADOS: {
    name: "IBGE — API de Agregados (SIDRA)",
    endpoint: API_ENDPOINTS.IBGE.AGREGADOS,
  },
  NOMES: {
    name: "IBGE — API de Nomes (Censo Demográfico 2010)",
    endpoint: API_ENDPOINTS.IBGE.NOMES,
  },
  MALHAS: {
    name: "IBGE — API de Malhas Geográficas",
    endpoint: API_ENDPOINTS.IBGE.MALHAS,
  },
  NOTICIAS: {
    name: "IBGE — API de Notícias",
    endpoint: API_ENDPOINTS.IBGE.NOTICIAS,
  },
  POPULACAO: {
    name: "IBGE — API de Projeções de População",
    endpoint: API_ENDPOINTS.IBGE.POPULACAO,
  },
  CNAE: {
    name: "IBGE — API CNAE",
    endpoint: API_ENDPOINTS.IBGE.CNAE,
  },
  CALENDARIO: {
    name: "IBGE — API de Calendário de Divulgações",
    endpoint: API_ENDPOINTS.IBGE.CALENDARIO,
  },
  PAISES: {
    name: "IBGE — API de Países",
    endpoint: API_ENDPOINTS.IBGE.PAISES,
  },
  PESQUISAS: {
    name: "IBGE — API de Pesquisas (Cidades@)",
    endpoint: API_ENDPOINTS.IBGE.PESQUISAS,
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
}

/**
 * Builds the canonical provenance block for one tool response. Citation
 * follows the pattern fixed by the verbatim verification (docs/01):
 * "Fonte: IBGE — [pesquisa/tabela], [URL], extraído em [data]."
 */
export function provenienciaIbge(opts: ProvenienciaIbgeOptions): Provenance {
  const fonte = FONTES_IBGE[opts.fonte];
  const meta = opts.chaveCache ? lastFetchMeta(opts.chaveCache) : null;
  const retrievedAt = meta?.retrievedAt ?? new Date();

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
    served_from_cache: meta ? meta.servedFromCache : null,
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
 */
export function extrairPeriodoSidra(
  colunas: string[],
  registros: Array<Record<string, string>>
): string | null {
  const candidatas = colunas.filter((c) =>
    /^(ano|trimestre|m[eê]s|semestre|per[ií]odo)\b/i.test(c)
  );
  // SIDRA exposes "(Código)"/plain column pairs — prefer the readable label.
  const idx = candidatas.find((c) => !/\(c[oó]digo\)/i.test(c)) ?? candidatas[0];
  if (!idx) return null;
  const valores = [
    ...new Set(registros.map((r) => r[idx]).filter((v): v is string => Boolean(v))),
  ].sort();
  if (valores.length === 0) return null;
  return valores.length === 1 ? valores[0] : `${valores[0]}–${valores[valores.length - 1]}`;
}

/** Concise projection of a block (the shape embedded in `structuredContent`/`_meta`). */
export const provenanceBlockSchema = z.object({
  source: z.string().describe("Fonte oficial do dado (API do IBGE consultada)"),
  source_url: z.string().describe("URL canônica que reproduz a consulta"),
  data_vintage: z
    .string()
    .nullable()
    .describe("Período de referência do dado segundo a fonte; null se a fonte não expõe"),
  retrieved_at: z
    .string()
    .describe("Instante real da extração no upstream (ISO-8601, horário de Brasília)"),
  citation: z.string().describe("Citação pronta para uso"),
  license: z.string().nullable().describe("Regime legal do dado"),
});

/**
 * Extends a tool's output schema with the provenance channel of the contract
 * v1.0: the concise block + the `attribution` URL list (MCP RFC #711). Every
 * successful response carries both (wired in `toMcpResult`).
 */
export function comProveniencia<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return schema.extend({
    provenance: provenanceBlockSchema.describe(
      "Bloco de proveniência (contrato v1.0): fonte, URL, período, extração e licença"
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

/** Compact text footer for the Markdown channel (fixed wording, contract v1.0). */
export function rodapeProveniencia(p: Provenance): string {
  return provenanceContext.footer(p);
}
