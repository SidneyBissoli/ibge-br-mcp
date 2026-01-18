import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, formatNumber } from "../utils/index.js";

// Pre-defined comparison templates
const TEMPLATES_COMPARACAO: Record<
  string,
  {
    nome: string;
    descricao: string;
    tabela: string;
    variaveis: string;
    periodos: string;
    nivel_territorial: string;
  }
> = {
  populacao: {
    nome: "População",
    descricao: "Estimativa populacional",
    tabela: "6579",
    variaveis: "allxp",
    periodos: "last",
    nivel_territorial: "6",
  },
  populacao_censo: {
    nome: "População (Censo 2022)",
    descricao: "População do Censo Demográfico 2022",
    tabela: "9514",
    variaveis: "allxp",
    periodos: "last",
    nivel_territorial: "6",
  },
  pib: {
    nome: "PIB",
    descricao: "Produto Interno Bruto per capita",
    tabela: "5938",
    variaveis: "allxp",
    periodos: "last",
    nivel_territorial: "6",
  },
  area: {
    nome: "Área Territorial",
    descricao: "Área territorial em km²",
    tabela: "1705",
    variaveis: "allxp",
    periodos: "last",
    nivel_territorial: "6",
  },
  densidade: {
    nome: "Densidade Demográfica",
    descricao: "Habitantes por km²",
    tabela: "1712",
    variaveis: "allxp",
    periodos: "last",
    nivel_territorial: "6",
  },
  alfabetizacao: {
    nome: "Taxa de Alfabetização",
    descricao: "Taxa de alfabetização da população",
    tabela: "9543",
    variaveis: "allxp",
    periodos: "last",
    nivel_territorial: "6",
  },
  domicilios: {
    nome: "Domicílios",
    descricao: "Número de domicílios",
    tabela: "4711",
    variaveis: "allxp",
    periodos: "last",
    nivel_territorial: "6",
  },
};

export const compararSchema = z.object({
  localidades: z.string()
    .describe(`Códigos IBGE das localidades separados por vírgula (ex: "3550308,3304557,4106902").
Use 7 dígitos para municípios, 2 dígitos para UFs.`),
  indicador: z
    .enum([
      "populacao",
      "populacao_censo",
      "pib",
      "area",
      "densidade",
      "alfabetizacao",
      "domicilios",
      "listar",
    ])
    .optional()
    .default("populacao").describe(`Indicador para comparação:
- populacao: Estimativa populacional atual
- populacao_censo: População do Censo 2022
- pib: PIB per capita
- area: Área territorial (km²)
- densidade: Densidade demográfica (hab/km²)
- alfabetizacao: Taxa de alfabetização
- domicilios: Número de domicílios
- listar: Lista indicadores disponíveis`),
  formato: z
    .enum(["tabela", "json", "ranking"])
    .optional()
    .default("tabela")
    .describe("Formato de saída: tabela, json ou ranking (ordenado)"),
});

export type CompararInput = z.infer<typeof compararSchema>;

/**
 * Compares data between localities
 */
export async function ibgeComparar(input: CompararInput): Promise<string> {
  return withMetrics("ibge_comparar", "agregados", async () => {
    // List available indicators
    if (input.indicador === "listar") {
      return listIndicadoresComparacao();
    }

    const template = TEMPLATES_COMPARACAO[input.indicador || "populacao"];
    if (!template) {
      return (
        `Indicador "${input.indicador}" não encontrado.\n\n` +
        `Use ibge_comparar(indicador="listar") para ver os indicadores disponíveis.`
      );
    }

    // Parse localities
    const localidadesList = input.localidades.split(",").map((l) => l.trim());
    if (localidadesList.length < 2) {
      return (
        "Informe pelo menos 2 localidades para comparação.\n\n" +
        `Exemplo: localidades="3550308,3304557" para comparar São Paulo e Rio de Janeiro.`
      );
    }

    if (localidadesList.length > 10) {
      return (
        "Máximo de 10 localidades por comparação.\n\n" +
        "Para consultas maiores, use ibge_sidra diretamente."
      );
    }

    // Determine territorial level based on first code
    const nivel = localidadesList[0].length === 2 ? "3" : "6";

    try {
      // Build SIDRA URL
      const url = buildSidraUrl(
        template.tabela,
        nivel,
        localidadesList.join(","),
        template.periodos,
        template.variaveis
      );

      const key = cacheKey("comparar", {
        indicador: input.indicador,
        localidades: input.localidades,
      });

      const data = await cachedFetch<Record<string, string>[]>(url, key, CACHE_TTL.SHORT);

      if (!data || data.length <= 1) {
        return formatNoData(input, template);
      }

      // Get locality names
      const localidadeNames = await getLocalidadeNames(localidadesList, nivel);

      return formatCompararResponse(data, template, localidadeNames, input.formato || "tabela");
    } catch (error) {
      if (error instanceof Error) {
        return formatCompararError(error.message, input, template);
      }
      return "Erro desconhecido ao comparar localidades.";
    }
  });
}

function buildSidraUrl(
  tabela: string,
  nivel: string,
  localidades: string,
  periodos: string,
  variaveis: string
): string {
  let path = `/t/${tabela}`;
  path += `/n${nivel}/${localidades}`;
  path += `/v/${variaveis}`;
  path += `/p/${periodos}`;

  return `${IBGE_API.SIDRA}${path}`;
}

async function getLocalidadeNames(
  codigos: string[],
  nivel: string
): Promise<Record<string, string>> {
  const names: Record<string, string> = {};

  for (const codigo of codigos) {
    try {
      const endpoint =
        nivel === "3"
          ? `${IBGE_API.LOCALIDADES}/estados/${codigo}`
          : `${IBGE_API.LOCALIDADES}/municipios/${codigo}`;

      const key = cacheKey("localidade-nome", { codigo });
      const data = await cachedFetch<{ nome: string; sigla?: string }>(
        endpoint,
        key,
        CACHE_TTL.STATIC
      );

      names[codigo] = data.sigla || data.nome;
    } catch {
      names[codigo] = codigo;
    }
  }

  return names;
}

function formatCompararResponse(
  data: Record<string, string>[],
  template: (typeof TEMPLATES_COMPARACAO)[string],
  names: Record<string, string>,
  formato: string
): string {
  let output = `## Comparação: ${template.nome}\n\n`;
  output += `**Descrição:** ${template.descricao}\n`;
  output += `**Tabela SIDRA:** ${template.tabela}\n\n`;

  // Extract header and data rows
  const headerRow = data[0];
  const dataRows = data.slice(1);

  if (formato === "json") {
    const jsonData = dataRows.map((row) => {
      const result: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(row)) {
        const headerName = headerRow[key] || key;
        if (headerName.includes("Código")) continue;
        result[headerName] = value;
      }
      return result;
    });
    return output + "```json\n" + JSON.stringify(jsonData, null, 2) + "\n```";
  }

  // Find value column and locality column
  let valueCol = "";
  let localCol = "";
  for (const key of Object.keys(headerRow)) {
    const header = headerRow[key].toLowerCase();
    if (
      header.includes("valor") ||
      header.includes("população") ||
      header.includes("área") ||
      header.includes("pib") ||
      header.includes("taxa") ||
      header.includes("domicílio")
    ) {
      valueCol = key;
    }
    if (header.includes("município") || header.includes("unidade")) {
      localCol = key;
    }
  }

  // Prepare comparison data
  interface ComparisonRow {
    codigo: string;
    nome: string;
    valor: number;
    valorStr: string;
  }

  const comparisonData: ComparisonRow[] = [];

  for (const row of dataRows) {
    // Find the locality code in the row
    let codigo = "";
    for (const [key, value] of Object.entries(row)) {
      if (headerRow[key]?.toLowerCase().includes("código") && value.length >= 2) {
        codigo = value;
        break;
      }
    }

    const valorStr = valueCol ? row[valueCol] : "-";
    const valor = parseFloat(valorStr.replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;

    comparisonData.push({
      codigo,
      nome: names[codigo] || (localCol ? row[localCol] : codigo),
      valor,
      valorStr,
    });
  }

  // Sort by value for ranking format
  if (formato === "ranking") {
    comparisonData.sort((a, b) => b.valor - a.valor);
  }

  // Build table
  const rows = comparisonData.map((item, index) => {
    const valorFormatado = item.valor > 0 ? formatNumber(item.valor) : item.valorStr;
    return [String(index + 1), item.nome, valorFormatado];
  });

  output += createMarkdownTable(["#", "Localidade", "Valor"], rows, {
    alignment: ["right", "left", "right"],
  });

  // Add statistics
  if (comparisonData.length >= 2 && comparisonData[0].valor > 0) {
    const valores = comparisonData.map((d) => d.valor).filter((v) => v > 0);
    const max = Math.max(...valores);
    const min = Math.min(...valores);
    const avg = valores.reduce((a, b) => a + b, 0) / valores.length;

    output += "\n### Estatísticas\n\n";
    output += `- **Maior:** ${formatNumber(max)}\n`;
    output += `- **Menor:** ${formatNumber(min)}\n`;
    output += `- **Média:** ${formatNumber(avg, { maximumFractionDigits: 2 })}\n`;
    output += `- **Variação:** ${((max / min - 1) * 100).toFixed(1)}%\n`;
  }

  return output;
}

function listIndicadoresComparacao(): string {
  let output = "## Indicadores Disponíveis para Comparação\n\n";

  const indicadoresRows = Object.entries(TEMPLATES_COMPARACAO).map(([key, info]) => [
    key,
    info.nome,
    info.descricao,
  ]);
  output += createMarkdownTable(["Indicador", "Nome", "Descrição"], indicadoresRows, {
    alignment: ["left", "left", "left"],
  });

  output += "\n### Exemplos de uso\n\n";
  output += "```\n";
  output += "# Comparar população de capitais\n";
  output += 'ibge_comparar(localidades="3550308,3304557,4106902", indicador="populacao")\n\n';
  output += "# Comparar PIB de estados\n";
  output += 'ibge_comparar(localidades="35,33,41", indicador="pib")\n\n';
  output += "# Ranking por área\n";
  output +=
    'ibge_comparar(localidades="3550308,3304557,5300108", indicador="area", formato="ranking")\n';
  output += "```\n\n";

  output += "### Códigos de exemplo\n\n";
  output += createMarkdownTable(
    ["Município", "Código"],
    [
      ["São Paulo - SP", "3550308"],
      ["Rio de Janeiro - RJ", "3304557"],
      ["Curitiba - PR", "4106902"],
      ["Belo Horizonte - MG", "3106200"],
      ["Brasília - DF", "5300108"],
    ],
    {
      alignment: ["left", "right"],
    }
  );

  return output;
}

function formatNoData(
  input: CompararInput,
  template: (typeof TEMPLATES_COMPARACAO)[string]
): string {
  return (
    `## Comparação: ${template.nome}\n\n` +
    `Nenhum dado encontrado para as localidades: ${input.localidades}\n\n` +
    `**Dica:** Verifique se os códigos IBGE estão corretos.\n` +
    `Use ibge_geocodigo(nome="cidade") para encontrar códigos.\n`
  );
}

function formatCompararError(
  message: string,
  input: CompararInput,
  template: (typeof TEMPLATES_COMPARACAO)[string]
): string {
  return (
    `## Erro na Comparação\n\n` +
    `**Indicador:** ${template.nome}\n` +
    `**Localidades:** ${input.localidades}\n` +
    `**Erro:** ${message}\n\n` +
    `**Dica:** Verifique se as localidades informadas têm dados disponíveis para este indicador.\n`
  );
}

// Tool definition for MCP
export const compararTool = {
  name: "ibge_comparar",
  description: `Compara dados entre localidades (municípios ou UFs).

Indicadores disponíveis:
- populacao: Estimativa populacional atual
- populacao_censo: População do Censo 2022
- pib: PIB per capita
- area: Área territorial (km²)
- densidade: Densidade demográfica (hab/km²)
- alfabetizacao: Taxa de alfabetização
- domicilios: Número de domicílios

Funcionalidades:
- Compara até 10 localidades
- Calcula estatísticas (maior, menor, média)
- Gera ranking ordenado
- Aceita municípios ou UFs

Exemplos:
- Comparar capitais: localidades="3550308,3304557", indicador="populacao"
- Comparar estados: localidades="35,33,41", indicador="pib"
- Ranking por área: localidades="3550308,3304557", formato="ranking"
- Listar indicadores: indicador="listar"`,
  inputSchema: compararSchema,
  handler: ibgeComparar,
};
