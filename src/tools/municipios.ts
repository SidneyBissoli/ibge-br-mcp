import { z } from "zod";
import { IBGE_API, type Municipio, type MunicipioSimples } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import { normalizeUf, formatValidationError } from "../validation.js";

// Schema for the tool input
export const municipiosSchema = z.object({
  uf: z
    .string()
    .length(2)
    .optional()
    .describe(
      "Sigla do estado (ex: SP, RJ, MG). Se não informado, retorna todos os municípios do Brasil."
    ),
  busca: z.string().optional().describe("Termo para buscar no nome do município"),
  limite: z
    .number()
    .min(1)
    .max(5570)
    .optional()
    .default(100)
    .describe("Número máximo de resultados (padrão: 100, máximo: 5570)"),
});

export type MunicipiosInput = z.infer<typeof municipiosSchema>;

/**
 * Fetches municipalities from IBGE API
 */
export async function ibgeMunicipios(input: MunicipiosInput): Promise<string> {
  return withMetrics("ibge_municipios", "localidades", async () => {
    try {
      let url: string;

      if (input.uf) {
        const ufCode = normalizeUf(input.uf);

        if (!ufCode) {
          return formatValidationError(
            "uf",
            input.uf,
            "Sigla de UF válida (ex: SP, RJ, MG) ou código numérico (ex: 35, 33)"
          );
        }

        url = `${IBGE_API.LOCALIDADES}/estados/${ufCode}/municipios`;
      } else {
        url = `${IBGE_API.LOCALIDADES}/municipios`;
      }

      url += "?orderBy=nome";

      // Use cache for static municipality data (24 hours TTL)
      const key = cacheKey(url);
      let municipios = await cachedFetch<(Municipio | MunicipioSimples)[]>(
        url,
        key,
        CACHE_TTL.STATIC
      );

      // Filter by search term if provided
      if (input.busca) {
        const busca = input.busca
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        municipios = municipios.filter((m) => {
          const nome = m.nome
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
          return nome.includes(busca);
        });
      }

      const total = municipios.length;

      // Apply limit
      if (input.limite && input.limite < municipios.length) {
        municipios = municipios.slice(0, input.limite);
      }

      if (municipios.length === 0) {
        return input.busca
          ? `Nenhum município encontrado com o termo "${input.busca}"${input.uf ? ` em ${input.uf.toUpperCase()}` : ""}.`
          : "Nenhum município encontrado.";
      }

      // Format the response using createMarkdownTable
      let output = `## Municípios${input.uf ? ` - ${input.uf.toUpperCase()}` : " do Brasil"}\n\n`;

      if (input.busca) {
        output += `Busca: "${input.busca}"\n`;
      }

      output += `Mostrando: ${municipios.length} de ${total} municípios\n\n`;

      const headers = ["Código IBGE", "Nome"];
      const rows = municipios.map((m) => [m.id, m.nome]);

      output += createMarkdownTable(headers, rows, {
        alignment: ["right", "left"],
      });

      if (municipios.length < total) {
        output += `\n_Resultados limitados a ${input.limite}. Use o parâmetro 'limite' para ver mais._\n`;
      }

      return output;
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(error, "ibge_municipios", { uf: input.uf, busca: input.busca });
      }
      return ValidationErrors.emptyResult("ibge_municipios");
    }
  });
}

// Tool definition for MCP
export const municipiosTool = {
  name: "ibge_municipios",
  description: `Lista municípios brasileiros do IBGE.

Funcionalidades:
- Lista municípios de um estado específico (usando a sigla da UF)
- Lista todos os municípios do Brasil (5.570 municípios)
- Busca por nome do município
- Retorna código IBGE de 7 dígitos

Exemplo de uso:
- Listar municípios de São Paulo: uf="SP"
- Buscar município por nome: busca="Campinas"
- Listar municípios de MG que contenham "Belo": uf="MG", busca="Belo"`,
  inputSchema: municipiosSchema,
  handler: ibgeMunicipios,
};
