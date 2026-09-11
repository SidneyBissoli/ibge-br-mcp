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
    "Com estatisticas=true, agrupa pela coluna informada (rótulo, ex: 'Unidade da Federação', 'Ano') e ranqueia os grupos por soma decrescente (grupos[0] = maior total), cada grupo com sua mini-distribuição. Nome curto ('UF', 'estado', 'cidade', 'região') e rótulo parcial ('Federação') são resolvidos, e a resposta diz em `aviso` por qual coluna agrupou; rótulo que casa com duas colunas é recusado em vez de escolhido"
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
 * Rótulo que o chamador costuma inventar → o rótulo que o SIDRA de fato usa.
 *
 * Por que existe. Medido em 11/09/2026: `ibge_sidra` era a ferramenta com mais
 * erro do servidor (42% em 60 chamadas na janela do painel) e, desde que a
 * telemetria de forma ligou, TODO erro dela é `nao_encontrado` — e 11 dos 12
 * traziam `agruparPor`. A falha reproduz em uma linha: `agruparPor: "UF"` numa
 * consulta cuja coluna se chama "Unidade da Federação". O chamador não tem como
 * saber o rótulo antes de consultar, porque é a consulta que o revela, então
 * ele chuta o nome curto e leva um erro que só existe por vocabulário.
 *
 * O apelido só vale se o rótulo canônico ESTIVER nas colunas daquela consulta —
 * a tabela não inventa coluna, ela traduz um sinônimo para o que já veio. E a
 * resolução vai num aviso visível, nunca calada: resolver em silêncio seria o
 * errar plausível que este projeto proíbe.
 *
 * Deliberadamente fora: "período" e "data". Tabela trimestral tem "Trimestre" e
 * anual tem "Ano"; mapear "período" para "Ano" escolheria por conta própria em
 * qual eixo agrupar, que é responder outra pergunta.
 */
const APELIDOS_DE_COLUNA: Array<{ canonico: string; apelidos: string[] }> = [
  {
    canonico: "unidade da federacao",
    apelidos: ["uf", "ufs", "estado", "estados", "unidade federativa", "sigla da uf"],
  },
  { canonico: "municipio", apelidos: ["cidade", "cidades", "municipios"] },
  { canonico: "grande regiao", apelidos: ["regiao", "regioes", "macrorregiao"] },
  { canonico: "variavel", apelidos: ["variaveis", "indicador", "indicadores"] },
  { canonico: "sexo", apelidos: ["genero"] },
  { canonico: "ano", apelidos: ["anos"] },
  { canonico: "trimestre", apelidos: ["trimestres"] },
];

/**
 * Entre candidatas que só diferem pelo sufixo `(Código)`, o rótulo vence.
 *
 * Não é desempate arbitrário: o SIDRA publica todo eixo em par (`Unidade da
 * Federação` e `Unidade da Federação (Código)`), e quem pede para agrupar por
 * um eixo quer o nome legível — o código produz os MESMOS grupos com rótulo
 * pior. Sem isto, qualquer casamento parcial num eixo cairia em ambiguidade e
 * o chamador levaria uma recusa onde não há dúvida nenhuma.
 */
function preferirRotulo(candidatas: string[]): string[] {
  const semSufixo = new Set(
    candidatas.map((c) => normalizeText(c).replace(/\s*\(\s*codigo\s*\)$/, ""))
  );
  if (semSufixo.size !== 1) return candidatas;
  const rotulos = candidatas.filter((c) => !/\(\s*c[oó]digo\s*\)\s*$/i.test(c));
  return rotulos.length > 0 ? rotulos : candidatas;
}

/** "a, b e c" — quatro candidatas ligadas por " e " viram uma frase ilegível. */
function listarEmPortugues(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

type ResolucaoDeGrupo =
  | { tipo: "exata"; coluna: string }
  | { tipo: "traduzida"; coluna: string }
  | { tipo: "ambigua"; candidatas: string[] }
  | { tipo: "nenhuma" };

/**
 * Resolve o `agruparPor` pedido contra as colunas que a consulta trouxe.
 *
 * A ordem é do sinal mais forte para o mais fraco, e a AMBIGUIDADE recusa em
 * vez de escolher. O `find` que havia aqui antes pegava a primeira casada e
 * seguia: com `agruparPor: "Unidade"` ele agrupava por "Unidade de Medida"
 * quando o pedido era "Unidade da Federação", e devolvia um resultado com cara
 * de certo — defeito da mesma família do que esta função conserta, achado ao
 * consertá-la.
 */
function resolverColunaGrupo(colunas: string[], pedido: string): ResolucaoDeGrupo {
  const alvo = normalizeText(pedido);
  if (!alvo) return { tipo: "nenhuma" };

  const exata = colunas.find((c) => normalizeText(c) === alvo);
  if (exata) return { tipo: "exata", coluna: exata };

  const entrada = APELIDOS_DE_COLUNA.find((e) => e.apelidos.includes(alvo));
  if (entrada) {
    const porApelido = preferirRotulo(
      colunas.filter(
        (c) => normalizeText(c).replace(/\s*\(\s*codigo\s*\)$/, "") === entrada.canonico
      )
    );
    if (porApelido.length === 1) return { tipo: "traduzida", coluna: porApelido[0] };
    if (porApelido.length > 1) return { tipo: "ambigua", candidatas: porApelido };
  }

  // Contenção nas DUAS direções: "Federação" acha "Unidade da Federação", e
  // "Unidade da Federação do domicílio" acha "Unidade da Federação".
  const parciais = preferirRotulo(
    colunas.filter((c) => {
      const n = normalizeText(c);
      return n.includes(alvo) || alvo.includes(n);
    })
  );
  if (parciais.length === 1) return { tipo: "traduzida", coluna: parciais[0] };
  if (parciais.length > 1) return { tipo: "ambigua", candidatas: parciais };

  return { tipo: "nenhuma" };
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
    const resolucao = resolverColunaGrupo(colunas, agruparPor);
    if (resolucao.tipo === "ambigua") {
      return {
        ok: false,
        erro:
          `Coluna de agrupamento "${agruparPor}" é ambígua: casa com ` +
          `${listarEmPortugues(resolucao.candidatas.map((c) => `"${c}"`))}.\n\n` +
          `Repita com o rótulo inteiro da coluna desejada.`,
      };
    }
    if (resolucao.tipo === "nenhuma") {
      return {
        ok: false,
        erro:
          `Coluna de agrupamento "${agruparPor}" não encontrada no resultado.\n\n` +
          `Colunas disponíveis: ${colunas.join(", ")}.`,
      };
    }
    colunaGrupo = resolucao.coluna;
    // O chamador pediu um rótulo e recebeu outro: dizer qual, sempre. Sem este
    // aviso a resposta sai igualzinha à de quem acertou o nome, e ninguém tem
    // como conferir por qual eixo a estatística foi de fato agrupada.
    if (resolucao.tipo === "traduzida") {
      avisos.push(
        `A coluna de agrupamento "${agruparPor}" foi resolvida como "${resolucao.coluna}".`
      );
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
    // Duas causas diferentes, e a mensagem antiga dizia SEMPRE a segunda: a
    // consulta não trouxe registro nenhum, ou trouxe registros cujos valores
    // são todos marcador de ausência. Acusar marcador onde não havia registro
    // manda quem lê procurar o problema no lugar errado — foi o que aconteceu
    // com `tabela=6579, periodos=2023`, que a tabela não publica.
    return {
      ok: false,
      erro:
        registros.length === 0
          ? `A consulta não retornou nenhum registro, então não há o que resumir. ` +
            `Confira tabela, período e nível territorial em ibge_sidra_metadados.`
          : `Nenhum registro da consulta tem valor numérico na coluna "${colunaValor}" ` +
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
