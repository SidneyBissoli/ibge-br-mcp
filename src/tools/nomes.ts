import { z } from "zod";
import { IBGE_API, type NomeFrequencia, type NomeRanking } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, formatNumber, buildQueryString } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";

// Schema for frequency search
export const nomesFrequenciaSchema = z.object({
  nomes: z
    .string()
    .describe("Nome ou nomes separados por vírgula (ex: 'Maria' ou 'João,José,Pedro')"),
  sexo: z.enum(["M", "F"]).optional().describe("Filtrar por sexo: M (masculino) ou F (feminino)"),
  localidade: z
    .string()
    .optional()
    .describe(
      "Código IBGE da localidade (UF ou município). Ex: 33 para RJ, 3550308 para São Paulo capital"
    ),
});

// Schema for ranking search
export const nomesRankingSchema = z.object({
  decada: z
    .number()
    .optional()
    .describe(
      "Década para o ranking (ex: 1990, 2000, 2010). Se não informado, retorna ranking geral."
    ),
  sexo: z.enum(["M", "F"]).optional().describe("Filtrar por sexo: M (masculino) ou F (feminino)"),
  localidade: z.string().optional().describe("Código IBGE da localidade (UF ou município)"),
  limite: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe("Número de nomes no ranking (padrão: 20, máximo: 100)"),
});

export type NomesFrequenciaInput = z.infer<typeof nomesFrequenciaSchema>;
export type NomesRankingInput = z.infer<typeof nomesRankingSchema>;

/**
 * Fetches name frequency from IBGE API
 */
export async function ibgeNomesFrequencia(input: NomesFrequenciaInput): Promise<string> {
  return withMetrics("ibge_nomes_frequencia", "nomes", async () => {
    try {
      // Build URL with names
      const nomes = input.nomes.replace(/\s+/g, "").toUpperCase();
      const queryString = buildQueryString({
        sexo: input.sexo,
        localidade: input.localidade,
      });

      const url = queryString
        ? `${IBGE_API.NOMES}/${encodeURIComponent(nomes)}?${queryString}`
        : `${IBGE_API.NOMES}/${encodeURIComponent(nomes)}`;

      // Use cache for name frequency data (1 hour TTL)
      const key = cacheKey(url);
      let data: NomeFrequencia[];

      try {
        data = await cachedFetch<NomeFrequencia[]>(url, key, CACHE_TTL.MEDIUM);
      } catch (error) {
        if (error instanceof Error && error.message.includes("404")) {
          return `Nenhum dado encontrado para o(s) nome(s): ${input.nomes}`;
        }
        throw error;
      }

      if (!data || data.length === 0) {
        return `Nenhum dado encontrado para o(s) nome(s): ${input.nomes}`;
      }

      return formatFrequenciaResponse(data);
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(error, "ibge_nomes_frequencia", { nomes: input.nomes });
      }
      return ValidationErrors.emptyResult("ibge_nomes_frequencia");
    }
  });
}

/**
 * Fetches name ranking from IBGE API
 */
export async function ibgeNomesRanking(input: NomesRankingInput): Promise<string> {
  return withMetrics("ibge_nomes_ranking", "nomes", async () => {
    try {
      const queryString = buildQueryString({
        decada: input.decada,
        sexo: input.sexo,
        localidade: input.localidade,
      });

      const url = queryString
        ? `${IBGE_API.NOMES}/ranking?${queryString}`
        : `${IBGE_API.NOMES}/ranking`;

      // Use cache for name ranking data (1 hour TTL)
      const key = cacheKey(url);
      const data = await cachedFetch<NomeRanking[]>(url, key, CACHE_TTL.MEDIUM);

      if (!data || data.length === 0) {
        return "Nenhum dado encontrado para o ranking.";
      }

      return formatRankingResponse(data, input);
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(error, "ibge_nomes_ranking", { decada: input.decada });
      }
      return ValidationErrors.emptyResult("ibge_nomes_ranking");
    }
  });
}

function formatFrequenciaResponse(data: NomeFrequencia[]): string {
  let output = `## Frequência de Nomes no Brasil\n\n`;

  for (const nome of data) {
    output += `### ${nome.nome}\n\n`;

    if (nome.sexo) {
      output += `**Sexo:** ${nome.sexo === "M" ? "Masculino" : "Feminino"}\n`;
    }
    if (nome.localidade && nome.localidade !== "BR") {
      output += `**Localidade:** ${nome.localidade}\n`;
    }

    let total = 0;
    const rows = nome.res.map((periodo) => {
      total += periodo.frequencia;
      return [periodo.periodo, formatNumber(periodo.frequencia)];
    });
    rows.push(["**Total**", `**${formatNumber(total)}**`]);

    output +=
      "\n" +
      createMarkdownTable(["Período", "Frequência"], rows, {
        alignment: ["left", "right"],
      }) +
      "\n";
  }

  output += "\n**Fonte:** IBGE - Censo Demográfico\n";
  output += "_Nota: Os dados são baseados nos registros de nascimentos dos Censos Demográficos._\n";

  return output;
}

function formatRankingResponse(data: NomeRanking[], input: NomesRankingInput): string {
  const ranking = data[0];

  let output = `## Ranking de Nomes mais Frequentes\n\n`;

  if (input.decada) {
    output += `**Década:** ${input.decada}\n`;
  } else {
    output += `**Período:** Todas as décadas\n`;
  }

  if (input.sexo) {
    output += `**Sexo:** ${input.sexo === "M" ? "Masculino" : "Feminino"}\n`;
  }

  if (ranking.localidade && ranking.localidade !== "BR") {
    output += `**Localidade:** ${ranking.localidade}\n`;
  }

  const limit = input.limite || 20;
  const items = ranking.res.slice(0, limit);

  const rows = items.map((item) => [`${item.ranking}º`, item.nome, formatNumber(item.frequencia)]);

  output +=
    "\n" +
    createMarkdownTable(["Posição", "Nome", "Frequência"], rows, {
      alignment: ["right", "left", "right"],
    });

  output += "\n**Fonte:** IBGE - Censo Demográfico\n";

  return output;
}

// Combined schema for the main tool
export const nomesSchema = z.object({
  tipo: z
    .enum(["frequencia", "ranking"])
    .describe(
      "Tipo de consulta: 'frequencia' para buscar nomes específicos ou 'ranking' para ver os mais populares"
    ),
  nomes: z
    .string()
    .optional()
    .describe("Para tipo='frequencia': Nome ou nomes separados por vírgula"),
  decada: z
    .number()
    .optional()
    .describe("Para tipo='ranking': Década do ranking (ex: 1990, 2000, 2010)"),
  sexo: z.enum(["M", "F"]).optional().describe("Filtrar por sexo: M (masculino) ou F (feminino)"),
  localidade: z
    .string()
    .optional()
    .describe("Código IBGE da localidade (UF: 2 dígitos, Município: 7 dígitos)"),
  limite: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe("Para tipo='ranking': Número de nomes (padrão: 20)"),
});

export type NomesInput = z.infer<typeof nomesSchema>;

/**
 * Main handler that routes to frequency or ranking
 */
export async function ibgeNomes(input: NomesInput): Promise<string> {
  if (input.tipo === "frequencia") {
    if (!input.nomes) {
      return "Para consultar a frequência, informe o(s) nome(s) no parâmetro 'nomes'.";
    }
    return ibgeNomesFrequencia({
      nomes: input.nomes,
      sexo: input.sexo,
      localidade: input.localidade,
    });
  } else {
    return ibgeNomesRanking({
      decada: input.decada,
      sexo: input.sexo,
      localidade: input.localidade,
      limite: input.limite,
    });
  }
}

// Tool definition for MCP
export const nomesTool = {
  name: "ibge_nomes",
  description: `Consulta frequência e ranking de nomes no Brasil (IBGE).

Funcionalidades:
1. **Frequência de nomes** (tipo='frequencia'):
   - Busca a frequência de nascimentos por década
   - Aceita múltiplos nomes separados por vírgula
   - Filtra por sexo e localidade

2. **Ranking de nomes** (tipo='ranking'):
   - Lista os nomes mais populares
   - Filtra por década, sexo e localidade

Décadas disponíveis: 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010

Exemplos de uso:
- Frequência de "Maria": tipo="frequencia", nomes="Maria"
- Comparar nomes: tipo="frequencia", nomes="João,José,Pedro"
- Ranking anos 2000: tipo="ranking", decada=2000
- Nomes femininos mais populares: tipo="ranking", sexo="F"
- Nomes populares em SP: tipo="ranking", localidade="35"`,
  inputSchema: nomesSchema,
  handler: ibgeNomes,
};
