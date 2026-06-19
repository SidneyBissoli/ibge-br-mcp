import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, formatNumber } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import { territorialLevelHint, territorialLevelList } from "../config.js";
import { type StructuredToolResult, sidraRecords, selectSidraColumns } from "../structured.js";

// Census data is published by SIDRA down to the municipality level.
const CENSO_NIVEIS = ["1", "2", "3", "6"];

// Mapping of census data themes to SIDRA tables
const CENSO_TABELAS: Record<string, Record<string, { tabela: string; descricao: string }>> = {
  // População
  populacao: {
    "1970-2010": {
      tabela: "200",
      descricao: "População residente por sexo e situação (série histórica)",
    },
    "1991-2010": {
      tabela: "202",
      descricao: "População residente por sexo e situação do domicílio",
    },
    "2000": { tabela: "1552", descricao: "População residente por situação, sexo e idade" },
    "2010": {
      tabela: "1378",
      descricao: "População residente por situação, sexo, idade e condição no domicílio",
    },
    "2022": { tabela: "9514", descricao: "População residente por idade e sexo (universo)" },
    "2022-primeiros": { tabela: "4709", descricao: "População residente - primeiros resultados" },
  },
  // Alfabetização
  alfabetizacao: {
    "1970-2010": {
      tabela: "204",
      descricao: "População de 5 anos ou mais por alfabetização e idade",
    },
    "2000": {
      tabela: "752",
      descricao: "População de 5 anos ou mais por alfabetização, sexo e idade",
    },
    "2010": {
      tabela: "1383",
      descricao: "População de 5 anos ou mais por alfabetização e grupos de idade",
    },
    "2022": { tabela: "9543", descricao: "Taxa de alfabetização por idade, cor/raça e sexo" },
  },
  // Domicílios
  domicilios: {
    "2000": { tabela: "753", descricao: "Domicílios por tipo e situação" },
    "2010": { tabela: "3164", descricao: "Domicílios por tipo, situação e número de moradores" },
    "2022": { tabela: "4711", descricao: "Domicílios - primeiros resultados" },
    "2022-detalhado": { tabela: "9605", descricao: "Domicílios particulares permanentes" },
  },
  // Idade e sexo
  idade_sexo: {
    "2000": { tabela: "200", descricao: "População por grupos de idade e sexo" },
    "2010": { tabela: "1552", descricao: "População por forma de declaração da idade e idade" },
    "2022": { tabela: "9514", descricao: "População por idade e sexo" },
    "2022-piramide": { tabela: "9515", descricao: "Pirâmide etária" },
  },
  // Religião
  religiao: {
    "2000": { tabela: "2102", descricao: "População por religião" },
    "2010": { tabela: "2103", descricao: "População por situação, sexo, idade e religião" },
  },
  // Cor/Raça
  cor_raca: {
    "2000": { tabela: "2093", descricao: "População por cor ou raça" },
    "2010": { tabela: "3175", descricao: "População por cor ou raça e sexo" },
    "2022": { tabela: "9605", descricao: "População por cor ou raça" },
  },
  // Rendimento
  rendimento: {
    "2000": { tabela: "857", descricao: "Rendimento médio mensal" },
    "2010": { tabela: "3548", descricao: "Rendimento nominal mensal per capita" },
  },
  // Migração
  migracao: {
    "2000": { tabela: "631", descricao: "População por lugar de nascimento" },
    "2010": { tabela: "1505", descricao: "Emigrantes internacionais" },
  },
  // Educação
  educacao: {
    "2000": { tabela: "706", descricao: "População por nível de instrução" },
    "2010": { tabela: "3540", descricao: "População por nível de instrução e sexo" },
  },
  // Trabalho
  trabalho: {
    "2000": { tabela: "616", descricao: "Pessoas de 10 anos ou mais por condição de ocupação" },
    "2010": { tabela: "3592", descricao: "População ocupada por setor de atividade" },
  },
  // Indígenas (novo)
  indigenas: {
    "2010": { tabela: "3451", descricao: "População indígena por etnia e localização" },
    "2022": { tabela: "9587", descricao: "População indígena por etnia, sexo e idade" },
    "2022-terras": { tabela: "9588", descricao: "População indígena em terras indígenas" },
  },
  // Quilombolas (novo)
  quilombolas: {
    "2022": { tabela: "9674", descricao: "População quilombola por sexo e idade" },
    "2022-territorios": { tabela: "9675", descricao: "População em territórios quilombolas" },
  },
  // Saneamento (novo)
  saneamento: {
    "2000": { tabela: "764", descricao: "Domicílios por forma de abastecimento de água" },
    "2010": { tabela: "3218", descricao: "Domicílios por tipo de saneamento" },
    "2022": { tabela: "9696", descricao: "Domicílios por abastecimento de água e esgotamento" },
  },
  // Deficiência (novo)
  deficiencia: {
    "2000": { tabela: "2649", descricao: "Pessoas com deficiência por tipo" },
    "2010": { tabela: "3426", descricao: "População com deficiência por tipo e grau" },
  },
  // Nupcialidade/Estado civil (novo)
  nupcialidade: {
    "2000": { tabela: "594", descricao: "Pessoas de 10 anos ou mais por estado civil" },
    "2010": { tabela: "1488", descricao: "Pessoas por estado civil e sexo" },
  },
  // Fecundidade (novo)
  fecundidade: {
    "2000": { tabela: "2443", descricao: "Mulheres por número de filhos nascidos vivos" },
    "2010": { tabela: "1691", descricao: "Taxa de fecundidade" },
  },
};

// Available themes
const TEMAS_CENSO = [
  "populacao",
  "alfabetizacao",
  "domicilios",
  "idade_sexo",
  "religiao",
  "cor_raca",
  "rendimento",
  "migracao",
  "educacao",
  "trabalho",
  "indigenas",
  "quilombolas",
  "saneamento",
  "deficiencia",
  "nupcialidade",
  "fecundidade",
] as const;

// Schema for the tool input
export const censoSchema = z.object({
  ano: z
    .enum(["1970", "1980", "1991", "2000", "2010", "2022", "todos"])
    .optional()
    .describe("Ano do censo (1970, 1980, 1991, 2000, 2010, 2022) ou 'todos' para série histórica"),
  tema: z
    .enum([
      "populacao",
      "alfabetizacao",
      "domicilios",
      "idade_sexo",
      "religiao",
      "cor_raca",
      "rendimento",
      "migracao",
      "educacao",
      "trabalho",
      "indigenas",
      "quilombolas",
      "saneamento",
      "deficiencia",
      "nupcialidade",
      "fecundidade",
      "listar",
    ])
    .optional()
    .default("populacao").describe(`Tema dos dados:
- populacao: População residente
- alfabetizacao: Taxa de alfabetização
- domicilios: Características dos domicílios
- idade_sexo: Pirâmide etária
- religiao: Distribuição por religião
- cor_raca: Cor ou raça
- rendimento: Rendimento mensal
- migracao: Migração
- educacao: Nível de instrução
- trabalho: Ocupação e trabalho
- indigenas: População indígena
- quilombolas: População quilombola
- saneamento: Abastecimento de água e esgoto
- deficiencia: Pessoas com deficiência
- nupcialidade: Estado civil
- fecundidade: Taxa de fecundidade
- listar: Lista tabelas disponíveis`),
  nivel_territorial: z
    .string()
    .optional()
    .default("1")
    .describe(territorialLevelHint(CENSO_NIVEIS)),
  localidades: z.string().optional().default("all").describe("Códigos das localidades ou 'all'"),
  formato: z.enum(["tabela", "json"]).optional().default("tabela").describe("Formato de saída"),
  campos: z
    .string()
    .optional()
    .describe(
      "Selecionar apenas algumas colunas por rótulo, separadas por vírgula (ex: 'Valor,Ano'). Reduz o volume da resposta."
    ),
});

export type CensoInput = z.infer<typeof censoSchema>;

/** Structured output payload (validated against this schema by the MCP SDK). */
export const censoOutputSchema = z.object({
  tema: z.string().optional().describe("Tema do censo consultado"),
  tabela: z.string().optional().describe("Tabela SIDRA de origem"),
  descricao: z.string().optional().describe("Descrição da tabela"),
  ano: z.string().optional().describe("Ano(s) de referência"),
  totalRegistros: z.number().describe("Total de registros de dados"),
  colunas: z.array(z.string()).describe("Rótulos das colunas, na ordem"),
  registros: z
    .array(z.record(z.string()))
    .describe("Registros: cada um mapeia rótulo da coluna -> valor"),
});

/** Minimal valid payload for non-data success responses (e.g. the table catalog). */
function emptyMeta(): Record<string, unknown> {
  return { totalRegistros: 0, colunas: [], registros: [] };
}

/**
 * Fetches census data from IBGE SIDRA API
 */
export async function ibgeCenso(input: CensoInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_censo", "sidra", async () => {
    // If tema is "listar", show available tables (catalog in the text channel)
    if (input.tema === "listar") {
      return { markdown: listAvailableTables(input.ano), structured: emptyMeta() };
    }

    // Get the appropriate table
    const tema = input.tema || "populacao";
    const temaTabelas = CENSO_TABELAS[tema];

    if (!temaTabelas) {
      return {
        markdown: `Tema "${tema}" não encontrado. Temas disponíveis: ${TEMAS_CENSO.join(", ")}`,
        isError: true,
      };
    }

    // Determine which table to use based on year
    let tabelaInfo: { tabela: string; descricao: string } | undefined;
    let periodos = "last";

    if (input.ano === "todos" || !input.ano) {
      // Try to find a table with historical series
      tabelaInfo = temaTabelas["1970-2010"] || temaTabelas["1991-2010"];
      periodos = "all";

      if (!tabelaInfo) {
        // No historical series, get most recent
        tabelaInfo = temaTabelas["2022"] || temaTabelas["2010"] || temaTabelas["2000"];
      }
    } else {
      // Specific year requested
      tabelaInfo = temaTabelas[input.ano];

      // If not found for specific year, try ranges
      if (!tabelaInfo) {
        if (["1970", "1980", "1991", "2000", "2010"].includes(input.ano)) {
          tabelaInfo = temaTabelas["1970-2010"] || temaTabelas["1991-2010"];
        }
      }

      periodos = input.ano;
    }

    if (!tabelaInfo) {
      return {
        markdown:
          `Dados de "${tema}" não disponíveis para o ano ${input.ano || "solicitado"}.\n\n` +
          `Use ibge_censo(tema="listar") para ver tabelas disponíveis.`,
        isError: true,
      };
    }

    const nivel = input.nivel_territorial ?? "1";
    if (!CENSO_NIVEIS.includes(nivel)) {
      return {
        markdown: ValidationErrors.invalidTerritory(
          nivel,
          "ibge_censo",
          territorialLevelList(CENSO_NIVEIS)
        ),
        isError: true,
      };
    }

    const meta = { tema, tabela: tabelaInfo.tabela, descricao: tabelaInfo.descricao, ano: input.ano };

    // Build SIDRA query
    try {
      const url = buildSidraUrl(tabelaInfo.tabela, nivel, input.localidades ?? "all", periodos);

      // Use cache for census data (1 hour TTL - data doesn't change often but queries vary)
      const key = cacheKey(url);
      let data: Record<string, string>[];

      try {
        data = await cachedFetch<Record<string, string>[]>(url, key, CACHE_TTL.MEDIUM);
      } catch (error) {
        if (error instanceof Error && error.message.includes("400")) {
          return {
            markdown:
              `Erro na consulta: Parâmetros inválidos para a tabela ${tabelaInfo.tabela}.\n` +
              `Descrição: ${tabelaInfo.descricao}\n\n` +
              `Use ibge_sidra_metadados(tabela="${tabelaInfo.tabela}") para ver a estrutura da tabela.`,
            isError: true,
          };
        }
        throw error;
      }

      if (!data || data.length === 0) {
        return {
          markdown: "Nenhum dado encontrado para os parâmetros informados.",
          structured: { ...meta, ...sidraRecords(data) },
        };
      }

      // Apply optional field selection (1.2) to both channels.
      const filtered = selectSidraColumns(data, input.campos);

      // Format output
      let output = `## Censo Demográfico - ${tema.charAt(0).toUpperCase() + tema.slice(1).replace("_", " ")}\n\n`;
      output += `**Tabela SIDRA:** ${tabelaInfo.tabela}\n`;
      output += `**Descrição:** ${tabelaInfo.descricao}\n`;
      output += `**Ano(s):** ${input.ano || "Série histórica"}\n\n`;

      const structured = { ...meta, ...sidraRecords(filtered) };

      if (input.formato === "json") {
        return {
          markdown: output + "```json\n" + JSON.stringify(filtered, null, 2) + "\n```",
          structured,
        };
      }

      // Format as table
      output += formatCensoTable(filtered);

      return { markdown: output, structured };
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: parseHttpError(error, "ibge_censo", { ano: input.ano, tema: input.tema }, [
            "ibge_sidra_metadados",
            "ibge_sidra",
          ]),
          isError: true,
        };
      }
      return { markdown: ValidationErrors.emptyResult("ibge_censo"), isError: true };
    }
  });
}

function buildSidraUrl(
  tabela: string,
  nivel: string,
  localidades: string,
  periodos: string
): string {
  let path = `/t/${tabela}`;
  path += `/n${nivel}/${localidades}`;
  path += `/v/allxp`;
  path += `/p/${periodos}`;

  return `${IBGE_API.SIDRA}${path}`;
}

function formatCensoTable(data: Record<string, string>[]): string {
  if (data.length === 0) return "Nenhum dado encontrado.";

  const headerRow = data[0];
  const dataRows = data.slice(1);
  const columns = Object.keys(headerRow);

  // Limit to first 30 rows
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

function listAvailableTables(ano?: string): string {
  let output = "## Tabelas do Censo Demográfico Disponíveis\n\n";

  if (ano && ano !== "todos") {
    output += `### Tabelas para o Censo ${ano}\n\n`;

    const rows: string[][] = [];
    for (const [tema, tabelas] of Object.entries(CENSO_TABELAS)) {
      const tabelaInfo =
        tabelas[ano] ||
        (["1970", "1980", "1991", "2000", "2010"].includes(ano)
          ? tabelas["1970-2010"] || tabelas["1991-2010"]
          : null);
      if (tabelaInfo) {
        rows.push([tema, tabelaInfo.tabela, tabelaInfo.descricao]);
      }
    }
    output += createMarkdownTable(["Tema", "Tabela", "Descrição"], rows, {
      alignment: ["left", "right", "left"],
    });
  } else {
    // List all tables by theme
    for (const [tema, tabelas] of Object.entries(CENSO_TABELAS)) {
      output += `### ${tema.charAt(0).toUpperCase() + tema.slice(1).replace("_", " ")}\n\n`;

      const rows = Object.entries(tabelas).map(([anos, info]) => [
        anos,
        info.tabela,
        info.descricao,
      ]);
      output += createMarkdownTable(["Anos", "Tabela", "Descrição"], rows, {
        alignment: ["left", "right", "left"],
      });
      output += "\n";
    }
  }

  output += "---\n\n";
  output += "### Como usar\n\n";
  output += "```\n";
  output += "# População do Censo 2022\n";
  output += 'ibge_censo(ano="2022", tema="populacao")\n\n';
  output += "# Série histórica de população (1970-2010)\n";
  output += 'ibge_censo(ano="todos", tema="populacao")\n\n';
  output += "# Alfabetização em 2010 por UF\n";
  output += 'ibge_censo(ano="2010", tema="alfabetizacao", nivel_territorial="3")\n\n';
  output += "# População de um município específico\n";
  output +=
    'ibge_censo(ano="2022", tema="populacao", nivel_territorial="6", localidades="3550308")\n';
  output += "```\n";

  return output;
}

