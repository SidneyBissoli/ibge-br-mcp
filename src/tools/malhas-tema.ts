import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { buildQueryString } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";

// Available thematic meshes
const TEMAS_DISPONIVEIS = {
  biomas: {
    nome: "Biomas",
    descricao: "Amazônia, Cerrado, Mata Atlântica, Caatinga, Pampa, Pantanal",
  },
  amazonia_legal: {
    nome: "Amazônia Legal",
    descricao: "Área da Amazônia Legal brasileira",
  },
  semiarido: {
    nome: "Semiárido",
    descricao: "Região do semiárido brasileiro",
  },
  costeiro: {
    nome: "Zona Costeira",
    descricao: "Municípios da zona costeira",
  },
  fronteira: {
    nome: "Faixa de Fronteira",
    descricao: "Municípios na faixa de fronteira",
  },
  metropolitana: {
    nome: "Regiões Metropolitanas",
    descricao: "Regiões metropolitanas oficiais",
  },
  ride: {
    nome: "RIDEs",
    descricao: "Regiões Integradas de Desenvolvimento Econômico",
  },
} as const;

type TemaDisponivel = keyof typeof TEMAS_DISPONIVEIS;

// Schema for the tool input
export const malhasTemaSchema = z.object({
  tema: z.enum([
    "biomas",
    "amazonia_legal",
    "semiarido",
    "costeiro",
    "fronteira",
    "metropolitana",
    "ride",
    "listar",
  ]).describe(`Tema da malha:
- biomas: Biomas brasileiros (Amazônia, Cerrado, etc.)
- amazonia_legal: Área da Amazônia Legal
- semiarido: Região do semiárido
- costeiro: Zona costeira
- fronteira: Faixa de fronteira
- metropolitana: Regiões metropolitanas
- ride: Regiões Integradas de Desenvolvimento
- listar: Lista temas disponíveis`),
  codigo: z
    .string()
    .optional()
    .describe("Código específico do tema (ex: código do bioma, da região metropolitana)"),
  formato: z
    .enum(["geojson", "topojson", "svg"])
    .optional()
    .default("geojson")
    .describe("Formato de saída"),
  resolucao: z
    .enum(["0", "5"])
    .optional()
    .default("0")
    .describe("0 = Apenas contorno, 5 = Com municípios"),
  qualidade: z
    .enum(["1", "2", "3", "4"])
    .optional()
    .default("4")
    .describe("Qualidade do traçado: 1=mínima, 4=máxima"),
});

export type MalhasTemaInput = z.infer<typeof malhasTemaSchema>;

/**
 * Fetches thematic geographic meshes from IBGE API
 */
export async function ibgeMalhasTema(input: MalhasTemaInput): Promise<string> {
  return withMetrics("ibge_malhas_tema", "malhas", async () => {
    // List available themes
    if (input.tema === "listar") {
      return listThemes();
    }

    try {
      // Build URL based on theme
      const urlPath = getThemeUrl(input.tema, input.codigo);

      if (!urlPath) {
        return `Tema "${input.tema}" não suportado ou código inválido.`;
      }

      // Build query parameters
      const formatMap: Record<string, string> = {
        geojson: "application/vnd.geo+json",
        topojson: "application/json",
        svg: "image/svg+xml",
      };

      const queryString = buildQueryString({
        formato: formatMap[input.formato || "geojson"],
        resolucao: input.resolucao && input.resolucao !== "0" ? input.resolucao : undefined,
        qualidade: input.qualidade || "4",
      });

      const fullUrl = `${urlPath}?${queryString}`;

      // For SVG, return URL only
      if (input.formato === "svg") {
        return formatSvgResponse(fullUrl, input);
      }

      // Use cache for geographic data (24 hours TTL - static data)
      const key = cacheKey(fullUrl);
      let data: GeoJSONData;

      try {
        data = await cachedFetch<GeoJSONData>(fullUrl, key, CACHE_TTL.STATIC);
      } catch (error) {
        if (error instanceof Error && error.message.includes("404")) {
          return `Malha temática não encontrada para: ${input.tema}${input.codigo ? ` (código: ${input.codigo})` : ""}`;
        }
        throw error;
      }

      return formatResponse(data, fullUrl, input);
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(error, "ibge_malhas_tema", {
          tema: input.tema,
          codigo: input.codigo,
        });
      }
      return ValidationErrors.emptyResult("ibge_malhas_tema");
    }
  });
}

function getThemeUrl(tema: string, codigo?: string): string | null {
  switch (tema) {
    case "biomas":
      // Biomas: 1=Amazônia, 2=Cerrado, 3=Mata Atlântica, 4=Caatinga, 5=Pampa, 6=Pantanal
      if (codigo) {
        return `${IBGE_API.MALHAS}/biomas/${codigo}`;
      }
      return `${IBGE_API.MALHAS}/biomas`;

    case "amazonia_legal":
      return `${IBGE_API.MALHAS}/amazonia-legal`;

    case "semiarido":
      return `${IBGE_API.MALHAS}/semiarido`;

    case "costeiro":
      return `${IBGE_API.MALHAS}/municipios-costeiros`;

    case "fronteira":
      return `${IBGE_API.MALHAS}/faixa-de-fronteira`;

    case "metropolitana":
      if (codigo) {
        return `${IBGE_API.MALHAS}/regioes-metropolitanas/${codigo}`;
      }
      return `${IBGE_API.MALHAS}/regioes-metropolitanas`;

    case "ride":
      if (codigo) {
        return `${IBGE_API.MALHAS}/RIDEs/${codigo}`;
      }
      return `${IBGE_API.MALHAS}/RIDEs`;

    default:
      return null;
  }
}

function listThemes(): string {
  let output = "## Temas de Malhas Geográficas Disponíveis\n\n";

  output += "| Tema | Nome | Descrição |\n";
  output += "|:-----|:-----|:----------|\n";

  for (const [key, value] of Object.entries(TEMAS_DISPONIVEIS)) {
    output += `| \`${key}\` | ${value.nome} | ${value.descricao} |\n`;
  }

  output += "\n### Códigos de Biomas\n\n";
  output += "| Código | Bioma |\n";
  output += "|:------:|:------|\n";
  output += "| 1 | Amazônia |\n";
  output += "| 2 | Cerrado |\n";
  output += "| 3 | Mata Atlântica |\n";
  output += "| 4 | Caatinga |\n";
  output += "| 5 | Pampa |\n";
  output += "| 6 | Pantanal |\n";

  output += "\n### Exemplos de Uso\n\n";
  output += "```\n";
  output += "# Todos os biomas\n";
  output += 'ibge_malhas_tema(tema="biomas")\n\n';
  output += "# Apenas a Amazônia\n";
  output += 'ibge_malhas_tema(tema="biomas", codigo="1")\n\n';
  output += "# Amazônia Legal\n";
  output += 'ibge_malhas_tema(tema="amazonia_legal")\n\n';
  output += "# Regiões metropolitanas com municípios\n";
  output += 'ibge_malhas_tema(tema="metropolitana", resolucao="5")\n\n';
  output += "# Em formato SVG\n";
  output += 'ibge_malhas_tema(tema="biomas", formato="svg")\n';
  output += "```\n";

  return output;
}

function formatResponse(data: GeoJSONData, url: string, input: MalhasTemaInput): string {
  const temaInfo = TEMAS_DISPONIVEIS[input.tema as TemaDisponivel];
  let output = `## Malha Temática: ${temaInfo?.nome || input.tema}\n\n`;

  output += `### Configurações\n\n`;
  output += `| Parâmetro | Valor |\n`;
  output += `|:----------|:------|\n`;
  output += `| **Tema** | ${input.tema} |\n`;
  if (input.codigo) {
    output += `| **Código** | ${input.codigo} |\n`;
  }
  output += `| **Formato** | ${input.formato || "geojson"} |\n`;
  output += `| **Resolução** | ${input.resolucao === "5" ? "Com municípios" : "Apenas contorno"} |\n`;
  output += `| **Qualidade** | ${input.qualidade || "4"} |\n`;
  output += "\n";

  // GeoJSON info
  if ("type" in data) {
    output += `### Informações do GeoJSON\n\n`;
    output += `| Campo | Valor |\n`;
    output += `|:------|:------|\n`;
    output += `| **Tipo** | ${data.type} |\n`;

    if (data.type === "FeatureCollection" && "features" in data) {
      const features = data.features;
      output += `| **Features** | ${features.length} |\n`;

      // Sample properties
      if (features.length > 0 && features[0].properties) {
        const props = Object.keys(features[0].properties);
        output += `| **Propriedades** | ${props.join(", ")} |\n`;
      }
    }
  }
  output += "\n";

  // Sample features
  if ("features" in data && data.type === "FeatureCollection") {
    const features = data.features;
    if (features.length > 0 && features.length <= 10) {
      output += `### Features\n\n`;

      const propKeys = features[0].properties
        ? Object.keys(features[0].properties).slice(0, 4)
        : [];

      if (propKeys.length > 0) {
        output += "| " + propKeys.join(" | ") + " |\n";
        output += "|" + propKeys.map(() => ":---").join("|") + "|\n";

        for (const f of features) {
          const values = propKeys.map((k) =>
            f.properties?.[k] !== undefined ? String(f.properties[k]) : "-"
          );
          output += "| " + values.join(" | ") + " |\n";
        }
      }
      output += "\n";
    } else if (features.length > 10) {
      output += `_${features.length} features no total._\n\n`;
    }
  }

  // URL
  output += `### URL para Download\n\n`;
  output += "```\n" + url + "\n```\n";

  return output;
}

function formatSvgResponse(url: string, input: MalhasTemaInput): string {
  const temaInfo = TEMAS_DISPONIVEIS[input.tema as TemaDisponivel];
  let output = `## Malha Temática (SVG): ${temaInfo?.nome || input.tema}\n\n`;

  output += `### URL para Download/Visualização\n\n`;
  output += "```\n" + url + "\n```\n\n";
  output += "Abra a URL no navegador para visualizar o mapa.\n";

  return output;
}

// GeoJSON types
interface GeoJSONFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
}

interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

type GeoJSONData = GeoJSONFeature | GeoJSONFeatureCollection;

// Tool definition
export const malhasTemaTool = {
  name: "ibge_malhas_tema",
  description: `Obtém malhas geográficas temáticas do IBGE.

Temas disponíveis:
- biomas: Biomas brasileiros (Amazônia, Cerrado, Mata Atlântica, Caatinga, Pampa, Pantanal)
- amazonia_legal: Área da Amazônia Legal
- semiarido: Região do semiárido brasileiro
- costeiro: Zona costeira
- fronteira: Faixa de fronteira
- metropolitana: Regiões metropolitanas
- ride: Regiões Integradas de Desenvolvimento

Exemplos:
- Todos os biomas: tema="biomas"
- Bioma Amazônia: tema="biomas", codigo="1"
- Amazônia Legal: tema="amazonia_legal"
- Regiões metropolitanas: tema="metropolitana"
- Listar temas: tema="listar"`,
  inputSchema: malhasTemaSchema,
  handler: ibgeMalhasTema,
};
