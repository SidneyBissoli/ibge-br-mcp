import { z } from "zod";
import { IBGE_API, type UF } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import type { StructuredToolResult } from "../structured.js";

// Schema for the tool input
export const estadosSchema = z.object({
  regiao: z
    .enum(["N", "NE", "SE", "S", "CO"])
    .optional()
    .describe(
      "Filtrar por região: N (Norte), NE (Nordeste), SE (Sudeste), S (Sul), CO (Centro-Oeste)"
    ),
  ordenar: z
    .enum(["id", "nome", "sigla"])
    .optional()
    .default("nome")
    .describe("Campo para ordenação dos resultados"),
});

export type EstadosInput = z.infer<typeof estadosSchema>;

/** Structured output payload (validated against this schema by the MCP SDK). */
export const estadosOutputSchema = z.object({
  estados: z
    .array(
      z.object({
        id: z.number().describe("Código IBGE do estado"),
        sigla: z.string().describe("Sigla da UF"),
        nome: z.string().describe("Nome do estado"),
        regiao: z.string().describe("Nome da região"),
      })
    )
    .describe("Lista de estados"),
  total: z.number().describe("Total de estados retornados"),
});

// Map region codes to IDs
const REGIAO_IDS: Record<string, number> = {
  N: 1, // Norte
  NE: 2, // Nordeste
  SE: 3, // Sudeste
  S: 4, // Sul
  CO: 5, // Centro-Oeste
};

/**
 * Fetches all Brazilian states from IBGE API
 */
export async function ibgeEstados(input: EstadosInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_estados", "localidades", async () => {
    try {
      let url = `${IBGE_API.LOCALIDADES}/estados`;

      // If filtering by region
      if (input.regiao) {
        const regiaoId = REGIAO_IDS[input.regiao];
        url = `${IBGE_API.LOCALIDADES}/regioes/${regiaoId}/estados`;
      }

      // Add ordering parameter
      if (input.ordenar) {
        url += `?orderBy=${input.ordenar}`;
      }

      // Use cache for static state data (24 hours TTL)
      const key = cacheKey(url);
      const estados = await cachedFetch<UF[]>(url, key, CACHE_TTL.STATIC);

      if (estados.length === 0) {
        return { markdown: "Nenhum estado encontrado.", structured: { estados: [], total: 0 } };
      }

      // Format the response
      const resultado = estados.map((estado) => ({
        id: estado.id,
        sigla: estado.sigla,
        nome: estado.nome,
        regiao: estado.regiao.nome,
      }));

      // Create a formatted table using createMarkdownTable
      let output = `## Estados Brasileiros${input.regiao ? ` - Região ${getRegiaoNome(input.regiao)}` : ""}\n\n`;
      output += `Total: ${estados.length} estados\n\n`;

      const headers = ["ID", "Sigla", "Nome", "Região"];
      const rows = resultado.map((e) => [e.id, e.sigla, e.nome, e.regiao]);

      output += createMarkdownTable(headers, rows, {
        alignment: ["right", "center", "left", "left"],
      });

      return { markdown: output, structured: { estados: resultado, total: estados.length } };
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: parseHttpError(error, "ibge_estados", { regiao: input.regiao }, [
            "ibge_municipios",
            "ibge_localidade",
          ]),
          isError: true,
        };
      }
      return { markdown: ValidationErrors.emptyResult("ibge_estados"), isError: true };
    }
  });
}

function getRegiaoNome(sigla: string): string {
  const nomes: Record<string, string> = {
    N: "Norte",
    NE: "Nordeste",
    SE: "Sudeste",
    S: "Sul",
    CO: "Centro-Oeste",
  };
  return nomes[sigla] || sigla;
}
