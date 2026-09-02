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
import { normalizeText } from "./config.js";
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
    return { content, isError: true };
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
  return /\(c[oó]digo\)\s*$/i.test(coluna) || /^(ano|trimestre|m[eê]s|semestre|per[ií]odo)\b/i.test(coluna);
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
