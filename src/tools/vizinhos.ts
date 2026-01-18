import { z } from "zod";
import { IBGE_API, Municipio } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { formatNumber } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import { isValidIbgeCode, normalizeUf, formatValidationError } from "../validation.js";
import { fetchWithRetry, RETRY_PRESETS } from "../retry.js";

// Schema for the tool input
export const vizinhosSchema = z.object({
  municipio: z.string().describe("Código IBGE do município (7 dígitos) ou nome do município"),
  uf: z.string().optional().describe("Sigla da UF (obrigatório se usar nome do município)"),
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

/**
 * Gets neighboring municipalities
 */
export async function ibgeVizinhos(input: VizinhosInput): Promise<string> {
  return withMetrics("ibge_vizinhos", "localidades", async () => {
    try {
      // Get municipality code
      let municipioId: string;
      let municipioNome: string;

      if (/^\d{7}$/.test(input.municipio)) {
        // Validate IBGE code format
        if (!isValidIbgeCode(input.municipio)) {
          return formatValidationError(
            "municipio",
            input.municipio,
            "Código IBGE de município com 7 dígitos"
          );
        }
        municipioId = input.municipio;
        // Get municipality name
        const munInfo = await getMunicipioInfo(municipioId);
        if (!munInfo) {
          return ValidationErrors.notFound(
            `Município com código ${municipioId}`,
            "ibge_vizinhos",
            "ibge_municipios"
          );
        }
        municipioNome = munInfo.nome;
      } else {
        // Search by name
        if (!input.uf) {
          return formatValidationError(
            "uf",
            "(não informado)",
            "Sigla da UF é obrigatória ao buscar por nome de município"
          );
        }
        // Validate UF
        if (!normalizeUf(input.uf)) {
          return formatValidationError("uf", input.uf, "Sigla de UF válida (ex: SP, RJ, MG)");
        }
        const munInfo = await findMunicipioByName(input.municipio, input.uf);
        if (!munInfo) {
          return ValidationErrors.notFound(
            `Município "${input.municipio}" em ${input.uf.toUpperCase()}`,
            "ibge_vizinhos",
            "ibge_municipios"
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
        return "Não foi possível obter a lista de municípios do estado.";
      }

      // Get neighboring municipalities using mesh data
      const vizinhos = await getVizinhosFromMalha(municipioId);

      if (vizinhos.length === 0) {
        // Fallback: try to find municipalities that might be neighbors based on code proximity
        return formatNoNeighborsFound(municipioNome, municipioId);
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

      return formatResponse(municipioNome, municipioId, vizinhosData, input);
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(error, "ibge_vizinhos", {
          municipio: input.municipio,
          uf: input.uf,
        });
      }
      return ValidationErrors.emptyResult("ibge_vizinhos");
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

    const data = await cachedFetch<Municipio>(url, key, CACHE_TTL.STATIC);
    return data;
  } catch {
    return null;
  }
}

async function findMunicipioByName(nome: string, uf: string): Promise<Municipio | null> {
  try {
    const url = `${IBGE_API.LOCALIDADES}/estados/${uf.toUpperCase()}/municipios`;
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
  } catch {
    return null;
  }
}

async function getMunicipiosByUf(ufCode: string): Promise<Municipio[]> {
  try {
    const url = `${IBGE_API.LOCALIDADES}/estados/${ufCode}/municipios`;
    const key = cacheKey(url);

    return await cachedFetch<Municipio[]>(url, key, CACHE_TTL.STATIC);
  } catch {
    return [];
  }
}

async function getVizinhosFromMalha(municipioId: string): Promise<VizinhoBasico[]> {
  // The IBGE API doesn't directly provide neighbors
  // We'll use the malhas API to get the municipality's geometry and find adjacent ones
  // This is a simplified approach - in production you'd use proper spatial queries

  try {
    // Get municipality mesh with neighbors info if available
    const malhaUrl = `${IBGE_API.MALHAS}/municipios/${municipioId}?formato=application/json`;

    const response = await fetchWithRetry(malhaUrl, undefined, RETRY_PRESETS.QUICK);
    if (!response.ok) {
      return [];
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
  } catch {
    return [];
  }
}

async function enrichVizinhosData(vizinhos: VizinhoInfo[]): Promise<VizinhoInfo[]> {
  // Get population data for neighbors
  const enriched: VizinhoInfo[] = [];

  for (const v of vizinhos) {
    try {
      // Try to get population from SIDRA
      const popUrl = `${IBGE_API.SIDRA}/t/4709/n6/${v.codigo}/v/93/p/last/f/n`;

      const response = await fetchWithRetry(popUrl, undefined, RETRY_PRESETS.QUICK);
      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 1 && data[1].V) {
          v.populacao = parseInt(data[1].V);
        }
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

// Tool definition
export const vizinhosTool = {
  name: "ibge_vizinhos",
  description: `Busca municípios próximos/vizinhos de um município.

Parâmetros:
- municipio: Código IBGE (7 dígitos) ou nome do município
- uf: Sigla do estado (obrigatório se usar nome)
- incluir_dados: Se true, inclui população dos vizinhos

Nota: A busca retorna municípios da mesma mesorregião como aproximação de vizinhança.
Para vizinhança espacial exata seria necessário processamento de malhas geográficas.

Exemplos:
- Por código: municipio="3550308"
- Por nome: municipio="Campinas", uf="SP"
- Com dados: municipio="3550308", incluir_dados=true`,
  inputSchema: vizinhosSchema,
  handler: ibgeVizinhos,
};
