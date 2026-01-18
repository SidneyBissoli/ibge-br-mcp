import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, formatNumber } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import { isValidPeriod, isValidTerritorialLevel, formatValidationError } from "../validation.js";

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
  nivel_territorial: z.string().optional().default("1")
    .describe(`Nível territorial (código N sem o prefixo):
1=Brasil, 2=Grande Região, 3=UF, 6=Município, 7=Região Metropolitana,
8=Mesorregião, 9=Microrregião, 10=Distrito, 11=Subdistrito,
13=RM e RIDE, 14=Região Integrada de Desenvolvimento, 15=Aglomeração Urbana,
17=Região Geográfica Imediata, 18=Região Geográfica Intermediária,
105=Macrorregião de Saúde, 106=Região de Saúde,
114=Aglomerado Subnormal, 127=Amazônia Legal, 128=Semiárido`),
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
});

export type SidraInput = z.infer<typeof sidraSchema>;

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
export async function ibgeSidra(input: SidraInput): Promise<string> {
  return withMetrics("ibge_sidra", "sidra", async () => {
    try {
      // Validate territorial level
      if (input.nivel_territorial && !isValidTerritorialLevel(input.nivel_territorial)) {
        return formatValidationError(
          "nivel_territorial",
          input.nivel_territorial,
          "1 (Brasil), 2 (Região), 3 (UF), 6 (Município), etc. Use ibge_sidra_metadados para ver níveis disponíveis."
        );
      }

      // Validate period format
      if (input.periodos && !isValidPeriod(input.periodos)) {
        return formatValidationError(
          "periodos",
          input.periodos,
          "'last', 'all', ano (YYYY), intervalo (YYYY-YYYY), ou múltiplos separados por vírgula"
        );
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
          return parseHttpError(
            error,
            "ibge_sidra",
            {
              tabela: input.tabela,
              nivel_territorial: input.nivel_territorial,
              localidades: input.localidades,
              periodos: input.periodos,
            },
            ["ibge_sidra_metadados", "ibge_sidra_tabelas"]
          );
        }
        throw error;
      }

      if (!data || data.length === 0) {
        return ValidationErrors.emptyResult(
          "ibge_sidra",
          "Verifique se a tabela e parâmetros estão corretos. Use ibge_sidra_metadados para consultar os níveis e períodos disponíveis."
        );
      }

      // Return based on format
      if (input.formato === "json") {
        return JSON.stringify(data, null, 2);
      }

      return formatSidraResponse(data, input.tabela);
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(
          error,
          "ibge_sidra",
          {
            tabela: input.tabela,
          },
          ["ibge_sidra_metadados"]
        );
      }
      return ValidationErrors.emptyResult("ibge_sidra");
    }
  });
}

interface SidraRecord {
  [key: string]: string;
}

function formatSidraResponse(data: SidraRecord[], tabela: string): string {
  if (data.length === 0) {
    return "Nenhum dado encontrado.";
  }

  // First row contains headers
  const headerRow = data[0];
  const dataRows = data.slice(1);

  const tabelaNome = TABELAS_COMUNS[tabela] || `Tabela ${tabela}`;
  let output = `## SIDRA - ${tabelaNome}\n\n`;
  output += `Total de registros: ${dataRows.length}\n\n`;

  if (dataRows.length === 0) {
    return output + "Nenhum dado encontrado para os filtros aplicados.";
  }

  // Get column names from headers
  const columns = Object.keys(headerRow);
  const headers = columns.map((col) => headerRow[col] || col);

  // Build rows with formatted values
  const rows = dataRows.map((row) =>
    columns.map((col) => {
      const value = row[col];
      // Format numbers with thousand separators
      if (value && !isNaN(Number(value)) && value.length > 3) {
        return formatNumber(Number(value));
      }
      return value || "-";
    })
  );

  output += createMarkdownTable(headers, rows, {
    maxRows: 50,
    showRowCount: true,
  });

  if (dataRows.length > 50) {
    output += `_Use formato 'json' para dados completos._\n`;
  }

  return output;
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
      return parseHttpError(error, "ibge_sidra", { pesquisaId });
    }
    return ValidationErrors.emptyResult("ibge_sidra");
  }
}

// Tool definition for MCP
export const sidraTool = {
  name: "ibge_sidra",
  description: `Consulta tabelas do SIDRA (Sistema IBGE de Recuperação Automática).

O SIDRA contém dados de pesquisas do IBGE como Censo, PNAD, PIB, etc.

Tabelas mais utilizadas:
- 6579: Estimativas de população (anual)
- 9514: População do Censo 2022
- 200: População dos Censos (1970-2010)
- 4714: Taxa de desocupação (PNAD Contínua)
- 6381: Rendimento médio (PNAD Contínua)
- 6706: PIB a preços correntes
- 5938: PIB per capita
- 1705: Área territorial
- 1712: Densidade demográfica

Níveis territoriais (todos suportados):
- 1: Brasil
- 2: Grande Região (Norte, Nordeste, etc.)
- 3: UF (Unidade da Federação)
- 6: Município
- 7: Região Metropolitana
- 8: Mesorregião Geográfica
- 9: Microrregião Geográfica
- 10: Distrito
- 11: Subdistrito
- 13: Região Metropolitana e RIDE
- 14: Região Integrada de Desenvolvimento
- 15: Aglomeração Urbana
- 17: Região Geográfica Imediata
- 18: Região Geográfica Intermediária
- 105: Macrorregião de Saúde
- 106: Região de Saúde
- 114: Aglomerado Subnormal
- 127: Amazônia Legal
- 128: Semiárido

Exemplos de uso:
- População do Brasil 2023: tabela="6579", periodos="2023"
- População por Região: tabela="6579", nivel_territorial="2"
- População por Região de Saúde: tabela="6579", nivel_territorial="106"
- Censo 2022 por município de SP: tabela="9514", nivel_territorial="6", localidades="3550308"
- PIB do Brasil: tabela="6706", periodos="last"`,
  inputSchema: sidraSchema,
  handler: ibgeSidra,
};
