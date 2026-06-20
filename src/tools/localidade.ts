import { z } from "zod";
import { IBGE_API, type Municipio, type UF, type Distrito } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createKeyValueTable } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import { isValidIbgeCode, formatValidationError } from "../validation.js";
import type { StructuredToolResult } from "../structured.js";

// Schema for the tool input
export const localidadeSchema = z.object({
  codigo: z
    .number()
    .describe(
      "Código IBGE da localidade (estado: 2 dígitos, município: 7 dígitos, distrito: 9 dígitos)"
    ),
  tipo: z
    .enum(["estado", "municipio", "distrito"])
    .optional()
    .describe("Tipo da localidade. Se não informado, será inferido pelo tamanho do código."),
});

export type LocalidadeInput = z.infer<typeof localidadeSchema>;

/** Structured output payload (validated against this schema by the MCP SDK). */
export const localidadeOutputSchema = z.object({
  tipo: z
    .enum(["estado", "municipio", "distrito"])
    .describe("Tipo da localidade retornada"),
  id: z.number().describe("Código IBGE da localidade"),
  nome: z.string().describe("Nome da localidade"),
  sigla: z.string().optional().describe("Sigla da UF (apenas para estados)"),
  regiao: z
    .object({
      id: z.number().describe("Código IBGE da região"),
      sigla: z.string().describe("Sigla da região"),
      nome: z.string().describe("Nome da região"),
    })
    .optional()
    .describe("Região do estado (apenas para estados)"),
  mesorregiao: z
    .object({
      id: z.number().describe("Código IBGE da mesorregião"),
      nome: z.string().describe("Nome da mesorregião"),
    })
    .optional()
    .describe("Mesorregião do município"),
  microrregiao: z
    .object({
      id: z.number().describe("Código IBGE da microrregião"),
      nome: z.string().describe("Nome da microrregião"),
    })
    .optional()
    .describe("Microrregião do município"),
  regiaoImediata: z
    .object({
      id: z.number().describe("Código IBGE da região imediata"),
      nome: z.string().describe("Nome da região imediata"),
    })
    .optional()
    .describe("Região imediata do município"),
  regiaoIntermediaria: z
    .object({
      id: z.number().describe("Código IBGE da região intermediária"),
      nome: z.string().describe("Nome da região intermediária"),
    })
    .optional()
    .describe("Região intermediária do município"),
  municipio: z
    .object({
      id: z.number().describe("Código IBGE do município"),
      nome: z.string().describe("Nome do município"),
    })
    .optional()
    .describe("Município ao qual o distrito pertence (apenas para distritos)"),
  estado: z
    .object({
      id: z.number().describe("Código IBGE do estado"),
      sigla: z.string().describe("Sigla da UF"),
      nome: z.string().describe("Nome do estado"),
    })
    .optional()
    .describe("Estado da localidade (município ou distrito)"),
});

/**
 * Fetches details of a specific location from IBGE API
 */
export async function ibgeLocalidade(input: LocalidadeInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_localidade", "localidades", async () => {
    try {
      const codigoStr = input.codigo.toString();

      // Validate IBGE code format
      if (!isValidIbgeCode(codigoStr)) {
        return {
          markdown: formatValidationError(
            "codigo",
            codigoStr,
            "Código IBGE válido: 2 dígitos (UF), 7 dígitos (município) ou 9 dígitos (distrito)"
          ),
          isError: true,
        };
      }

      let tipo = input.tipo;

      // Infer type from code length if not provided
      if (!tipo) {
        if (codigoStr.length <= 2) {
          tipo = "estado";
        } else if (codigoStr.length <= 7) {
          tipo = "municipio";
        } else {
          tipo = "distrito";
        }
      }

      let url: string;
      switch (tipo) {
        case "estado":
          url = `${IBGE_API.LOCALIDADES}/estados/${input.codigo}`;
          break;
        case "municipio":
          url = `${IBGE_API.LOCALIDADES}/municipios/${input.codigo}`;
          break;
        case "distrito":
          url = `${IBGE_API.LOCALIDADES}/distritos/${input.codigo}`;
          break;
        default:
          return { markdown: "Tipo de localidade inválido.", isError: true };
      }

      // Use cache for static location data (24 hours TTL)
      const key = cacheKey(url);
      let data: unknown;

      try {
        data = await cachedFetch<unknown>(url, key, CACHE_TTL.STATIC);
      } catch (error) {
        if (error instanceof Error && error.message.includes("404")) {
          return {
            markdown: ValidationErrors.notFound(
              `Localidade com código ${input.codigo}`,
              "ibge_localidade",
              "ibge_municipios ou ibge_estados"
            ),
            isError: true,
          };
        }
        throw error;
      }

      // Check if empty response
      if (!data || (Array.isArray(data) && data.length === 0)) {
        return {
          markdown: ValidationErrors.notFound(
            `Localidade com código ${input.codigo}`,
            "ibge_localidade",
            "ibge_municipios ou ibge_estados"
          ),
          isError: true,
        };
      }

      // Handle array response (some endpoints return arrays)
      const localidade = Array.isArray(data) ? data[0] : data;

      if (!localidade) {
        return {
          markdown: ValidationErrors.notFound(
            `Localidade com código ${input.codigo}`,
            "ibge_localidade",
            "ibge_municipios ou ibge_estados"
          ),
          isError: true,
        };
      }

      // Format response based on type
      switch (tipo) {
        case "estado":
          return formatEstado(localidade as UF);
        case "municipio":
          return formatMunicipio(localidade as Municipio);
        case "distrito":
          return formatDistrito(localidade as Distrito);
        default:
          return { markdown: "Tipo de localidade não suportado.", isError: true };
      }
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: parseHttpError(error, "ibge_localidade", { codigo: input.codigo }, [
            "ibge_municipios",
            "ibge_estados",
          ]),
          isError: true,
        };
      }
      return { markdown: ValidationErrors.emptyResult("ibge_localidade"), isError: true };
    }
  });
}

function formatEstado(estado: UF): StructuredToolResult {
  let output = `## Estado: ${estado.nome}\n\n`;

  output += createKeyValueTable({
    "**Código IBGE**": estado.id,
    "**Sigla**": estado.sigla,
    "**Nome**": estado.nome,
    "**Região**": `${estado.regiao.nome} (${estado.regiao.sigla})`,
  });

  return {
    markdown: output,
    structured: {
      tipo: "estado",
      id: estado.id,
      nome: estado.nome,
      sigla: estado.sigla,
      regiao: {
        id: estado.regiao.id,
        sigla: estado.regiao.sigla,
        nome: estado.regiao.nome,
      },
    },
  };
}

function formatMunicipio(municipio: Municipio): StructuredToolResult {
  let output = `## Município: ${municipio.nome}\n\n`;

  const data: Record<string, string | number | undefined> = {
    "**Código IBGE**": municipio.id,
    "**Nome**": municipio.nome,
  };

  const structured: Record<string, unknown> = {
    tipo: "municipio",
    id: municipio.id,
    nome: municipio.nome,
  };

  if (municipio.microrregiao) {
    data["**Microrregião**"] = municipio.microrregiao.nome;
    structured.microrregiao = {
      id: municipio.microrregiao.id,
      nome: municipio.microrregiao.nome,
    };

    if (municipio.microrregiao.mesorregiao) {
      data["**Mesorregião**"] = municipio.microrregiao.mesorregiao.nome;
      structured.mesorregiao = {
        id: municipio.microrregiao.mesorregiao.id,
        nome: municipio.microrregiao.mesorregiao.nome,
      };

      if (municipio.microrregiao.mesorregiao.UF) {
        const uf = municipio.microrregiao.mesorregiao.UF;
        data["**Estado**"] = `${uf.nome} (${uf.sigla})`;
        data["**Região**"] = uf.regiao.nome;
        structured.estado = { id: uf.id, sigla: uf.sigla, nome: uf.nome };
        structured.regiao = { id: uf.regiao.id, sigla: uf.regiao.sigla, nome: uf.regiao.nome };
      }
    }
  }

  if (municipio["regiao-imediata"]) {
    data["**Região Imediata**"] = municipio["regiao-imediata"].nome;
    structured.regiaoImediata = {
      id: municipio["regiao-imediata"].id,
      nome: municipio["regiao-imediata"].nome,
    };

    if (municipio["regiao-imediata"]["regiao-intermediaria"]) {
      data["**Região Intermediária**"] = municipio["regiao-imediata"]["regiao-intermediaria"].nome;
      structured.regiaoIntermediaria = {
        id: municipio["regiao-imediata"]["regiao-intermediaria"].id,
        nome: municipio["regiao-imediata"]["regiao-intermediaria"].nome,
      };
    }
  }

  output += createKeyValueTable(data);

  return { markdown: output, structured };
}

function formatDistrito(distrito: Distrito): StructuredToolResult {
  let output = `## Distrito: ${distrito.nome}\n\n`;

  const data: Record<string, string | number | undefined> = {
    "**Código IBGE**": distrito.id,
    "**Nome**": distrito.nome,
  };

  const structured: Record<string, unknown> = {
    tipo: "distrito",
    id: distrito.id,
    nome: distrito.nome,
  };

  if (distrito.municipio) {
    data["**Município**"] = distrito.municipio.nome;
    structured.municipio = { id: distrito.municipio.id, nome: distrito.municipio.nome };

    if (distrito.municipio.microrregiao?.mesorregiao?.UF) {
      const uf = distrito.municipio.microrregiao.mesorregiao.UF;
      data["**Estado**"] = `${uf.nome} (${uf.sigla})`;
      structured.estado = { id: uf.id, sigla: uf.sigla, nome: uf.nome };
    }
  }

  output += createKeyValueTable(data);

  return { markdown: output, structured };
}
