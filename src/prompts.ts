/**
 * Ready-made analysis templates exposed as MCP prompts (roadmap 1.6).
 *
 * Each prompt expands into a user message that steers the model through a
 * real analysis using this server's tools — comparing municipalities or
 * building a demographic profile — so users don't have to remember which tools
 * to chain.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Wraps prompt text into the single-user-message result the SDK expects. */
function userMessage(text: string) {
  return {
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text },
      },
    ],
  };
}

/** Registers all analysis-template prompts on the server. */
export function registerPrompts(server: McpServer): void {
  // Compare municipalities/states on an indicator.
  server.registerPrompt(
    "comparar-municipios",
    {
      title: "Comparar municípios",
      description:
        "Compara 2 a 10 localidades (municípios ou UFs) em um indicador e produz um ranking comentado.",
      argsSchema: {
        localidades: z
          .string()
          .describe(
            "Localidades separadas por vírgula — códigos IBGE ou nomes (ex.: 'São Paulo, Rio de Janeiro, Belo Horizonte')"
          ),
        indicador: z
          .string()
          .optional()
          .describe(
            "Indicador a comparar (ex.: populacao, pib, densidade, alfabetizacao). Padrão: populacao"
          ),
      },
    },
    ({ localidades, indicador }) => {
      const ind = indicador?.trim() || "populacao";
      return userMessage(
        `Compare as seguintes localidades pelo indicador "${ind}": ${localidades}.

Passos:
1. Se as localidades vierem por nome, resolva cada uma para o código IBGE com ibge_geocodigo (ou ibge_municipios).
2. Use a tool ibge_comparar com localidades="<códigos separados por vírgula>" e indicador="${ind}".
3. Apresente um ranking (maior para menor), destaque máximo, mínimo, média e a variação entre os extremos.
4. Comente brevemente o que o resultado sugere, sem extrapolar além dos dados retornados.`
      );
    }
  );

  // Build a demographic profile of one locality.
  server.registerPrompt(
    "perfil-demografico",
    {
      title: "Perfil demográfico",
      description:
        "Monta um perfil demográfico de uma localidade combinando população, censo e indicadores socioeconômicos.",
      argsSchema: {
        localidade: z
          .string()
          .describe("Município ou UF — código IBGE ou nome (ex.: '3550308' ou 'São Paulo')"),
      },
    },
    ({ localidade }) =>
      userMessage(
        `Monte um perfil demográfico da localidade: ${localidade}.

Passos:
1. Se vier por nome, resolva o código IBGE com ibge_geocodigo.
2. Para um município, use ibge_cidades (tipo="panorama") para população, área, densidade, PIB per capita, IDH e escolarização.
3. Complemente com o censo mais recente via ibge_censo (tema="populacao" e, se útil, "idade_sexo", "cor_raca", "alfabetizacao").
4. Para indicadores de saúde (mortalidade infantil, esperança de vida), use datasaude.
5. Sintetize em um perfil curto e estruturado (tabela + 1 parágrafo), citando o ano de cada dado e usando apenas valores retornados pelas tools.`
      )
  );
}
