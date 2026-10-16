/**
 * Structured output support (roadmap 1.2).
 *
 * MCP tools may expose a typed `structuredContent` payload alongside the
 * human/agent-readable Markdown text. When a tool declares an `outputSchema`,
 * the SDK validates `structuredContent` on every successful response and
 * skips validation when `isError` is set. Tools therefore return a
 * `StructuredToolResult` and the registration handler converts it via
 * `toMcpResult`.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { normalizeText } from "./config.js";
import { CLASSE_DO_ERRO, type ErrorClass } from "./call-shape.js";
import { formatNumber } from "./utils/index.js";
import {
  ATTRIBUTION_META_KEY,
  PROVENANCE_META_KEY,
  projetarProveniencia,
  rodapeProveniencia,
  type Provenance,
} from "./provenance.js";

export interface StructuredToolResult {
  /** Always present: the Markdown text channel. */
  markdown: string;
  /** Typed payload, validated against the tool's outputSchema (success only). */
  structured?: Record<string, unknown>;
  /**
   * Canonical provenance block (contract v1.0) — attached by every tool on
   * success; emitted by `toMcpResult` on the three channels of the contract.
   */
  provenance?: Provenance;
  /** When true, this is an error result; structured-output validation is skipped. */
  isError?: boolean;
  /**
   * Classe do erro decidida pelo TIPO da exceção (ver `CLASSE_DO_ERRO` em
   * call-shape.ts). Nunca vai ao fio: `toMcpResult` a copia como propriedade
   * não enumerável, que só o hook de telemetria lê.
   */
  [CLASSE_DO_ERRO]?: ErrorClass;
}

/**
 * Converts a tool's `StructuredToolResult` into the MCP `CallToolResult`.
 * - Error → `{ content, isError: true }` (no structured payload required).
 * - Success → `{ content, structuredContent }` when a payload is present.
 * - With `provenance`, the three channels of the contract v1.0 are emitted:
 *   the concise block + `attribution` inside `structuredContent` (parseable,
 *   visible to the model), a mirror under namespaced `_meta` keys (audit/UI,
 *   zero model tokens), and the compact text footer as a second content block.
 */
export function toMcpResult(result: StructuredToolResult): CallToolResult {
  const content = [{ type: "text" as const, text: result.markdown }];

  if (result.isError) {
    const erro: CallToolResult = { content, isError: true };
    const classe = result[CLASSE_DO_ERRO];
    if (classe !== undefined) {
      Object.defineProperty(erro, CLASSE_DO_ERRO, { value: classe, enumerable: false });
    }
    return erro;
  }

  if (result.provenance !== undefined) {
    const projetado = projetarProveniencia(result.provenance);
    return {
      content: [...content, { type: "text" as const, text: rodapeProveniencia(result.provenance) }],
      structuredContent: { ...(result.structured ?? {}), ...projetado },
      _meta: {
        [PROVENANCE_META_KEY]: projetado.provenance,
        [ATTRIBUTION_META_KEY]: projetado.attribution,
      },
    };
  }

  if (result.structured !== undefined) {
    return { content, structuredContent: result.structured };
  }

  return { content };
}

export interface SidraRecords {
  /** Column labels, in order (from the SIDRA header row). */
  colunas: string[];
  /** Data rows as label→value objects. */
  registros: Record<string, string>[];
  /** Total number of data rows. */
  totalRegistros: number;
}

/**
 * Converts a SIDRA-style response into labeled columns + records. The first
 * element of `data` is the header/label row; the rest are data rows keyed the
 * same way. Shared by every SIDRA-backed tool's structured output.
 */
export function sidraRecords(data: Record<string, string>[]): SidraRecords {
  if (!data || data.length === 0) {
    return { colunas: [], registros: [], totalRegistros: 0 };
  }

  const headerRow = data[0];
  const dataRows = data.slice(1);
  const columns = Object.keys(headerRow);
  const colunas = columns.map((col) => headerRow[col] || col);

  const registros = dataRows.map((row) => {
    const obj: Record<string, string> = {};
    columns.forEach((col, i) => {
      obj[colunas[i]] = row[col] ?? "";
    });
    return obj;
  });

  return { colunas, registros, totalRegistros: dataRows.length };
}

/** Unit of measure of one SIDRA variable, as the source publishes it. */
export interface UnidadeSidra {
  /** Variable code ("Variável (Código)"), or null when the response has no variable dimension. */
  variavel: string | null;
  /** Variable name ("Variável"), or null. */
  nomeVariavel: string | null;
  /** Unit text ("Unidade de Medida") verbatim, scale words included ("Mil pessoas"); null when blank. */
  unidade: string | null;
  /**
   * Always null for SIDRA: measured on 2026-10-15 over the metadata of the 63
   * tables the tools use (279 variables), the Agregados v3 API publishes no
   * separate multiplier — the scale lives inside the unit text ("Mil pessoas"
   * 13, "Mil Reais" 7, "Milhões de Reais" 3). Kept as a field so the reader
   * sees "the source does not say" instead of a missing key.
   */
  multiplicador: number | null;
}

/** Shared outputSchema fragment for `unidades` (every SIDRA-backed tool). */
export const unidadesSidraSchema = z
  .array(
    z.object({
      variavel: z
        .string()
        .nullable()
        .describe("Código da variável SIDRA (null se a resposta não tem a dimensão Variável)"),
      nomeVariavel: z.string().nullable().describe("Nome da variável"),
      unidade: z
        .string()
        .nullable()
        .describe(
          "Unidade de medida como a fonte publica, com a escala no texto (ex.: 'Mil pessoas', 'Milhões de Reais'); null se a fonte não diz"
        ),
      multiplicador: z
        .number()
        .nullable()
        .describe(
          "Multiplicador de escala publicado à parte; o SIDRA não publica — sempre null, a escala está no texto da unidade"
        ),
    })
  )
  .describe(
    "Unidade de medida de cada variável da resposta, FORA de `registros`: não some com `campos` nem com a paginação. Leia antes de citar um valor — 'Mil pessoas' significa que 1.234 são 1,234 milhão de pessoas"
  );

const ROTULO_UNIDADE = "unidade de medida";
const ROTULO_VARIAVEL = "variavel";

/**
 * Distinct (variable, unit) pairs of a raw SIDRA response, read BEFORE
 * `selectSidraColumns` and pagination — the unit is metadata of the answer,
 * not a column the caller may filter away (roadmap Fase 4, 2026-10-15).
 * Pairs come in order of first appearance; a variable whose unit changes over
 * the period (old currencies) yields one pair per unit.
 */
export function sidraUnidades(data: Record<string, string>[]): UnidadeSidra[] {
  if (!data || data.length < 2) return [];
  const header = data[0];
  const chave = (alvo: string, codigo: boolean): string | undefined =>
    Object.keys(header).find((k) => {
      const rotulo = normalizeText(header[k] || "");
      const ehCodigo = /\(codigo\)\s*$/.test(rotulo);
      return ehCodigo === codigo && rotulo.replace(/\s*\(codigo\)\s*$/, "") === alvo;
    });
  const kUnidade = chave(ROTULO_UNIDADE, false);
  const kVarCodigo = chave(ROTULO_VARIAVEL, true);
  const kVarNome = chave(ROTULO_VARIAVEL, false);
  if (!kUnidade && !kVarCodigo && !kVarNome) return [];

  const vazioNulo = (v: string | undefined): string | null => (v && v.trim() ? v : null);
  const vistos = new Set<string>();
  const unidades: UnidadeSidra[] = [];
  for (const row of data.slice(1)) {
    const item: UnidadeSidra = {
      variavel: kVarCodigo ? vazioNulo(row[kVarCodigo]) : null,
      nomeVariavel: kVarNome ? vazioNulo(row[kVarNome]) : null,
      unidade: kUnidade ? vazioNulo(row[kUnidade]) : null,
      multiplicador: null,
    };
    const id = `${item.variavel}\u0000${item.nomeVariavel}\u0000${item.unidade}`;
    if (vistos.has(id)) continue;
    vistos.add(id);
    unidades.push(item);
  }
  return unidades;
}

/**
 * One Markdown line restoring the unit when `campos` removed the "Unidade de
 * Medida" column from the table — the text channel must not lose it either.
 * Empty when the column is still there or no unit is known.
 */
export function notaUnidadesRemovidas(unidades: UnidadeSidra[], colunasExibidas: string[]): string {
  if (colunasExibidas.some((c) => normalizeText(c) === ROTULO_UNIDADE)) return "";
  const textos = [
    ...new Set(unidades.map((u) => u.unidade).filter((u): u is string => u !== null)),
  ];
  if (textos.length === 0) return "";
  return `_Unidade de medida: ${textos.join("; ")}._\n\n`;
}

/**
 * Field selection for SIDRA-style data (roadmap 1.2): keeps only the columns
 * whose header label matches one of the comma-separated `campos` tokens
 * (accent/case-insensitive substring match). Filters the header and every data
 * row, so both the structured payload and the Markdown table shrink together.
 *
 * Returns the data unchanged when `campos` is empty or matches no column (so a
 * mistaken filter never blanks out the result).
 */
export function selectSidraColumns(
  data: Record<string, string>[],
  campos?: string
): Record<string, string>[] {
  if (!campos || !campos.trim() || !data || data.length === 0) {
    return data;
  }

  const wanted = campos
    .split(",")
    .map((c) => normalizeText(c))
    .filter(Boolean);
  if (wanted.length === 0) {
    return data;
  }

  const header = data[0];
  const keepKeys = Object.keys(header).filter((key) => {
    const label = normalizeText(header[key] || key);
    return wanted.some((w) => label.includes(w) || w.includes(label));
  });

  if (keepKeys.length === 0) {
    return data;
  }

  return data.map((row) => {
    const filtered: Record<string, string> = {};
    for (const key of keepKeys) {
      filtered[key] = row[key];
    }
    return filtered;
  });
}

/**
 * Columns whose values are identifiers, not quantities: SIDRA's "(Código)"
 * twins and the period columns (Ano, Mês, Trimestre, Semestre, Período — the
 * same family `extrairPeriodoSidra` reads). Formatting these as numbers is
 * what turned "2026" into "2.026" and "3106200" into "3.106.200" in the
 * Markdown of four tools (found on 2026-09-02 through the Deep Research
 * document of a municipality).
 */
export function colunaIdentificadora(coluna: string): boolean {
  return (
    /\(c[oó]digo\)\s*$/i.test(coluna) ||
    /^(ano|trimestre|m[eê]s|semestre|per[ií]odo)\b/i.test(coluna)
  );
}

/**
 * One SIDRA cell for the Markdown table: quantities get the pt-BR thousands
 * separator (values of 4+ characters, as before), identifiers and periods
 * stay verbatim, empty stays "-". Shared by every SIDRA-backed table renderer
 * — the rule lives here so the four tools cannot drift again.
 */
export function formatarCelulaSidra(coluna: string, valor: string | undefined): string {
  if (!valor) return "-";
  if (colunaIdentificadora(coluna)) return valor;
  if (!isNaN(Number(valor)) && valor.length > 3) return formatNumber(Number(valor));
  return valor;
}
