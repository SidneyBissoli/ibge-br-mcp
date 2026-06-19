import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, formatNumber } from "../utils/index.js";
import { ValidationErrors } from "../errors.js";
import { territorialLevelHint, territorialLevelList } from "../config.js";
import { type StructuredToolResult, sidraRecords, selectSidraColumns } from "../structured.js";

// These aggregates are published down to UF level (no municipal breakdown).
const INDICADORES_NIVEIS = ["1", "2", "3"];

// Common indicators with their SIDRA tables
const INDICADORES_CONHECIDOS: Record<
  string,
  {
    tabela: string;
    variavel?: string;
    nome: string;
    descricao: string;
    periodicidade: string;
    categoria: string;
  }
> = {
  // Econômicos
  pib: {
    tabela: "6784",
    nome: "PIB - Produto Interno Bruto",
    descricao: "Valor do PIB a preços correntes",
    periodicidade: "Trimestral",
    categoria: "economico",
  },
  pib_variacao: {
    tabela: "6612",
    nome: "PIB - Variação",
    descricao: "Taxa de variação do PIB (% em relação ao mesmo trimestre do ano anterior)",
    periodicidade: "Trimestral",
    categoria: "economico",
  },
  pib_per_capita: {
    tabela: "5938",
    nome: "PIB per capita",
    descricao: "PIB per capita a preços correntes",
    periodicidade: "Anual",
    categoria: "economico",
  },
  industria: {
    tabela: "8888",
    nome: "Produção Industrial",
    descricao: "Índice de produção física industrial",
    periodicidade: "Mensal",
    categoria: "economico",
  },
  comercio: {
    tabela: "8880",
    nome: "Volume de Vendas do Comércio",
    descricao: "Índice de volume de vendas no comércio varejista",
    periodicidade: "Mensal",
    categoria: "economico",
  },
  servicos: {
    tabela: "8688",
    nome: "Volume de Serviços",
    descricao: "Índice de volume de serviços",
    periodicidade: "Mensal",
    categoria: "economico",
  },
  // Preços
  ipca: {
    tabela: "7060",
    nome: "IPCA - Variação Mensal",
    descricao: "Índice Nacional de Preços ao Consumidor Amplo",
    periodicidade: "Mensal",
    categoria: "precos",
  },
  ipca_acumulado: {
    tabela: "7062",
    nome: "IPCA - Acumulado 12 meses",
    descricao: "IPCA acumulado nos últimos 12 meses",
    periodicidade: "Mensal",
    categoria: "precos",
  },
  inpc: {
    tabela: "7063",
    nome: "INPC - Variação Mensal",
    descricao: "Índice Nacional de Preços ao Consumidor",
    periodicidade: "Mensal",
    categoria: "precos",
  },
  // Trabalho
  desemprego: {
    tabela: "4099",
    variavel: "4099",
    nome: "Taxa de Desocupação",
    descricao: "Taxa de desocupação da população de 14 anos ou mais",
    periodicidade: "Trimestral",
    categoria: "trabalho",
  },
  ocupacao: {
    tabela: "4093",
    nome: "Pessoas Ocupadas",
    descricao: "Pessoas de 14 anos ou mais ocupadas",
    periodicidade: "Trimestral",
    categoria: "trabalho",
  },
  rendimento: {
    tabela: "6387",
    nome: "Rendimento Médio",
    descricao: "Rendimento médio real habitual do trabalho principal",
    periodicidade: "Trimestral",
    categoria: "trabalho",
  },
  informalidade: {
    tabela: "4099",
    variavel: "4100",
    nome: "Taxa de Informalidade",
    descricao: "Taxa de informalidade da população ocupada",
    periodicidade: "Trimestral",
    categoria: "trabalho",
  },
  // População
  populacao: {
    tabela: "6579",
    nome: "Estimativa de População",
    descricao: "Estimativa da população residente",
    periodicidade: "Anual",
    categoria: "populacao",
  },
  densidade: {
    tabela: "1712",
    nome: "Densidade Demográfica",
    descricao: "Densidade demográfica (hab/km²)",
    periodicidade: "Decenal",
    categoria: "populacao",
  },
  // Agropecuária
  agricultura: {
    tabela: "5457",
    nome: "Produção Agrícola",
    descricao: "Produção agrícola municipal",
    periodicidade: "Anual",
    categoria: "agropecuaria",
  },
  pecuaria: {
    tabela: "3939",
    nome: "Efetivo de Rebanhos",
    descricao: "Efetivo dos rebanhos",
    periodicidade: "Anual",
    categoria: "agropecuaria",
  },
};

// Categories for listing
const CATEGORIAS = {
  economico: "Indicadores Econômicos",
  precos: "Índices de Preços",
  trabalho: "Mercado de Trabalho",
  populacao: "População",
  agropecuaria: "Agropecuária",
};

export const indicadoresSchema = z.object({
  indicador: z.string().optional()
    .describe(`Nome do indicador (ex: "pib", "ipca", "desemprego", "populacao").
Use "listar" para ver todos os indicadores disponíveis.`),
  categoria: z
    .enum(["economico", "precos", "trabalho", "populacao", "agropecuaria", "todos"])
    .optional()
    .describe("Filtrar por categoria de indicadores"),
  nivel_territorial: z
    .string()
    .optional()
    .default("1")
    .describe(territorialLevelHint(INDICADORES_NIVEIS)),
  localidades: z.string().optional().default("all").describe("Códigos das localidades ou 'all'"),
  periodos: z
    .string()
    .optional()
    .default("last")
    .describe("Períodos (ex: '2023', 'last', 'last 4')"),
  formato: z.enum(["tabela", "json"]).optional().default("tabela").describe("Formato de saída"),
  campos: z
    .string()
    .optional()
    .describe(
      "Selecionar apenas algumas colunas por rótulo, separadas por vírgula (ex: 'Valor,Ano'). Reduz o volume da resposta."
    ),
});

export type IndicadoresInput = z.infer<typeof indicadoresSchema>;

/** Structured output payload (validated against this schema by the MCP SDK). */
export const indicadoresOutputSchema = z.object({
  indicador: z.string().optional().describe("Chave do indicador consultado"),
  nome: z.string().optional().describe("Nome do indicador"),
  tabela: z.string().optional().describe("Tabela SIDRA de origem"),
  totalRegistros: z.number().describe("Total de registros de dados"),
  colunas: z.array(z.string()).describe("Rótulos das colunas, na ordem"),
  registros: z
    .array(z.record(z.string()))
    .describe("Registros: cada um mapeia rótulo da coluna -> valor"),
});

/** Minimal valid payload for non-data success responses (e.g. the indicator catalog). */
function emptyMeta(): Record<string, unknown> {
  return { totalRegistros: 0, colunas: [], registros: [] };
}

/**
 * Fetches economic and social indicators from IBGE
 */
export async function ibgeIndicadores(input: IndicadoresInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_indicadores", "agregados", async () => {
    // List available indicators (catalog goes in the text channel)
    if (input.indicador === "listar" || (!input.indicador && !input.categoria)) {
      return { markdown: listIndicadores(input.categoria), structured: emptyMeta() };
    }

    // Get indicator by category
    if (input.categoria && input.categoria !== "todos" && !input.indicador) {
      return { markdown: listIndicadores(input.categoria), structured: emptyMeta() };
    }

    // Get specific indicator
    const indicadorKey = input.indicador?.toLowerCase();
    if (!indicadorKey) {
      return { markdown: listIndicadores(), structured: emptyMeta() };
    }

    const indicador = INDICADORES_CONHECIDOS[indicadorKey];
    if (!indicador) {
      return {
        markdown:
          `Indicador "${input.indicador}" não encontrado.\n\n` +
          `Use ibge_indicadores(indicador="listar") para ver os indicadores disponíveis.\n\n` +
          `Dica: Você também pode usar ibge_sidra_tabelas para buscar tabelas específicas.`,
        isError: true,
      };
    }

    const nivel = input.nivel_territorial ?? "1";
    if (!INDICADORES_NIVEIS.includes(nivel)) {
      return {
        markdown: ValidationErrors.invalidTerritory(
          nivel,
          "ibge_indicadores",
          territorialLevelList(INDICADORES_NIVEIS)
        ),
        isError: true,
      };
    }

    try {
      // Build SIDRA URL
      const url = buildSidraUrl(
        indicador.tabela,
        nivel,
        input.localidades ?? "all",
        input.periodos ?? "last",
        indicador.variavel
      );

      const key = cacheKey("indicadores", {
        indicador: indicadorKey,
        nivel: input.nivel_territorial,
        localidades: input.localidades,
        periodos: input.periodos,
      });

      let data: Record<string, string>[];
      try {
        data = await cachedFetch<Record<string, string>[]>(url, key, CACHE_TTL.SHORT);
      } catch (fetchError) {
        // Provide helpful error message
        if (fetchError instanceof Error && fetchError.message.includes("400")) {
          return {
            markdown: formatErrorMessage(
              "Parâmetros inválidos",
              indicador,
              indicadorKey,
              "Verifique se o nível territorial e localidades são suportados para este indicador."
            ),
            isError: true,
          };
        }
        throw fetchError;
      }

      const meta = { indicador: indicadorKey, nome: indicador.nome, tabela: indicador.tabela };

      if (!data || data.length === 0) {
        // No data is a valid (empty) result, not a failure.
        return {
          markdown: formatErrorMessage(
            "Nenhum dado encontrado",
            indicador,
            indicadorKey,
            "Tente ajustar os períodos ou localidades."
          ),
          structured: { ...meta, ...sidraRecords(data) },
        };
      }

      // Format output
      let output = `## ${indicador.nome}\n\n`;
      output += `**Descrição:** ${indicador.descricao}\n`;
      output += `**Periodicidade:** ${indicador.periodicidade}\n`;
      output += `**Tabela SIDRA:** ${indicador.tabela}\n\n`;

      // Apply optional field selection (1.2) to both channels.
      const filtered = selectSidraColumns(data, input.campos);
      const structured = { ...meta, ...sidraRecords(filtered) };

      if (input.formato === "json") {
        return {
          markdown: output + "```json\n" + JSON.stringify(filtered, null, 2) + "\n```",
          structured,
        };
      }

      output += formatIndicadorTable(filtered);
      return { markdown: output, structured };
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: formatErrorMessage(
            error.message,
            indicadorKey ? INDICADORES_CONHECIDOS[indicadorKey] : undefined,
            indicadorKey ?? "unknown",
            "Verifique sua conexão ou tente novamente mais tarde."
          ),
          isError: true,
        };
      }
      return { markdown: "Erro desconhecido ao consultar indicador.", isError: true };
    }
  });
}

function buildSidraUrl(
  tabela: string,
  nivel: string,
  localidades: string,
  periodos: string,
  variavel?: string
): string {
  let path = `/t/${tabela}`;
  path += `/n${nivel}/${localidades}`;
  path += `/v/${variavel || "allxp"}`;
  path += `/p/${periodos}`;

  return `${IBGE_API.SIDRA}${path}`;
}

function listIndicadores(categoria?: string): string {
  let output = "## Indicadores Disponíveis\n\n";

  const categoriasToShow =
    categoria && categoria !== "todos"
      ? { [categoria]: CATEGORIAS[categoria as keyof typeof CATEGORIAS] }
      : CATEGORIAS;

  for (const [catKey, catNome] of Object.entries(categoriasToShow)) {
    const indicadoresCategoria = Object.entries(INDICADORES_CONHECIDOS).filter(
      ([, info]) => info.categoria === catKey
    );

    if (indicadoresCategoria.length === 0) continue;

    output += `### ${catNome}\n\n`;

    const rows = indicadoresCategoria.map(([codigo, info]) => [
      codigo,
      info.nome,
      info.periodicidade,
      info.tabela,
    ]);
    output += createMarkdownTable(["Código", "Nome", "Periodicidade", "Tabela SIDRA"], rows, {
      alignment: ["left", "left", "left", "right"],
    });
    output += "\n";
  }

  output += "---\n\n";
  output += "### Como usar\n\n";
  output += "```\n";
  output += "# PIB do Brasil\n";
  output += 'ibge_indicadores(indicador="pib")\n\n';
  output += "# IPCA dos últimos 12 meses\n";
  output += 'ibge_indicadores(indicador="ipca", periodos="last 12")\n\n';
  output += "# Taxa de desemprego por UF\n";
  output += 'ibge_indicadores(indicador="desemprego", nivel_territorial="3")\n\n';
  output += "# Listar indicadores de preços\n";
  output += 'ibge_indicadores(categoria="precos")\n';
  output += "```\n";

  return output;
}

function formatIndicadorTable(data: Record<string, string>[]): string {
  if (data.length === 0) return "Nenhum dado encontrado.";

  const headerRow = data[0];
  const dataRows = data.slice(1);
  const columns = Object.keys(headerRow);

  const displayRows = dataRows.slice(0, 30);

  const headers = columns.map((col) => headerRow[col] || col);
  const rows = displayRows.map((row) =>
    columns.map((col) => {
      const value = row[col];
      if (value && !isNaN(Number(value)) && value.length > 3) {
        return formatNumber(Number(value));
      }
      return value || "-";
    })
  );

  let output = createMarkdownTable(headers, rows);

  if (dataRows.length > 30) {
    output += `\n_Mostrando 30 de ${dataRows.length} registros._\n`;
  }

  return output;
}

function formatErrorMessage(
  error: string,
  indicador: (typeof INDICADORES_CONHECIDOS)[string] | undefined,
  indicadorKey: string,
  dica: string
): string {
  return (
    `## Erro ao consultar indicador\n\n` +
    `**Indicador:** ${indicador?.nome || indicadorKey}\n` +
    `**Erro:** ${error}\n\n` +
    `**Dica:** ${dica}\n\n` +
    `Para ver a estrutura completa desta tabela, use:\n` +
    `\`\`\`\nibge_sidra_metadados(tabela="${indicador?.tabela}")\n\`\`\``
  );
}

