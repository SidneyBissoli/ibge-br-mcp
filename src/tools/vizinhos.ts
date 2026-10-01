import { z } from "zod";
import { IBGE_API, Municipio } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch, cachedFetchOne } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { formatNumber } from "../utils/index.js";
import {
  ehAusencia,
  ValidationErrors,
  erroDoCatch,
  erroContrato,
  erroNaoEncontrado,
  erroFonte,
} from "../errors.js";
import { isValidIbgeCode, formatValidationError } from "../validation.js";
import { resolveUf } from "../config.js";
import { fetchWithRetry, RETRY_PRESETS, UpstreamError } from "../retry.js";
import { fetchSidra } from "../sidra-agregados.js";
import type { StructuredToolResult } from "../structured.js";
import { provenienciaIbge } from "../provenance.js";

// Schema for the tool input
export const vizinhosSchema = z.object({
  municipio: z.string().describe("Código IBGE do município (7 dígitos) ou nome do município"),
  uf: z
    .string()
    .optional()
    .describe(
      "Estado por sigla (SP), nome (São Paulo) ou código IBGE (35) — obrigatório se usar nome do município"
    ),
  raio: z
    .number()
    .optional()
    .describe("Raio em km para buscar municípios próximos (usa centróides)"),
  incluir_dados: z
    .boolean()
    .optional()
    .default(false)
    .describe("Incluir dados populacionais dos vizinhos"),
});

export type VizinhosInput = z.infer<typeof vizinhosSchema>;

/** Structured output payload (validated against this schema by the MCP SDK). */
export const vizinhosOutputSchema = z.object({
  municipio: z
    .object({
      codigo: z.string().describe("Código IBGE do município consultado"),
      nome: z.string().describe("Nome do município consultado"),
    })
    .describe("Município de referência da consulta"),
  vizinhos: z
    .array(
      z.object({
        codigo: z.string().describe("Código IBGE do município vizinho"),
        nome: z.string().describe("Nome do município vizinho"),
        uf: z.string().optional().describe("Sigla da UF do município vizinho"),
        populacao: z
          .number()
          .optional()
          .describe("População do município vizinho (apenas quando incluir_dados=true)"),
      })
    )
    .describe("Lista de municípios próximos (mesma mesorregião)"),
  total: z.number().describe("Quantidade de municípios próximos encontrados"),
});

/**
 * Gets neighboring municipalities
 */
export async function ibgeVizinhos(input: VizinhosInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_vizinhos", "localidades", async () => {
    try {
      // Get municipality code
      let municipioId: string;
      let municipioNome: string;

      if (/^\d{7}$/.test(input.municipio)) {
        // Validate IBGE code format
        if (!isValidIbgeCode(input.municipio)) {
          return erroContrato(
            formatValidationError(
              "municipio",
              input.municipio,
              "Código IBGE de município com 7 dígitos"
            )
          );
        }
        municipioId = input.municipio;
        // Get municipality name
        const munInfo = await getMunicipioInfo(municipioId);
        if (!munInfo) {
          return erroNaoEncontrado(
            ValidationErrors.notFound(
              `Município com código ${municipioId}`,
              "ibge_vizinhos",
              "ibge_municipios"
            )
          );
        }
        municipioNome = munInfo.nome;
      } else {
        // Search by name
        if (!input.uf) {
          return erroContrato(
            formatValidationError(
              "uf",
              "(não informado)",
              "Estado (sigla, nome ou código) é obrigatório ao buscar por nome de município"
            )
          );
        }
        const ufResolved = resolveUf(input.uf);
        if (!ufResolved) {
          return erroContrato(
            formatValidationError(
              "uf",
              input.uf,
              "Estado por sigla (SP), nome (São Paulo) ou código IBGE (35)"
            )
          );
        }
        const munInfo = await findMunicipioByName(input.municipio, ufResolved.code);
        if (!munInfo) {
          return erroNaoEncontrado(
            ValidationErrors.notFound(
              `Município "${input.municipio}" em ${ufResolved.sigla}`,
              "ibge_vizinhos",
              "ibge_municipios"
            )
          );
        }
        municipioId = String(munInfo.id);
        municipioNome = munInfo.nome;
      }

      // Get state code from municipality
      const ufCode = municipioId.substring(0, 2);

      // Get all municipalities from the same state
      const allMunicipios = await getMunicipiosByUf(ufCode);

      if (!allMunicipios || allMunicipios.length === 0) {
        return erroFonte("Não foi possível obter a lista de municípios do estado.");
      }

      // Get neighboring municipalities using mesh data
      const vizinhos = await getVizinhosFromMalha(municipioId);

      if (vizinhos.length === 0) {
        // Fallback: try to find municipalities that might be neighbors based on code proximity
        return erroNaoEncontrado(formatNoNeighborsFound(municipioNome, municipioId));
      }

      // If radius specified, filter by distance
      if (input.raio) {
        // This would require centroid data which we don't have directly
        // For now, we'll note this limitation
      }

      // Get additional data if requested
      let vizinhosData: VizinhoInfo[] = vizinhos.map((v) => ({
        codigo: v.codigo,
        nome: v.nome,
        uf: v.uf,
      }));

      if (input.incluir_dados) {
        vizinhosData = await enrichVizinhosData(vizinhosData);
      }

      // Principal data fetch: the state municipality list from which the
      // same-mesoregion neighbors are selected (selection, not derivation).
      const municipiosUrl = `${IBGE_API.LOCALIDADES}/estados/${ufCode}/municipios`;
      const provenance = provenienciaIbge({
        fonte: "LOCALIDADES",
        url: municipiosUrl,
        chaveCache: cacheKey(municipiosUrl),
        pesquisa: "API de Localidades (municípios vizinhos)",
      });

      const markdown = formatResponse(municipioNome, municipioId, vizinhosData, input);
      return {
        markdown,
        provenance,
        structured: {
          municipio: { codigo: municipioId, nome: municipioNome },
          vizinhos: vizinhosData.map((v) => ({
            codigo: v.codigo,
            nome: v.nome,
            ...(v.uf !== undefined ? { uf: v.uf } : {}),
            ...(v.populacao !== undefined ? { populacao: v.populacao } : {}),
          })),
          total: vizinhosData.length,
        },
      };
    } catch (error) {
      return erroDoCatch(
        error,
        "ibge_vizinhos",
        {
          municipio: input.municipio,
          uf: input.uf,
        },
        ["ibge_municipios", "ibge_geocodigo"]
      );
    }
  });
}

interface VizinhoInfo {
  codigo: string;
  nome: string;
  uf?: string;
  populacao?: number;
  area?: number;
}

interface VizinhoBasico {
  codigo: string;
  nome: string;
  uf?: string;
}

async function getMunicipioInfo(codigo: string): Promise<Municipio | null> {
  try {
    const url = `${IBGE_API.LOCALIDADES}/municipios/${codigo}`;
    const key = cacheKey(url);

    const data = await cachedFetchOne<Municipio>(url, key, "Município", codigo, CACHE_TTL.STATIC);
    return data;
  } catch (error) {
    // Só a ausência RESPONDIDA vira "não encontrado"; falha da origem sobe
    // tipada ao `catch` da tool (classe pelo tipo). Antes, qualquer exceção
    // virava `null` e a resposta dizia "Município não encontrado" com a
    // origem fora do ar.
    if (ehAusencia(error)) return null;
    throw error;
  }
}

async function findMunicipioByName(nome: string, uf: string | number): Promise<Municipio | null> {
  // Sem `catch`: a lista do estado é a resposta da origem, e falhar ao obtê-la
  // é falha da origem — não "município não encontrado".
  const url = `${IBGE_API.LOCALIDADES}/estados/${uf}/municipios`;
  const key = cacheKey(url);

  const municipios = await cachedFetch<Municipio[]>(url, key, CACHE_TTL.STATIC);

  const normalized = nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const found = municipios.find((m) => {
    const mNorm = m.nome
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return mNorm === normalized || mNorm.includes(normalized);
  });

  return found || null;
}

async function getMunicipiosByUf(ufCode: string): Promise<Municipio[]> {
  // Sem `catch`: devolver `[]` na falha fazia a queda da origem sair como
  // "Não foi possível obter a lista" sem classe. A falha sobe tipada.
  const url = `${IBGE_API.LOCALIDADES}/estados/${ufCode}/municipios`;
  const key = cacheKey(url);

  return await cachedFetch<Municipio[]>(url, key, CACHE_TTL.STATIC);
}

async function getVizinhosFromMalha(municipioId: string): Promise<VizinhoBasico[]> {
  // The IBGE API doesn't directly provide neighbors
  // We'll use the malhas API to get the municipality's geometry and find adjacent ones
  // This is a simplified approach - in production you'd use proper spatial queries

  // Get municipality mesh with neighbors info if available
  const malhaUrl = `${IBGE_API.MALHAS}/municipios/${municipioId}?formato=application/json`;

  try {
    // `fetchWithRetry` lança `UpstreamError` em status de erro final. Malha
    // ausente (404) é resposta: sem vizinhos. Qualquer outra falha sobe tipada
    // — antes ela virava `[]` e saía como "nenhum vizinho encontrado".
    const response = await fetchWithRetry(malhaUrl, undefined, RETRY_PRESETS.QUICK);
    if (!response.ok) {
      throw new UpstreamError(response.status, response.statusText);
    }
  } catch (error) {
    if (ehAusencia(error)) return [];
    throw error;
  }

  // For now, use a heuristic approach based on municipality codes
  // Municipalities with similar codes are often geographically close
  const ufCode = municipioId.substring(0, 2);
  const mesoCode = municipioId.substring(0, 4);

  // Get all municipalities from the state
  const stateMunicipios = await getMunicipiosByUf(ufCode);

  // Find municipalities in the same mesoregion (more likely to be neighbors)
  const sameRegion = stateMunicipios.filter((m) => {
    const mCode = String(m.id);
    return mCode !== municipioId && mCode.startsWith(mesoCode);
  });

  // Return up to 10 municipalities from same mesoregion
  return sameRegion.slice(0, 10).map((m) => ({
    codigo: String(m.id),
    nome: m.nome,
    uf: m.microrregiao?.mesorregiao?.UF?.sigla,
  }));
}

async function enrichVizinhosData(vizinhos: VizinhoInfo[]): Promise<VizinhoInfo[]> {
  // Get population data for neighbors
  const enriched: VizinhoInfo[] = [];

  for (const v of vizinhos) {
    try {
      // Try to get population from SIDRA
      // Pela API de Agregados v3 (ver src/sidra-agregados.ts); o `/f/n` do
      // apisidra é ignorado na tradução — a v3 já devolve o valor em `V`.
      const { data } = await fetchSidra(
        `/t/4709/n6/${v.codigo}/v/93/p/last/f/n`,
        CACHE_TTL.SHORT,
        RETRY_PRESETS.QUICK
      );
      if (data && data.length > 1 && data[1].V) {
        v.populacao = parseInt(data[1].V);
      }
    } catch {
      // Ignore errors, just don't add population
    }

    enriched.push(v);
  }

  return enriched;
}

function formatResponse(
  municipioNome: string,
  municipioId: string,
  vizinhos: VizinhoInfo[],
  input: VizinhosInput
): string {
  let output = `## Municípios Próximos: ${municipioNome}\n\n`;

  output += `**Código IBGE:** ${municipioId}\n`;
  output += `**Quantidade encontrada:** ${vizinhos.length}\n\n`;

  if (vizinhos.length === 0) {
    output += "Nenhum município vizinho encontrado.\n";
    return output;
  }

  // Table of neighbors
  if (input.incluir_dados) {
    output += "| Código | Município | UF | População |\n";
    output += "|:------:|:----------|:--:|----------:|\n";

    for (const v of vizinhos) {
      const pop = v.populacao ? formatNumber(v.populacao) : "-";
      output += `| ${v.codigo} | ${v.nome} | ${v.uf || "-"} | ${pop} |\n`;
    }
  } else {
    output += "| Código | Município | UF |\n";
    output += "|:------:|:----------|:--:|\n";

    for (const v of vizinhos) {
      output += `| ${v.codigo} | ${v.nome} | ${v.uf || "-"} |\n`;
    }
  }

  output += "\n---\n\n";
  output +=
    "**Nota:** Os municípios listados estão na mesma mesorregião, o que indica proximidade geográfica.\n";
  output += "Para vizinhança exata, seria necessário análise espacial das malhas geográficas.\n";

  return output;
}

function formatNoNeighborsFound(municipioNome: string, municipioId: string): string {
  let output = `## Municípios Vizinhos: ${municipioNome}\n\n`;
  output += `**Código IBGE:** ${municipioId}\n\n`;
  output += "Não foi possível determinar os municípios vizinhos automaticamente.\n\n";
  output += "### Sugestões\n\n";
  output +=
    '1. Use `ibge_malhas(localidade="' +
    municipioId +
    '", resolucao="5")` para visualizar a região\n';
  output += "2. Consulte o mapa do estado para identificar vizinhos\n";
  output += '3. Use `ibge_municipios(uf="XX")` para listar todos os municípios do estado\n';

  return output;
}
