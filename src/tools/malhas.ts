import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { buildQueryString } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";

// Schema for the tool input
export const malhasSchema = z.object({
  localidade: z
    .string()
    .describe("Código IBGE ou sigla da localidade (ex: 'BR', 'SP', '35', '3550308')"),
  tipo: z
    .enum([
      "paises",
      "regioes",
      "estados",
      "mesorregioes",
      "microrregioes",
      "municipios",
      "distritos",
      "regioes-imediatas",
      "regioes-intermediarias",
    ])
    .optional()
    .describe("Tipo de divisão territorial"),
  formato: z
    .enum(["geojson", "topojson", "svg"])
    .optional()
    .default("geojson")
    .describe("Formato de saída (padrão: geojson)"),
  resolucao: z.enum(["0", "1", "2", "3", "4", "5"]).optional().default("0")
    .describe(`Resolução/divisões internas:
0 = Sem divisões internas
1 = Macrorregiões (apenas para BR)
2 = Unidades da Federação
3 = Mesorregiões
4 = Microrregiões
5 = Municípios`),
  qualidade: z
    .enum(["1", "2", "3", "4"])
    .optional()
    .default("4")
    .describe("Qualidade do traçado: 1=mínima, 2=baixa, 3=intermediária, 4=máxima"),
  intrarregiao: z
    .string()
    .optional()
    .describe("Código de região para filtrar (apenas quando localidade=BR)"),
});

export type MalhasInput = z.infer<typeof malhasSchema>;

/**
 * Fetches geographic meshes from IBGE API
 */
export async function ibgeMalhas(input: MalhasInput): Promise<string> {
  return withMetrics("ibge_malhas", "malhas", async () => {
    try {
      // Build the URL
      let url: string;

      // Determine the endpoint based on tipo or localidade
      if (input.tipo) {
        url = `${IBGE_API.MALHAS}/${input.tipo}/${input.localidade}`;
      } else {
        // Auto-detect based on localidade
        const loc = input.localidade.toUpperCase();
        if (loc === "BR") {
          url = `${IBGE_API.MALHAS}/paises/BR`;
        } else if (loc.length === 2 && isNaN(Number(loc))) {
          // State abbreviation
          url = `${IBGE_API.MALHAS}/estados/${loc}`;
        } else if (input.localidade.length === 2) {
          // State code
          url = `${IBGE_API.MALHAS}/estados/${input.localidade}`;
        } else if (input.localidade.length === 7) {
          // Municipality code
          url = `${IBGE_API.MALHAS}/municipios/${input.localidade}`;
        } else {
          // Default to estados
          url = `${IBGE_API.MALHAS}/estados/${input.localidade}`;
        }
      }

      // Add query parameters
      const formatMap: Record<string, string> = {
        geojson: "application/vnd.geo+json",
        topojson: "application/json",
        svg: "image/svg+xml",
      };

      const queryString = buildQueryString({
        formato: formatMap[input.formato || "geojson"],
        resolucao: input.resolucao && input.resolucao !== "0" ? input.resolucao : undefined,
        qualidade: input.qualidade || "4",
        intrarregiao: input.intrarregiao,
      });

      const fullUrl = `${url}?${queryString}`;

      // For SVG format, return the URL (as SVG content would be too large)
      if (input.formato === "svg") {
        return formatSvgResponse(fullUrl, input);
      }

      // Use cache for geographic mesh data (24 hours TTL - static data)
      const key = cacheKey(fullUrl);
      let data: GeoJSONFeatureCollection | GeoJSONFeature;

      try {
        data = await cachedFetch<GeoJSONFeatureCollection | GeoJSONFeature>(
          fullUrl,
          key,
          CACHE_TTL.STATIC
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes("404")) {
          return ValidationErrors.notFound(
            `Malha para localidade ${input.localidade}`,
            "ibge_malhas",
            "ibge_municipios ou ibge_estados"
          );
        }
        throw error;
      }

      return formatMalhasResponse(data, fullUrl, input);
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(error, "ibge_malhas", {
          localidade: input.localidade,
          formato: input.formato,
        });
      }
      return ValidationErrors.emptyResult("ibge_malhas");
    }
  });
}

function formatMalhasResponse(
  data: GeoJSONFeatureCollection | GeoJSONFeature,
  url: string,
  input: MalhasInput
): string {
  let output = `## Malha Geográfica: ${input.localidade.toUpperCase()}\n\n`;

  output += `### Configurações\n\n`;
  output += `| Parâmetro | Valor |\n`;
  output += `|:----------|:------|\n`;
  output += `| **Localidade** | ${input.localidade} |\n`;
  output += `| **Formato** | ${input.formato || "geojson"} |\n`;
  output += `| **Resolução** | ${getResolucaoDescricao(input.resolucao || "0")} |\n`;
  output += `| **Qualidade** | ${input.qualidade || "4"} |\n`;
  output += "\n";

  // GeoJSON info
  output += `### Informações do GeoJSON\n\n`;

  if ("type" in data) {
    output += `| Campo | Valor |\n`;
    output += `|:------|:------|\n`;
    output += `| **Tipo** | ${data.type} |\n`;

    if (data.type === "FeatureCollection" && "features" in data) {
      const features = (data as GeoJSONFeatureCollection).features;
      output += `| **Número de features** | ${features.length} |\n`;

      // Count geometry types
      const geomTypes: Record<string, number> = {};
      for (const f of features) {
        const type = f.geometry?.type || "Unknown";
        geomTypes[type] = (geomTypes[type] || 0) + 1;
      }
      output += `| **Tipos de geometria** | ${Object.entries(geomTypes)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")} |\n`;

      // Sample properties
      if (features.length > 0 && features[0].properties) {
        const props = Object.keys(features[0].properties);
        output += `| **Propriedades** | ${props.join(", ")} |\n`;
      }
    } else if (data.type === "Feature" && "geometry" in data) {
      const feature = data as GeoJSONFeature;
      output += `| **Tipo de geometria** | ${feature.geometry?.type || "Unknown"} |\n`;
      if (feature.properties) {
        output += `| **Propriedades** | ${Object.keys(feature.properties).join(", ")} |\n`;
      }
    }
  }
  output += "\n";

  // Sample features (first 5)
  if ("features" in data && data.type === "FeatureCollection") {
    const features = (data as GeoJSONFeatureCollection).features;
    if (features.length > 0) {
      output += `### Amostra de Features (primeiras ${Math.min(5, features.length)})\n\n`;

      // Get property keys from first feature
      const propKeys = features[0].properties ? Object.keys(features[0].properties) : [];

      if (propKeys.length > 0) {
        output += "| " + propKeys.slice(0, 5).join(" | ") + " |\n";
        output +=
          "|" +
          propKeys
            .slice(0, 5)
            .map(() => ":---")
            .join("|") +
          "|\n";

        for (const f of features.slice(0, 5)) {
          const values = propKeys
            .slice(0, 5)
            .map((k) => (f.properties?.[k] !== undefined ? String(f.properties[k]) : "-"));
          output += "| " + values.join(" | ") + " |\n";
        }

        if (features.length > 5) {
          output += `\n_... e mais ${features.length - 5} features_\n`;
        }
      }
      output += "\n";
    }
  }

  // URL for direct access
  output += `### URL para Download\n\n`;
  output += "```\n";
  output += url + "\n";
  output += "```\n\n";

  // GeoJSON content (truncated if too large)
  const jsonStr = JSON.stringify(data, null, 2);
  if (jsonStr.length <= 10000) {
    output += `### Conteúdo GeoJSON\n\n`;
    output += "```json\n";
    output += jsonStr;
    output += "\n```\n";
  } else {
    output += `### Nota\n\n`;
    output += `O conteúdo GeoJSON é muito grande (${Math.round(jsonStr.length / 1024)}KB) para exibir completamente.\n`;
    output += `Use a URL acima para baixar o arquivo completo.\n`;
  }

  return output;
}

function formatSvgResponse(url: string, input: MalhasInput): string {
  let output = `## Malha Geográfica (SVG): ${input.localidade.toUpperCase()}\n\n`;

  output += `### Configurações\n\n`;
  output += `| Parâmetro | Valor |\n`;
  output += `|:----------|:------|\n`;
  output += `| **Localidade** | ${input.localidade} |\n`;
  output += `| **Formato** | SVG |\n`;
  output += `| **Resolução** | ${getResolucaoDescricao(input.resolucao || "0")} |\n`;
  output += `| **Qualidade** | ${input.qualidade || "4"} |\n`;
  output += "\n";

  output += `### URL para Download/Visualização\n\n`;
  output += "```\n";
  output += url + "\n";
  output += "```\n\n";

  output += `### Como usar\n\n`;
  output += `- Abra a URL acima no navegador para visualizar o mapa\n`;
  output += `- Use em tags \`<img>\` ou \`<object>\` em HTML\n`;
  output += `- Pode ser editado em softwares como Inkscape ou Illustrator\n`;

  return output;
}

function getResolucaoDescricao(resolucao: string): string {
  const descricoes: Record<string, string> = {
    "0": "Sem divisões internas",
    "1": "Macrorregiões",
    "2": "Unidades da Federação",
    "3": "Mesorregiões",
    "4": "Microrregiões",
    "5": "Municípios",
  };
  return `${resolucao} - ${descricoes[resolucao] || "Desconhecido"}`;
}

// GeoJSON types
interface GeoJSONFeature {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: unknown;
  } | null;
  properties: Record<string, unknown> | null;
}

interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

// Tool definition for MCP
export const malhasTool = {
  name: "ibge_malhas",
  description: `Obtém malhas geográficas (mapas) do IBGE em formato GeoJSON, TopoJSON ou SVG.

Funcionalidades:
- Malhas do Brasil, regiões, estados, municípios, etc.
- Diferentes níveis de resolução (divisões internas)
- Diferentes níveis de qualidade do traçado
- Formatos: GeoJSON (dados), TopoJSON (compacto), SVG (imagem)

Tipos de localidade:
- "BR" ou "1" = Brasil inteiro
- Sigla do estado (ex: "SP", "RJ", "MG")
- Código do estado (ex: "35" para SP)
- Código do município (7 dígitos, ex: "3550308" para São Paulo)

Resolução (divisões internas):
- 0 = Apenas o contorno
- 1 = Macrorregiões (só para BR)
- 2 = Unidades da Federação
- 3 = Mesorregiões
- 4 = Microrregiões
- 5 = Municípios

Qualidade:
- 1 = Mínima (menor arquivo)
- 4 = Máxima (mais detalhado)

Exemplos de uso:
- Brasil com estados: localidade="BR", resolucao="2"
- São Paulo com municípios: localidade="SP", resolucao="5"
- Município específico: localidade="3550308"
- Em formato SVG: localidade="BR", formato="svg"`,
  inputSchema: malhasSchema,
  handler: ibgeMalhas,
};
