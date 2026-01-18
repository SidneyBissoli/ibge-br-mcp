import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, formatNumber } from "../utils/index.js";

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
    .describe("Nível territorial: 1=Brasil, 2=Região, 3=UF"),
  localidades: z.string().optional().default("all").describe("Códigos das localidades ou 'all'"),
  periodos: z
    .string()
    .optional()
    .default("last")
    .describe("Períodos (ex: '2023', 'last', 'last 4')"),
  formato: z.enum(["tabela", "json"]).optional().default("tabela").describe("Formato de saída"),
});

export type IndicadoresInput = z.infer<typeof indicadoresSchema>;

/**
 * Fetches economic and social indicators from IBGE
 */
export async function ibgeIndicadores(input: IndicadoresInput): Promise<string> {
  return withMetrics("ibge_indicadores", "agregados", async () => {
    // List available indicators
    if (input.indicador === "listar" || (!input.indicador && !input.categoria)) {
      return listIndicadores(input.categoria);
    }

    // Get indicator by category
    if (input.categoria && input.categoria !== "todos" && !input.indicador) {
      return listIndicadores(input.categoria);
    }

    // Get specific indicator
    const indicadorKey = input.indicador?.toLowerCase();
    if (!indicadorKey) {
      return listIndicadores();
    }

    const indicador = INDICADORES_CONHECIDOS[indicadorKey];
    if (!indicador) {
      return (
        `Indicador "${input.indicador}" não encontrado.\n\n` +
        `Use ibge_indicadores(indicador="listar") para ver os indicadores disponíveis.\n\n` +
        `Dica: Você também pode usar ibge_sidra_tabelas para buscar tabelas específicas.`
      );
    }

    try {
      // Build SIDRA URL
      const url = buildSidraUrl(
        indicador.tabela,
        input.nivel_territorial ?? "1",
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
          return formatErrorMessage(
            "Parâmetros inválidos",
            indicador,
            indicadorKey,
            "Verifique se o nível territorial e localidades são suportados para este indicador."
          );
        }
        throw fetchError;
      }

      if (!data || data.length === 0) {
        return formatErrorMessage(
          "Nenhum dado encontrado",
          indicador,
          indicadorKey,
          "Tente ajustar os períodos ou localidades."
        );
      }

      // Format output
      let output = `## ${indicador.nome}\n\n`;
      output += `**Descrição:** ${indicador.descricao}\n`;
      output += `**Periodicidade:** ${indicador.periodicidade}\n`;
      output += `**Tabela SIDRA:** ${indicador.tabela}\n\n`;

      if (input.formato === "json") {
        return output + "```json\n" + JSON.stringify(data, null, 2) + "\n```";
      }

      output += formatIndicadorTable(data);
      return output;
    } catch (error) {
      if (error instanceof Error) {
        return formatErrorMessage(
          error.message,
          indicadorKey ? INDICADORES_CONHECIDOS[indicadorKey] : undefined,
          indicadorKey ?? "unknown",
          "Verifique sua conexão ou tente novamente mais tarde."
        );
      }
      return "Erro desconhecido ao consultar indicador.";
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

// Tool definition for MCP
export const indicadoresTool = {
  name: "ibge_indicadores",
  description: `Consulta indicadores econômicos e sociais do IBGE.

Indicadores disponíveis:

**Econômicos:**
- pib: PIB a preços correntes
- pib_variacao: Variação do PIB (%)
- pib_per_capita: PIB per capita
- industria: Produção industrial
- comercio: Vendas do comércio
- servicos: Volume de serviços

**Preços:**
- ipca: IPCA mensal
- ipca_acumulado: IPCA 12 meses
- inpc: INPC mensal

**Trabalho:**
- desemprego: Taxa de desocupação
- ocupacao: Pessoas ocupadas
- rendimento: Rendimento médio
- informalidade: Taxa de informalidade

**População:**
- populacao: Estimativa populacional
- densidade: Densidade demográfica

**Agropecuária:**
- agricultura: Produção agrícola
- pecuaria: Efetivo de rebanhos

Exemplos:
- PIB: indicador="pib"
- IPCA últimos 12 meses: indicador="ipca", periodos="last 12"
- Desemprego por UF: indicador="desemprego", nivel_territorial="3"
- Listar indicadores: indicador="listar"`,
  inputSchema: indicadoresSchema,
  handler: ibgeIndicadores,
};
