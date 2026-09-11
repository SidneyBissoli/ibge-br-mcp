import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { buildQueryString } from "../utils/index.js";
import { formatError, parseHttpError, ValidationErrors } from "../errors.js";
import type { StructuredToolResult } from "../structured.js";
import { provenienciaIbge } from "../provenance.js";

/**
 * O CONTRATO DA API DE MALHAS v3, e por que ele está escrito aqui.
 *
 * Esta ferramenta nasceu falando a língua da v2 (`resolucao=0..5`,
 * `qualidade=1..4`) apontando para a v3, que não aceita nem uma coisa nem
 * outra. Como `qualidade` ia em TODA chamada com o default "4", a v3
 * respondia 400 "O parâmetro qualidade aceita apenas UM dos seguintes
 * valores: minima, intermediaria ou maxima" — ou seja, a ferramenta falhava
 * 100% das vezes, para todo mundo, menos no caminho SVG (que só devolve a
 * URL, sem chamar a API — e a URL que ele devolvia também dava 400). Medido
 * em 2026-09-10 pela telemetria e reproduzido contra a API pública.
 *
 * Nenhum teste pegava: os testes de malhas mockam `fetch` e só conferem que a
 * URL CONTÉM o caminho esperado. URL montada é hipótese; só a API diz se ela
 * vale. Daí a defesa nova em tests/malhas-contract.integration.test.ts.
 *
 * As duas tabelas abaixo são TRADUÇÃO, não invenção: os valores de
 * `intrarregiao` aceitos por nível saíram da mensagem de erro da própria API
 * (`?intrarregiao=zzz` faz a v3 listar o que aceita), conferidos em
 * 2026-09-10. O teste de contrato refaz essa pergunta à API e reprova se a
 * lista mudar, para a tabela não fossilizar o dia da varredura.
 */
export const QUALIDADE_V3 = ["minima", "intermediaria", "maxima"] as const;

/** Os quatro níveis da v2 caem nos três da v3 (2 = "baixa" → mínima). */
const QUALIDADE_V2_PARA_V3: Record<string, (typeof QUALIDADE_V3)[number]> = {
  "1": "minima",
  "2": "minima",
  "3": "intermediaria",
  "4": "maxima",
};

/** `resolucao` da v2 é `intrarregiao` na v3; 0 = sem divisões internas. */
export const RESOLUCAO_PARA_INTRARREGIAO: Record<string, string | undefined> = {
  "0": undefined,
  "1": "regiao",
  "2": "UF",
  "3": "mesorregiao",
  "4": "microrregiao",
  "5": "municipio",
};

/** Níveis que a v3 serve. `distritos` NÃO existe na v3 (responde 404). */
export const NIVEIS = [
  "paises",
  "regioes",
  "estados",
  "mesorregioes",
  "microrregioes",
  "municipios",
  "regioes-imediatas",
  "regioes-intermediarias",
] as const;

export type Nivel = (typeof NIVEIS)[number];

/** Quais divisões internas cada nível aceita — a v3 recusa o resto com 400. */
export const INTRARREGIAO_POR_NIVEL: Record<Nivel, readonly string[]> = {
  paises: [
    "regiao",
    "UF",
    "regiao-intermediaria",
    "regiao-imediata",
    "mesorregiao",
    "microrregiao",
    "municipio",
  ],
  regioes: ["UF", "mesorregiao", "microrregiao", "municipio"],
  estados: ["mesorregiao", "microrregiao", "municipio"],
  mesorregioes: ["microrregiao", "municipio"],
  microrregioes: ["municipio"],
  municipios: [],
  "regioes-imediatas": ["municipio"],
  "regioes-intermediarias": ["regiao-imediata", "municipio"],
};

// Schema for the tool input
export const malhasSchema = z.object({
  localidade: z
    .string()
    .describe("Código IBGE ou sigla da localidade (ex: 'BR', 'SP', '35', '3550308')"),
  tipo: z.enum(NIVEIS).optional().describe("Tipo de divisão territorial"),
  formato: z
    .enum(["geojson", "topojson", "svg"])
    .optional()
    .default("geojson")
    .describe("Formato de saída (padrão: geojson)"),
  resolucao: z.enum(["0", "1", "2", "3", "4", "5"]).optional().default("0")
    .describe(`Divisões internas a desenhar dentro da malha pedida:
0 = Sem divisões internas (só o contorno)
1 = Macrorregiões (apenas quando localidade=BR)
2 = Unidades da Federação (BR ou uma região)
3 = Mesorregiões
4 = Microrregiões
5 = Municípios
Cada nível aceita só as divisões menores que ele: município aceita nenhuma, UF aceita 3, 4 e 5.`),
  qualidade: z
    .enum(["minima", "intermediaria", "maxima", "1", "2", "3", "4"])
    .optional()
    .default("maxima")
    .describe(
      "Qualidade do traçado: 'minima', 'intermediaria' ou 'maxima' (padrão). " +
        "Os números 1–4 do IBGE antigo continuam aceitos e são traduzidos."
    ),
  intrarregiao: z
    .string()
    .optional()
    .describe(
      "Divisão interna pelo nome, alternativa a resolucao: 'regiao', 'UF', " +
        "'regiao-intermediaria', 'regiao-imediata', 'mesorregiao', 'microrregiao' ou " +
        "'municipio'. Quando informado, prevalece sobre resolucao."
    ),
});

export type MalhasInput = z.infer<typeof malhasSchema>;

/**
 * Structured output payload (validated against this schema by the MCP SDK).
 *
 * Lightweight metadata only — the actual geometry blob (GeoJSON/TopoJSON/SVG)
 * can be very large and is NEVER included here. The geometry is conveyed in the
 * Markdown channel (truncated/URL) instead.
 */
export const malhasOutputSchema = z.object({
  localidade: z.string().describe("Código IBGE ou sigla da localidade consultada"),
  formato: z.string().describe("Formato de saída solicitado (geojson, topojson ou svg)"),
  resolucao: z.string().optional().describe("Resolução/divisões internas solicitada"),
  qualidade: z.string().optional().describe("Qualidade do traçado solicitada"),
  tipo: z.string().optional().describe("Tipo de divisão territorial, quando informado"),
  intrarregiao: z
    .string()
    .optional()
    .describe("Divisão interna desenhada dentro da malha (vocabulário da API v3)"),
  url: z.string().optional().describe("URL para download da malha completa"),
});

/**
 * Fetches geographic meshes from IBGE API
 */
export async function ibgeMalhas(input: MalhasInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_malhas", "malhas", async () => {
    try {
      // Determine the endpoint based on tipo or localidade
      let nivel: Nivel;
      const loc = input.localidade.toUpperCase();
      if (input.tipo) {
        nivel = input.tipo;
      } else if (loc === "BR") {
        nivel = "paises";
      } else if (input.localidade.length === 7) {
        // Municipality code
        nivel = "municipios";
      } else {
        // State abbreviation, state code, or anything else: estados
        nivel = "estados";
      }
      const id =
        nivel === "paises" ? "BR" : loc.length === 2 && isNaN(Number(loc)) ? loc : input.localidade;
      const url = `${IBGE_API.MALHAS}/${nivel}/${id}`;

      // Traduz resolucao/qualidade da v2 para o vocabulário da v3 e recusa,
      // com mensagem que ensina, a combinação que a v3 responderia com 400.
      const intrarregiao =
        input.intrarregiao ?? RESOLUCAO_PARA_INTRARREGIAO[input.resolucao || "0"];
      const aceitos = INTRARREGIAO_POR_NIVEL[nivel];
      if (intrarregiao && !aceitos.includes(intrarregiao)) {
        return {
          markdown: malhasDivisaoInvalida(input, nivel, intrarregiao, aceitos),
          isError: true,
        };
      }
      const qualidade =
        QUALIDADE_V2_PARA_V3[input.qualidade || "maxima"] ?? (input.qualidade || "maxima");

      // Add query parameters
      const formatMap: Record<string, string> = {
        geojson: "application/vnd.geo+json",
        topojson: "application/json",
        svg: "image/svg+xml",
      };

      const queryString = buildQueryString({
        formato: formatMap[input.formato || "geojson"],
        qualidade,
        intrarregiao,
      });

      const fullUrl = `${url}?${queryString}`;

      // For SVG format, return the URL (as SVG content would be too large)
      if (input.formato === "svg") {
        return {
          markdown: formatSvgResponse(fullUrl, input),
          structured: buildMalhasMetadata(input, fullUrl),
          provenance: provenienciaIbge({
            fonte: "MALHAS",
            url: fullUrl,
            pesquisa: "API de Malhas Geográficas",
          }),
        };
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
          return {
            markdown: ValidationErrors.notFound(
              `Malha para localidade ${input.localidade}`,
              "ibge_malhas",
              "ibge_municipios ou ibge_estados"
            ),
            isError: true,
          };
        }
        throw error;
      }

      return {
        markdown: formatMalhasResponse(data, fullUrl, input),
        structured: buildMalhasMetadata(input, fullUrl),
        provenance: provenienciaIbge({
          fonte: "MALHAS",
          url: fullUrl,
          chaveCache: key,
          pesquisa: "API de Malhas Geográficas",
        }),
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: parseHttpError(
            error,
            "ibge_malhas",
            {
              localidade: input.localidade,
              formato: input.formato,
            },
            ["ibge_malhas_tema"]
          ),
          isError: true,
        };
      }
      return { markdown: ValidationErrors.emptyResult("ibge_malhas"), isError: true };
    }
  });
}

/**
 * A malha pedida não comporta a divisão interna pedida.
 *
 * Erro de CONTRATO, não de dado: em vez de repassar o 400 cru da v3, diz qual
 * divisão o nível aceita e com que número de `resolucao` ela se pede.
 */
function malhasDivisaoInvalida(
  input: MalhasInput,
  nivel: Nivel,
  intrarregiao: string,
  aceitos: readonly string[]
): string {
  const porNome = Object.entries(RESOLUCAO_PARA_INTRARREGIAO);
  const comoPedir = aceitos
    .map((nome) => {
      const numero = porNome.find(([, valor]) => valor === nome)?.[0];
      return numero ? `${nome} (resolucao="${numero}")` : nome;
    })
    .join(", ");
  return formatError({
    message: `A malha de ${nivel} não aceita divisão interna "${intrarregiao}"`,
    tool: "ibge_malhas",
    params: {
      localidade: input.localidade,
      tipo: nivel,
      resolucao: input.resolucao,
      intrarregiao: input.intrarregiao,
    },
    suggestion: aceitos.length
      ? `Divisões aceitas neste nível: ${comoPedir}.\nUse resolucao="0" para só o contorno.`
      : `Este nível não tem divisões internas. Use resolucao="0".`,
    relatedTools: ["ibge_municipios", "ibge_estados"],
  });
}

/** Builds the lightweight structured metadata payload (never the geometry). */
function buildMalhasMetadata(input: MalhasInput, url: string): Record<string, unknown> {
  return {
    localidade: input.localidade,
    formato: input.formato || "geojson",
    resolucao: input.resolucao || "0",
    qualidade: input.qualidade || "maxima",
    tipo: input.tipo,
    intrarregiao: input.intrarregiao,
    url,
  };
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
  output += `| **Qualidade** | ${input.qualidade || "maxima"} |\n`;
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
  output += `| **Qualidade** | ${input.qualidade || "maxima"} |\n`;
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
