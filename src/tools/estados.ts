import { z } from "zod";
import { IBGE_API, type UF } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";

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
export async function ibgeEstados(input: EstadosInput): Promise<string> {
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
        return "Nenhum estado encontrado.";
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

      return output;
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(error, "ibge_estados", { regiao: input.regiao });
      }
      return ValidationErrors.emptyResult("ibge_estados");
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

// Tool definition for MCP
export const estadosTool = {
  name: "ibge_estados",
  description: `Lista todos os estados brasileiros do IBGE.

Funcionalidades:
- Lista todos os 27 estados (26 estados + DF)
- Filtra por região (Norte, Nordeste, Sudeste, Sul, Centro-Oeste)
- Ordena por ID, nome ou sigla

Exemplo de uso:
- Listar todos os estados
- Listar estados do Nordeste
- Listar estados ordenados por sigla`,
  inputSchema: estadosSchema,
  handler: ibgeEstados,
};
