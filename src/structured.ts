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

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { normalizeText } from "./config.js";

export interface StructuredToolResult {
  /** Always present: the Markdown text channel. */
  markdown: string;
  /** Typed payload, validated against the tool's outputSchema (success only). */
  structured?: Record<string, unknown>;
  /** When true, this is an error result; structured-output validation is skipped. */
  isError?: boolean;
}

/**
 * Converts a tool's `StructuredToolResult` into the MCP `CallToolResult`.
 * - Error → `{ content, isError: true }` (no structured payload required).
 * - Success → `{ content, structuredContent }` when a payload is present.
 */
export function toMcpResult(result: StructuredToolResult): CallToolResult {
  const content = [{ type: "text" as const, text: result.markdown }];

  if (result.isError) {
    return { content, isError: true };
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
