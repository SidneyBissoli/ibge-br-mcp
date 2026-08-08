/**
 * Statistics modes (D2) for the SIDRA-backed tabular tools, served by
 * `@sbissoli/mcp-stats` (portfolio Fase 0 — do not reimplement the math here).
 *
 * The problem this solves: SIDRA answers are fetched whole into the server and
 * then paginated/truncated for the client, so the model only ever sees a slice
 * and can never answer "which municipality has the largest X?" without paging
 * through thousands of records. `estatisticas=true` computes the full
 * distribution server-side, before any truncation, and returns a compact
 * pt-BR block (distribution + labeled percentiles + top/bottom ranking, or
 * per-group mini-distributions with `agruparPor`).
 *
 * SIDRA specifics handled here (design fixed in the ibge phase, 08/08/2026):
 *  - the value column is the one labeled "Valor" in the header row;
 *  - SIDRA absence markers ("-", "..", "...", "X") and non-numeric values are
 *    excluded from n (reported via `registrosSemValor`);
 *  - values use "." as decimal separator (never thousands) — plain Number();
 *  - a query mixing several variables (variaveis="allxp") auto-groups by the
 *    "Variável" column, since one distribution across different units would be
 *    meaningless. An `aviso` explains it.
 */

import { z } from "zod";
import {
  computeGroupedStats,
  computeStats,
  formatBRL,
  formatEntries,
  formatGrouped,
  formatStats,
} from "@sbissoli/mcp-stats";
import { normalizeText } from "./config.js";
import { createMarkdownTable } from "./utils/index.js";
import type { SidraRecords } from "./structured.js";

/** Ranking size cap for `topN` (mirrors the senado precedent). */
export const TOP_N_MAX = 100;
export const TOP_N_DEFAULT = 10;

// ---------------------------------------------------------------------------
// Input params (shared by the 4 tabular tools so the wording stays identical)
// ---------------------------------------------------------------------------

export const estatisticasParam = z
  .boolean()
  .optional()
  .default(false)
  .describe(
    "Computa estatísticas (mínimo/máximo/média/mediana/desvio-padrão/percentis) sobre TODOS os registros da consulta, antes da paginação, + ranking top/bottom. Use para 'qual o maior/menor', 'média', 'mediana', 'distribuição', 'ranking'. Quando true, ignora pagina, campos e formato"
  );

export const agruparPorParam = z
  .string()
  .optional()
  .describe(
    "Com estatisticas=true, agrupa pela coluna informada (rótulo, ex: 'Unidade da Federação', 'Ano') e ranqueia os grupos por soma decrescente (grupos[0] = maior total), cada grupo com sua mini-distribuição"
  );

export const topNParam = z
  .number()
  .int()
  .min(1)
  .max(TOP_N_MAX)
  .optional()
  .default(TOP_N_DEFAULT)
  .describe(
    `Tamanho das listas top/bottom quando estatisticas=true sem agruparPor (padrão: ${TOP_N_DEFAULT}, máx: ${TOP_N_MAX})`
  );

// ---------------------------------------------------------------------------
// Output schema (the `estatisticas` block, shared by the 4 outputSchemas)
// ---------------------------------------------------------------------------

const percentilRotuladoSchema = z.object({
  percentil: z.number().describe("Percentil (50 = mediana)"),
  valor: z.number(),
  rotulo: z.string().describe("Enunciado por extenso, pronto para citar ao leitor"),
});

const distribuicaoSchema = z.object({
  n: z.number().describe("Registros com valor numérico considerados"),
  soma: z.number(),
  minimo: z.number(),
  maximo: z.number(),
  media: z.number(),
  mediana: z.number(),
  desvioPadrao: z.number(),
  percentis: z.array(percentilRotuladoSchema),
});

export const estatisticasBlocoSchema = z
  .object({
    colunaValor: z
      .string()
      .describe("Rótulo da coluna numérica analisada (sempre 'Valor' no SIDRA)"),
    registrosConsiderados: z.number().describe("Registros com valor numérico (contam no n)"),
    registrosSemValor: z
      .number()
      .describe(
        "Registros excluídos por marcador de ausência SIDRA ('-', '..', '...', 'X') ou valor não numérico"
      ),
    aviso: z
      .string()
      .optional()
      .describe("Avisos sobre agrupamento automático, mistura de unidades ou truncamento"),
    distribuicao: distribuicaoSchema
      .optional()
      .describe("Distribuição do conjunto inteiro (sem agruparPor)"),
    top: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe("Maiores valores, com as colunas de identificação do registro (sem agruparPor)"),
    bottom: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe("Menores valores (sem agruparPor)"),
    agrupadoPor: z.string().optional().describe("Rótulo da coluna de agrupamento (com agruparPor)"),
    totalGrupos: z
      .number()
      .optional()
      .describe("Total de grupos existentes antes do teto (com agruparPor)"),
    grupos: z
      .array(distribuicaoSchema.extend({ grupo: z.string() }))
      .optional()
      .describe(
        "Grupos ordenados por soma decrescente, cada um com sua mini-distribuição (com agruparPor)"
      ),
  })
  .describe("Bloco estatístico presente quando estatisticas=true (registros vem vazio nesse modo)");

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/** SIDRA absence markers — records carrying them stay out of the distribution. */
const MARCADORES_SIDRA = new Set(["-", "..", "...", "X"]);

/**
 * Parses a SIDRA value string ("." is the decimal separator; no thousands
 * separator is ever emitted). Returns null for absence markers and anything
 * non-numeric, so the record is excluded from n.
 */
export function valorSidra(bruto: string | undefined): number | null {
  if (bruto === undefined) return null;
  const s = bruto.trim();
  if (s === "" || MARCADORES_SIDRA.has(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** pt-BR display formatter for SIDRA values (counts and rates — not currency). */
function formatarValor(n: number): string {
  const s = formatBRL(n).replace("R$ ", "");
  return s.endsWith(",00") ? s.slice(0, -3) : s;
}

const DISPLAY = { formatValue: formatarValor };

export interface EstatisticasOpcoes {
  agruparPor?: string;
  topN: number;
}

export type EstatisticasResultado =
  { ok: true; bloco: Record<string, unknown>; markdown: string } | { ok: false; erro: string };

/** Finds a column by accent/case-insensitive label match (exact, then substring). */
function acharColuna(colunas: string[], rotulo: string): string | undefined {
  const alvo = normalizeText(rotulo);
  return (
    colunas.find((c) => normalizeText(c) === alvo) ??
    colunas.find((c) => normalizeText(c).includes(alvo))
  );
}

/**
 * Computes the `estatisticas` block + its pt-BR Markdown for a labeled SIDRA
 * result (all data rows — callers must pass the full set, never a page).
 */
export function estatisticasSidra(
  dados: SidraRecords,
  opcoes: EstatisticasOpcoes
): EstatisticasResultado {
  const { colunas, registros } = dados;

  const colunaValor = acharColuna(colunas, "Valor");
  if (!colunaValor) {
    return {
      ok: false,
      erro:
        `A consulta não retornou uma coluna "Valor" para computar estatísticas.\n\n` +
        `Colunas disponíveis: ${colunas.join(", ") || "(nenhuma)"}.`,
    };
  }

  const avisos: string[] = [];

  // A query spanning several variables mixes units — auto-group by "Variável".
  let agruparPor = opcoes.agruparPor;
  const colunaVariavel = acharColuna(colunas, "Variável");
  if (colunaVariavel) {
    const variaveis = new Set(registros.map((r) => r[colunaVariavel]));
    if (variaveis.size > 1) {
      if (!agruparPor) {
        agruparPor = colunaVariavel;
        avisos.push(
          `A consulta retorna ${variaveis.size} variáveis; as estatísticas foram agrupadas automaticamente por "${colunaVariavel}". Para uma distribuição única, restrinja a consulta a uma variável.`
        );
      } else if (normalizeText(agruparPor) !== normalizeText(colunaVariavel)) {
        avisos.push(
          `A consulta mistura ${variaveis.size} variáveis (unidades possivelmente diferentes) num mesmo cálculo. Considere restringir a consulta a uma variável.`
        );
      }
    }
  }

  let colunaGrupo: string | undefined;
  if (agruparPor) {
    colunaGrupo = acharColuna(colunas, agruparPor);
    if (!colunaGrupo) {
      return {
        ok: false,
        erro:
          `Coluna de agrupamento "${agruparPor}" não encontrada no resultado.\n\n` +
          `Colunas disponíveis: ${colunas.join(", ")}.`,
      };
    }
  }

  // Pair each record with its parsed value; absence markers drop out of n.
  const numericos: Array<{ registro: Record<string, string>; valor: number }> = [];
  for (const registro of registros) {
    const v = valorSidra(registro[colunaValor]);
    if (v !== null) numericos.push({ registro, valor: v });
  }
  const registrosSemValor = registros.length - numericos.length;

  if (numericos.length === 0) {
    return {
      ok: false,
      erro:
        `Nenhum registro da consulta tem valor numérico na coluna "${colunaValor}" ` +
        `(${registros.length} registros, todos com marcador de ausência do SIDRA ou vazios).`,
    };
  }

  const base = {
    colunaValor,
    registrosConsiderados: numericos.length,
    registrosSemValor,
  };

  if (colunaGrupo) {
    const grupoCol = colunaGrupo;
    const agrupado = computeGroupedStats(
      numericos,
      (p) => p.valor,
      (p) => p.registro[grupoCol] ?? "(sem grupo)"
    );
    const formatado = formatGrouped(agrupado, DISPLAY);
    // formatGrouped may carry its own truncation aviso — merge with ours.
    const avisoTruncamento = formatado.aviso as string | undefined;
    if (avisoTruncamento) avisos.push(avisoTruncamento);
    delete formatado.aviso;

    const bloco: Record<string, unknown> = {
      ...base,
      agrupadoPor: colunaGrupo,
      ...(avisos.length > 0 ? { aviso: avisos.join(" ") } : {}),
      ...formatado,
    };
    return { ok: true, bloco, markdown: markdownAgrupado(bloco, colunaGrupo) };
  }

  // Identity of top/bottom entries: the columns that VARY across the records.
  // Constant columns (territorial level, unit, single period/variable) are
  // context the header already gives — repeating them per entry is noise.
  const candidatas = colunas.filter((c) => c !== colunaValor);
  const variam = candidatas.filter((c) => {
    const primeira = numericos[0].registro[c];
    return numericos.some((p) => p.registro[c] !== primeira);
  });
  const colunasIdentidade = variam.length > 0 ? variam : candidatas;

  const e = computeStats(numericos, (p) => p.valor, {
    topN: opcoes.topN,
    identify: (p) => identidade(p.registro, colunasIdentidade),
  });

  const bloco: Record<string, unknown> = {
    ...base,
    ...(avisos.length > 0 ? { aviso: avisos.join(" ") } : {}),
    distribuicao: formatStats(e, DISPLAY),
    top: formatEntries(e.top, DISPLAY),
    bottom: formatEntries(e.bottom, DISPLAY),
  };
  return { ok: true, bloco, markdown: markdownDistribuicao(bloco) };
}

/** Projects a record onto the chosen identity columns. */
function identidade(registro: Record<string, string>, colunas: string[]): Record<string, unknown> {
  const id: Record<string, unknown> = {};
  for (const c of colunas) id[c] = registro[c];
  return id;
}

// ---------------------------------------------------------------------------
// pt-BR Markdown rendering (compact — full detail lives in structuredContent)
// ---------------------------------------------------------------------------

function linhaResumo(bloco: Record<string, unknown>): string {
  const semValor = bloco.registrosSemValor as number;
  let linha = `${bloco.registrosConsiderados} registros com valor numérico`;
  if (semValor > 0) linha += ` (${semValor} sem valor, excluídos)`;
  return linha + ".\n\n";
}

function markdownDistribuicao(bloco: Record<string, unknown>): string {
  const d = bloco.distribuicao as Record<string, unknown>;
  let out = `### Estatísticas (coluna "${bloco.colunaValor}")\n\n`;
  if (bloco.aviso) out += `> ${bloco.aviso}\n\n`;
  out += linhaResumo(bloco);

  out += createMarkdownTable(
    ["Medida", "Valor"],
    [
      ["n", String(d.n)],
      ["Soma", formatarValor(d.soma as number)],
      ["Mínimo", formatarValor(d.minimo as number)],
      ["Máximo", formatarValor(d.maximo as number)],
      ["Média", formatarValor(d.media as number)],
      ["Mediana", formatarValor(d.mediana as number)],
      ["Desvio-padrão", formatarValor(d.desvioPadrao as number)],
    ],
    { alignment: ["left", "right"] }
  );

  const percentis = d.percentis as Array<Record<string, unknown>>;
  out += "\n**Percentis**\n\n";
  for (const p of percentis) {
    out += `- ${p.rotulo}\n`;
  }

  out += rankingMarkdown("Top (maiores valores)", bloco.top as Array<Record<string, unknown>>);
  out += rankingMarkdown(
    "Bottom (menores valores)",
    bloco.bottom as Array<Record<string, unknown>>
  );
  return out;
}

function rankingMarkdown(titulo: string, entradas: Array<Record<string, unknown>>): string {
  if (!entradas || entradas.length === 0) return "";
  const colunas = Object.keys(entradas[0]);
  const rows = entradas.map((e) =>
    colunas.map((c) => (c === "valor" ? formatarValor(e[c] as number) : String(e[c] ?? "-")))
  );
  return `\n### ${titulo}\n\n` + createMarkdownTable(colunas, rows, { showRowCount: false });
}

function markdownAgrupado(bloco: Record<string, unknown>, colunaGrupo: string): string {
  const grupos = bloco.grupos as Array<Record<string, unknown>>;
  let out = `### Estatísticas por "${colunaGrupo}" (coluna "${bloco.colunaValor}")\n\n`;
  if (bloco.aviso) out += `> ${bloco.aviso}\n\n`;
  out += linhaResumo(bloco);
  out += `${bloco.totalGrupos} grupos, ordenados por soma decrescente.\n\n`;

  const rows = grupos.map((g) => [
    String(g.grupo),
    String(g.n),
    formatarValor(g.soma as number),
    formatarValor(g.minimo as number),
    formatarValor(g.maximo as number),
    formatarValor(g.media as number),
    formatarValor(g.mediana as number),
  ]);
  out += createMarkdownTable(["Grupo", "n", "Soma", "Mínimo", "Máximo", "Média", "Mediana"], rows, {
    alignment: ["left", "right", "right", "right", "right", "right", "right"],
  });
  out += "\n_Percentis e desvio-padrão de cada grupo estão no payload estruturado._\n";
  return out;
}
