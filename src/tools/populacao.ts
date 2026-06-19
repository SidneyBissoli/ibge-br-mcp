import { z } from "zod";
import { IBGE_API, type PopulacaoEstimativa } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, formatNumber } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import { fetchWithRetry } from "../retry.js";
import type { StructuredToolResult } from "../structured.js";

// Schema for the tool input
export const populacaoSchema = z.object({
  localidade: z
    .enum(["BR"])
    .optional()
    .default("BR")
    .describe("Localidade para projeção populacional (atualmente apenas BR disponível)"),
});

export type PopulacaoInput = z.infer<typeof populacaoSchema>;

/** Structured output payload (validated against this schema by the MCP SDK). */
export const populacaoOutputSchema = z.object({
  localidade: z.string().describe("Localidade da projeção"),
  horario: z.string().describe("Data/hora da consulta"),
  populacao: z.number().describe("População projetada (habitantes)"),
  periodoMedio: z
    .object({
      incrementoPopulacional: z.number().describe("Incremento populacional por dia"),
      nascimento: z.number().describe("Segundos entre nascimentos"),
      obito: z.number().describe("Segundos entre óbitos"),
    })
    .describe("Indicadores do período médio"),
});

/**
 * Fetches population projection/estimate from IBGE API
 */
export async function ibgePopulacao(input: PopulacaoInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_populacao", "populacao", async () => {
    try {
      const url = `${IBGE_API.POPULACAO}/${input.localidade}`;

      // Use cache with short TTL (population updates frequently)
      const key = cacheKey(url);
      const data = await cachedFetch<PopulacaoEstimativa>(url, key, CACHE_TTL.SHORT);

      // Format the response
      let output = `## Projeção da População do Brasil\n\n`;
      output += `**Data/Hora da consulta:** ${data.horario}\n\n`;

      output += "### População Atual\n\n";
      output += `**${formatNumber(data.projecao.populacao)}** habitantes\n\n`;

      output += "### Indicadores (Período Médio)\n\n";
      output += createMarkdownTable(
        ["Indicador", "Valor"],
        [
          [
            "Incremento populacional",
            `${formatNumber(data.projecao.periodoMedio.incrementoPopulacional)} por dia`,
          ],
          ["Nascimentos", `1 a cada ${formatSeconds(data.projecao.periodoMedio.nascimento)}`],
          ["Óbitos", `1 a cada ${formatSeconds(data.projecao.periodoMedio.obito)}`],
        ],
        { alignment: ["left", "right"] }
      );

      output += "\n### Notas\n\n";
      output += "- Os dados são projeções em tempo real baseadas em modelos estatísticos do IBGE\n";
      output += "- O incremento populacional considera nascimentos menos óbitos\n";
      output += "- Fonte: IBGE - Projeção da População\n";

      return {
        markdown: output,
        structured: {
          localidade: input.localidade,
          horario: data.horario,
          populacao: data.projecao.populacao,
          periodoMedio: {
            incrementoPopulacional: data.projecao.periodoMedio.incrementoPopulacional,
            nascimento: data.projecao.periodoMedio.nascimento,
            obito: data.projecao.periodoMedio.obito,
          },
        },
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: parseHttpError(error, "ibge_populacao", { localidade: input.localidade }),
          isError: true,
        };
      }
      return { markdown: ValidationErrors.emptyResult("ibge_populacao"), isError: true };
    }
  });
}

/**
 * Additional function to get population from SIDRA tables
 * This provides historical and municipal data
 */
export async function ibgePopulacaoSidra(
  tabela: string,
  localidade: string,
  periodo: string
): Promise<string> {
  try {
    // SIDRA table 6579 = population estimates
    // SIDRA table 9514 = 2022 census population
    const url = `${IBGE_API.SIDRA}/t/${tabela}/n${localidade}/p/${periodo}/v/all`;

    const response = await fetchWithRetry(url);

    if (!response.ok) {
      throw new Error(`Erro na API SIDRA: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return JSON.stringify(data, null, 2);
  } catch (error) {
    if (error instanceof Error) {
      return parseHttpError(error, "ibge_populacao_sidra", { tabela, localidade, periodo });
    }
    return ValidationErrors.emptyResult("ibge_populacao_sidra");
  }
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)} segundos`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes} min ${remainingSeconds} seg` : `${minutes} minutos`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}min`;
}

