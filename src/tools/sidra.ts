import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import { isValidPeriod, isValidTerritorialLevel, formatValidationError } from "../validation.js";
import { territorialLevelHint, territorialLevelList, ALL_TERRITORIAL_LEVELS } from "../config.js";
import {
  type StructuredToolResult,
  sidraRecords,
  selectSidraColumns,
  formatarCelulaSidra,
} from "../structured.js";
import {
  extrairPeriodoSidra,
  NOTA_DERIVACAO_ESTATISTICAS,
  provenienciaIbge,
  type Provenance,
} from "../provenance.js";
import {
  agruparPorParam,
  estatisticasBlocoSchema,
  estatisticasParam,
  estatisticasSidra,
  topNParam,
  TOP_N_DEFAULT,
} from "../stats.js";

/** Data rows returned per page in the structured payload and Markdown table. */
const PAGE_SIZE = 100;

// Schema for the tool input
export const sidraSchema = z.object({
  tabela: z
    .string()
    .describe(
      "Código da tabela SIDRA (ex: 6579 para estimativas de população, 9514 para censo 2022)"
    ),
  variaveis: z
    .string()
    .optional()
    .default("allxp")
    .describe("IDs das variáveis separados por vírgula, ou 'allxp' para todas"),
  nivel_territorial: z
    .string()
    .optional()
    .default("1")
    .describe(territorialLevelHint(ALL_TERRITORIAL_LEVELS)),
  localidades: z
    .string()
    .optional()
    .default("all")
    .describe("Códigos das localidades separados por vírgula, ou 'all' para todas"),
  periodos: z
    .string()
    .optional()
    .default("last")
    .describe(
      "Períodos: 'last' para último, 'all' para todos, ou anos específicos (ex: 2020,2021,2022)"
    ),
  classificacoes: z
    .string()
    .optional()
    .describe("Classificações no formato 'id[categorias]' (ex: '2[6794]' para sexo masculino)"),
  formato: z
    .enum(["json", "tabela"])
    .optional()
    .default("tabela")
    .describe("Formato de saída: 'json' para dados brutos ou 'tabela' para formato legível"),
  pagina: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe(`Página de resultados (${PAGE_SIZE} registros por página)`),
  campos: z
    .string()
    .optional()
    .describe(
      "Selecionar apenas algumas colunas por rótulo, separadas por vírgula (ex: 'Valor,Ano'). Reduz o volume da resposta. Omitir traz todas."
    ),
  estatisticas: estatisticasParam,
  agruparPor: agruparPorParam,
  topN: topNParam,
});

export type SidraInput = z.infer<typeof sidraSchema>;

/**
 * Structured output payload (validated by the MCP SDK against the declared
 * outputSchema). Lets agents consume typed data instead of parsing Markdown.
 */
export const sidraOutputSchema = z.object({
  tabela: z.string().describe("Código da tabela SIDRA consultada"),
  nome: z.string().describe("Nome da tabela (quando conhecido)"),
  totalRegistros: z.number().describe("Total de registros de dados disponíveis (todas as páginas)"),
  colunas: z.array(z.string()).describe("Rótulos das colunas, na ordem"),
  registros: z
    .array(z.record(z.string(), z.string()))
    .describe("Registros da página atual: cada um mapeia rótulo da coluna -> valor"),
  paginacao: z
    .object({
      pagina: z.number(),
      porPagina: z.number(),
      totalPaginas: z.number(),
      temMais: z.boolean(),
    })
    .describe("Metadados de paginação para continuação"),
  estatisticas: estatisticasBlocoSchema.optional(),
});

// Common SIDRA tables reference
export const TABELAS_COMUNS: Record<string, string> = {
  "6579": "Estimativas de população",
  "9514": "População residente (Censo 2022)",
  "200": "População residente (Censos 1970-2010)",
  "4714": "População, área territorial e densidade (Censo 2022)",
  "4099": "PNAD Contínua - Taxa de desocupação (trimestral)",
  "5436": "PNAD Contínua - Rendimento médio real habitual (trimestral)",
  "1846": "Contas Nacionais Trimestrais - PIB a preços correntes",
  "5938": "Produto Interno Bruto per capita",
};

/**
 * Fetches data from IBGE SIDRA API
 */
export async function ibgeSidra(input: SidraInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_sidra", "sidra", async () => {
    try {
      // Validate territorial level
      if (input.nivel_territorial && !isValidTerritorialLevel(input.nivel_territorial)) {
        return {
          markdown: ValidationErrors.invalidTerritory(
            input.nivel_territorial,
            "ibge_sidra",
            territorialLevelList(ALL_TERRITORIAL_LEVELS)
          ),
          isError: true,
        };
      }

      // Validate period format
      if (input.periodos && !isValidPeriod(input.periodos)) {
        return {
          markdown: formatValidationError(
            "periodos",
            input.periodos,
            "'last', 'all', ano (YYYY), intervalo (YYYY-YYYY), ou múltiplos separados por vírgula"
          ),
          isError: true,
        };
      }

      // Build the SIDRA API URL
      // Format: /t/{tabela}/n{nivel}/{localidade}/v/{variaveis}/p/{periodos}/c{classificacao}/{categorias}
      let path = `/t/${input.tabela}`;
      path += `/n${input.nivel_territorial}/${input.localidades}`;
      path += `/v/${input.variaveis}`;
      path += `/p/${input.periodos}`;

      if (input.classificacoes) {
        // Parse classifications like "2[6794]" or "2[6794,6795]"
        const classMatch = input.classificacoes.match(/(\d+)\[([^\]]+)\]/);
        if (classMatch) {
          path += `/c${classMatch[1]}/${classMatch[2]}`;
        }
      }

      const url = `${IBGE_API.SIDRA}${path}`;

      // Use cache for SIDRA data (5 minutes TTL - data updates frequently)
      const key = cacheKey(url);
      let data: SidraRecord[];

      try {
        data = await cachedFetch<SidraRecord[]>(url, key, CACHE_TTL.SHORT);
      } catch (error) {
        if (error instanceof Error) {
          return {
            markdown: parseHttpError(
              error,
              "ibge_sidra",
              {
                tabela: input.tabela,
                nivel_territorial: input.nivel_territorial,
                localidades: input.localidades,
                periodos: input.periodos,
              },
              ["ibge_sidra_metadados", "ibge_sidra_tabelas"]
            ),
            isError: true,
          };
        }
        throw error;
      }

      const pesquisa = TABELAS_COMUNS[input.tabela]
        ? `SIDRA, Tabela ${input.tabela} (${TABELAS_COMUNS[input.tabela]})`
        : `SIDRA, Tabela ${input.tabela}`;
      const proveniencia = (opts?: {
        dataVintage?: string | null;
        derivado?: { nota: string };
      }): Provenance =>
        provenienciaIbge({
          fonte: "SIDRA",
          url,
          chaveCache: key,
          pesquisa,
          dataset: input.tabela,
          ...opts,
        });

      // No data is a valid (empty) result, not a failure: return an empty
      // structured payload plus guidance, without isError.
      //
      // ATENÇÃO ao que conta como vazio. O SIDRA responde a consulta sem dados
      // com o cabeçalho e MAIS NADA — `data` vem com UM elemento, não zero, e
      // a guarda antiga (`data.length === 0`) não pegava esse caso. Era por
      // isso que "população por UF em 2023" caía no caminho normal e devolvia
      // `totalRegistros: 0` sem explicar nada, e no modo estatísticas morria
      // acusando marcador de ausência que não existia.
      const semDados =
        !data || data.length === 0 ? { colunas: [], registros: [] } : sidraRecords(data);
      if (semDados.registros.length === 0) {
        const motivo = await porQueVazio(input.tabela, input.periodos ?? "last");
        return {
          markdown:
            motivo ??
            ValidationErrors.emptyResult(
              "ibge_sidra",
              "Verifique se a tabela e parâmetros estão corretos. Use ibge_sidra_metadados para consultar os níveis e períodos disponíveis."
            ),
          structured: emptyStructured(input.tabela, semDados.colunas),
          provenance: proveniencia(),
        };
      }

      const { colunas, registros } = sidraRecords(data);
      const dataVintage = extrairPeriodoSidra(colunas, registros);

      // Statistics mode (D2): full distribution over ALL data rows, before any
      // pagination or field selection — `pagina`/`campos`/`formato` are ignored.
      // The aggregates are a server-side derivation → derived block.
      if (input.estatisticas) {
        return buildSidraStatsResult(
          data,
          input,
          proveniencia({ dataVintage, derivado: { nota: NOTA_DERIVACAO_ESTATISTICAS } })
        );
      }

      return buildSidraResult(
        selectSidraColumns(data, input.campos),
        input.tabela,
        input.pagina ?? 1,
        input.formato ?? "tabela",
        proveniencia({ dataVintage })
      );
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: parseHttpError(error, "ibge_sidra", { tabela: input.tabela }, [
            "ibge_sidra_metadados",
          ]),
          isError: true,
        };
      }
      return { markdown: ValidationErrors.emptyResult("ibge_sidra"), isError: true };
    }
  });
}

interface SidraRecord {
  [key: string]: string;
}

/**
 * Por que a consulta voltou VAZIA — perguntado à fonte, não adivinhado.
 *
 * O SIDRA responde uma consulta sem dados do mesmo jeito que responde uma
 * tabela que não cobre aquele ano: cabeçalho e nada mais. Quem chamou fica sem
 * saber se errou a tabela, o nível territorial ou o período, e a resposta
 * "nenhum registro" some dentro de um relatório como se fosse fato do mundo.
 *
 * O caso medido em 11/09/2026: `tabela=6579, nivel_territorial=3,
 * periodos=2023` — população por UF em 2023, a pergunta mais natural que
 * existe — voltava vazia. A tabela 6579 simplesmente NÃO TEM 2023: a série de
 * estimativas pula 2007, 2010, 2022 e 2023, porque nesses anos o que houve foi
 * Censo ou Contagem. Isso está a uma chamada de distância, em
 * `/agregados/{tabela}/periodos`, e é o que esta função vai buscar.
 *
 * Só fala quando tem certeza: se algum dos períodos pedidos existe na tabela,
 * o vazio tem outra causa (nível territorial, localidade, variável) e a função
 * se cala em vez de chutar. Palavras do SIDRA (`last`, `all`, `last 4`) também
 * não são julgadas aqui.
 */
async function porQueVazio(tabela: string, periodosPedidos: string): Promise<string | undefined> {
  const anos = periodosPedidos
    .split(",")
    .map((p) => p.trim())
    .filter((p) => /^\d{4,6}$/.test(p));
  if (anos.length === 0) return undefined;

  let disponiveis: string[];
  try {
    const url = `${IBGE_API.AGREGADOS}/${tabela}/periodos`;
    const periodos = await cachedFetch<Array<{ id?: string }>>(
      url,
      cacheKey(url),
      CACHE_TTL.STATIC
    );
    disponiveis = (periodos ?? []).map((p) => String(p?.id ?? "")).filter(Boolean);
  } catch {
    // Diagnóstico é cortesia: se a fonte não responde, a resposta segue sem ele.
    return undefined;
  }
  if (disponiveis.length === 0) return undefined;

  const faltando = anos.filter((a) => !disponiveis.includes(a));
  if (faltando.length === 0 || faltando.length < anos.length) return undefined;

  const plural = faltando.length > 1;
  return (
    `A tabela ${tabela} não publica ${plural ? "os períodos" : "o período"} ` +
    `${faltando.join(", ")} — por isso a consulta veio vazia.\n\n` +
    `Períodos que ela tem: ${emFaixas(disponiveis)}.\n\n` +
    `Séries do IBGE costumam pular anos de Censo e de Contagem; ` +
    `use ibge_sidra_metadados (incluir_periodos) para ver a lista completa de outra tabela.`
  );
}

/** "2001, 2002, 2003, 2005" → "2001-2003, 2005" — lista longa cabe numa linha. */
function emFaixas(ids: string[]): string {
  const numeros = ids
    .map((i) => Number(i))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (numeros.length !== ids.length) return ids.join(", ");

  const faixas: string[] = [];
  let ini = numeros[0];
  let fim = numeros[0];
  for (const n of numeros.slice(1)) {
    if (n === fim + 1) {
      fim = n;
      continue;
    }
    faixas.push(ini === fim ? String(ini) : `${ini}-${fim}`);
    ini = fim = n;
  }
  faixas.push(ini === fim ? String(ini) : `${ini}-${fim}`);
  return faixas.join(", ");
}

/**
 * Structured payload for a table that returned no data rows.
 *
 * `colunas` entra quando o SIDRA mandou o cabeçalho: resposta sem LINHA ainda
 * diz quais colunas a tabela tem, e essa informação some se a gente devolver
 * uma lista vazia só porque não houve dado.
 */
function emptyStructured(tabela: string, colunas: string[] = []): Record<string, unknown> {
  return {
    tabela,
    nome: TABELAS_COMUNS[tabela] || `Tabela ${tabela}`,
    totalRegistros: 0,
    colunas,
    registros: [],
    paginacao: { pagina: 1, porPagina: PAGE_SIZE, totalPaginas: 0, temMais: false },
  };
}

/**
 * Builds both the structured payload and the Markdown text for a SIDRA result,
 * paginating the data rows (PAGE_SIZE per page). The first row of `data` is the
 * SIDRA header/label row; the rest are data rows.
 */
function buildSidraResult(
  data: SidraRecord[],
  tabela: string,
  pagina: number,
  formato: string,
  provenance: Provenance
): StructuredToolResult {
  const tabelaNome = TABELAS_COMUNS[tabela] || `Tabela ${tabela}`;
  const { colunas, registros: allRegistros, totalRegistros } = sidraRecords(data);

  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / PAGE_SIZE));
  const page = Math.min(Math.max(1, pagina), totalPaginas);
  const start = (page - 1) * PAGE_SIZE;
  const registros = allRegistros.slice(start, start + PAGE_SIZE);

  const paginacao = {
    pagina: page,
    porPagina: PAGE_SIZE,
    totalPaginas,
    temMais: page < totalPaginas,
  };

  const structured = { tabela, nome: tabelaNome, totalRegistros, colunas, registros, paginacao };

  if (formato === "json") {
    return { markdown: JSON.stringify(structured, null, 2), structured, provenance };
  }

  let output = `## SIDRA - ${tabelaNome}\n\n`;
  output += `Total de registros: ${totalRegistros}\n\n`;

  if (totalRegistros === 0) {
    return {
      markdown: output + "Nenhum dado encontrado para os filtros aplicados.",
      structured,
      provenance,
    };
  }

  const rows = registros.map((reg) => colunas.map((col) => formatarCelulaSidra(col, reg[col])));

  output += createMarkdownTable(colunas, rows, { showRowCount: true });

  if (paginacao.temMais) {
    output += `\n_Página ${page} de ${totalPaginas}. Use pagina=${page + 1} para a próxima página (ou formato='json' para os dados completos)._\n`;
  }

  return { markdown: output, structured, provenance };
}

/**
 * Builds the `estatisticas=true` response: the shared block from `stats.ts`
 * plus the tool's usual metadata. `registros` stays empty — the aggregates
 * replace the listing (use the default mode to page through raw records).
 */
function buildSidraStatsResult(
  data: SidraRecord[],
  input: SidraInput,
  provenance: Provenance
): StructuredToolResult {
  const tabelaNome = TABELAS_COMUNS[input.tabela] || `Tabela ${input.tabela}`;
  const dados = sidraRecords(data);
  const resultado = estatisticasSidra(dados, {
    agruparPor: input.agruparPor,
    topN: input.topN ?? TOP_N_DEFAULT,
  });

  if (!resultado.ok) {
    return { markdown: `## SIDRA - ${tabelaNome}\n\n${resultado.erro}`, isError: true };
  }

  const structured = {
    tabela: input.tabela,
    nome: tabelaNome,
    totalRegistros: dados.totalRegistros,
    colunas: dados.colunas,
    registros: [],
    paginacao: {
      pagina: 1,
      porPagina: PAGE_SIZE,
      totalPaginas: Math.max(1, Math.ceil(dados.totalRegistros / PAGE_SIZE)),
      temMais: false,
    },
    estatisticas: resultado.bloco,
  };

  const markdown =
    `## SIDRA - ${tabelaNome}\n\n` +
    `Total de registros: ${dados.totalRegistros}\n\n` +
    resultado.markdown;

  return { markdown, structured, provenance };
}

/**
 * Lists available SIDRA aggregates/tables for a given research
 */
export async function listSidraTables(pesquisaId?: string): Promise<string> {
  try {
    let url = `${IBGE_API.AGREGADOS}`;
    if (pesquisaId) {
      url += `?pesquisa=${pesquisaId}`;
    }

    // Use cache for aggregates list (24 hours TTL - static data)
    const key = cacheKey(url);
    const data = await cachedFetch<unknown[]>(url, key, CACHE_TTL.STATIC);

    return JSON.stringify(data, null, 2);
  } catch (error) {
    if (error instanceof Error) {
      return parseHttpError(error, "ibge_sidra", { pesquisaId }, [
        "ibge_sidra_tabelas",
        "ibge_sidra_metadados",
      ]);
    }
    return ValidationErrors.emptyResult("ibge_sidra");
  }
}
