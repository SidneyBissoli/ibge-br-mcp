import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, formatNumber } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import { isValidPeriod, isValidTerritorialLevel, formatValidationError } from "../validation.js";
import { territorialLevelHint, territorialLevelList, ALL_TERRITORIAL_LEVELS } from "../config.js";
import { type StructuredToolResult, sidraRecords, selectSidraColumns } from "../structured.js";

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
    .array(z.record(z.string()))
    .describe("Registros da página atual: cada um mapeia rótulo da coluna -> valor"),
  paginacao: z
    .object({
      pagina: z.number(),
      porPagina: z.number(),
      totalPaginas: z.number(),
      temMais: z.boolean(),
    })
    .describe("Metadados de paginação para continuação"),
});

// Common SIDRA tables reference
const TABELAS_COMUNS: Record<string, string> = {
  "6579": "Estimativas de população",
  "9514": "População residente (Censo 2022)",
  "200": "População residente (Censos 1970-2010)",
  "1705": "Área territorial",
  "1712": "Densidade demográfica",
  "4714": "PNAD Contínua - Taxa de desocupação",
  "6381": "PNAD Contínua - Rendimento médio",
  "6706": "PIB a preços correntes",
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

      // No data is a valid (empty) result, not a failure: return an empty
      // structured payload plus guidance, without isError.
      if (!data || data.length === 0) {
        return {
          markdown: ValidationErrors.emptyResult(
            "ibge_sidra",
            "Verifique se a tabela e parâmetros estão corretos. Use ibge_sidra_metadados para consultar os níveis e períodos disponíveis."
          ),
          structured: emptyStructured(input.tabela),
        };
      }

      return buildSidraResult(
        selectSidraColumns(data, input.campos),
        input.tabela,
        input.pagina ?? 1,
        input.formato ?? "tabela"
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

/** Structured payload for a table that returned no data rows. */
function emptyStructured(tabela: string): Record<string, unknown> {
  return {
    tabela,
    nome: TABELAS_COMUNS[tabela] || `Tabela ${tabela}`,
    totalRegistros: 0,
    colunas: [],
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
  formato: string
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
    return { markdown: JSON.stringify(structured, null, 2), structured };
  }

  let output = `## SIDRA - ${tabelaNome}\n\n`;
  output += `Total de registros: ${totalRegistros}\n\n`;

  if (totalRegistros === 0) {
    return { markdown: output + "Nenhum dado encontrado para os filtros aplicados.", structured };
  }

  const rows = registros.map((reg) =>
    colunas.map((col) => {
      const value = reg[col];
      if (value && !isNaN(Number(value)) && value.length > 3) {
        return formatNumber(Number(value));
      }
      return value || "-";
    })
  );

  output += createMarkdownTable(colunas, rows, { showRowCount: true });

  if (paginacao.temMais) {
    output += `\n_Página ${page} de ${totalPaginas}. Use pagina=${page + 1} para a próxima página (ou formato='json' para os dados completos)._\n`;
  }

  return { markdown: output, structured };
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
