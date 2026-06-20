import { z } from "zod";
import { IBGE_API, type Municipio, type MunicipioSimples } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import { normalizeUf, formatValidationError } from "../validation.js";
import type { StructuredToolResult } from "../structured.js";

// Schema for the tool input
export const municipiosSchema = z.object({
  uf: z
    .string()
    .optional()
    .describe(
      "Estado por sigla (SP), nome (São Paulo) ou código IBGE (35). Se não informado, retorna todos os municípios do Brasil."
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

/** Structured output payload (validated against this schema by the MCP SDK). */
export const municipiosOutputSchema = z.object({
  municipios: z
    .array(
      z.object({
        id: z.number().describe("Código IBGE do município"),
        nome: z.string().describe("Nome do município"),
      })
    )
    .describe("Lista de municípios retornados (após filtro e limite)"),
  total: z.number().describe("Total de municípios encontrados antes do limite"),
  uf: z.string().optional().describe("UF informada no filtro (como recebida na entrada)"),
  busca: z.string().optional().describe("Termo de busca aplicado ao nome do município"),
});

/**
 * Fetches municipalities from IBGE API
 */
export async function ibgeMunicipios(input: MunicipiosInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_municipios", "localidades", async () => {
    try {
      let url: string;

      if (input.uf) {
        const ufCode = normalizeUf(input.uf);

        if (!ufCode) {
          return {
            markdown: formatValidationError(
              "uf",
              input.uf,
              "Estado por sigla (SP), nome (São Paulo) ou código IBGE (35)"
            ),
            isError: true,
          };
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
        return {
          markdown: input.busca
            ? `Nenhum município encontrado com o termo "${input.busca}"${input.uf ? ` em ${input.uf.toUpperCase()}` : ""}.`
            : "Nenhum município encontrado.",
          isError: true,
        };
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

      const structured: Record<string, unknown> = {
        municipios: municipios.map((m) => ({ id: m.id, nome: m.nome })),
        total,
      };
      if (input.uf) {
        structured.uf = input.uf;
      }
      if (input.busca) {
        structured.busca = input.busca;
      }

      return { markdown: output, structured };
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: parseHttpError(error, "ibge_municipios", { uf: input.uf, busca: input.busca }, [
            "ibge_geocodigo",
            "ibge_localidade",
          ]),
          isError: true,
        };
      }
      return { markdown: ValidationErrors.emptyResult("ibge_municipios"), isError: true };
    }
  });
}
