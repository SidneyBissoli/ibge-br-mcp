/**
 * Recortes TEMÁTICOS do território brasileiro.
 *
 * De onde vem o dado, e por que não é a API de malhas. Até 11/09/2026 esta
 * ferramenta pedia `/api/v3/malhas/biomas`, `/amazonia-legal`, `/semiarido`,
 * `/regioes-metropolitanas` e afins. Nenhum desses caminhos existe: a API de
 * malhas v3 serve SÓ os oito recortes administrativos (paises, regioes,
 * estados, mesorregioes, microrregioes, municipios, regioes-imediatas,
 * regioes-intermediarias) e responde 404 a todo o resto — a v2 responde 500, e
 * a documentação oficial da v3 não menciona tema nenhum. A ferramenta anunciava
 * sete temas e não entregava nenhum, desde o commit inicial.
 *
 * Os recortes existem, em OUTRO serviço do IBGE: o WFS do Geosserviços
 * (IBGE Geociências), onde cada recorte é uma camada. As camadas usadas aqui
 * são as da família `pbqg22_*` — o Quadro Geográfico de Referência de 2022 —,
 * cujo nome não carrega ano e por isso não apodrece a cada safra, mais
 * `CGEO:RegioesMetropolitanas`, que traz RMs e RIDEs na mesma camada separadas
 * pelo campo `FIRST_TIPO`. Conferido camada por camada em 11/09/2026, com a
 * contagem de feições batendo com o que o IBGE publica (6 biomas, 3 RIDEs,
 * 36 RMs, 443 municípios costeiros, 590 na faixa de fronteira).
 *
 * POR QUE NÃO DEVOLVE GEOMETRIA. Um único polígono de bioma são 9 MB; o limite
 * da Amazônia Legal, 5,9 MB. Baixar isso dentro do Worker para depois truncar
 * na resposta gasta memória e tempo para jogar fora — e um agente não faz nada
 * com 9 MB de coordenadas. O WFS aceita `propertyName`, que traz só os
 * atributos (os mesmos 9 MB viram 1,4 KB, com `geometry: null` e o bbox de cada
 * feição preservado). Então esta ferramenta responde O QUE O RECORTE CONTÉM —
 * quantas feições, com que códigos e nomes, em que caixa envolvente — e entrega
 * a URL canônica do WFS para quem quiser a geometria. Malha administrativa com
 * geometria continua sendo `ibge_malhas`.
 */
import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { buildQueryString } from "../utils/index.js";
import { formatError, parseHttpError, ValidationErrors } from "../errors.js";
import type { StructuredToolResult } from "../structured.js";
import { provenienciaIbge } from "../provenance.js";

/**
 * Um recorte temático = uma camada WFS, os atributos que a identificam e, onde
 * existir, o campo pelo qual dá para pedir uma feição só.
 *
 * `campos` não é enfeite: é o `propertyName` da requisição, que é o que troca
 * uma resposta de 9 MB por uma de 1,4 KB. `filtro` é CQL fixo do recorte
 * (RM e RIDE moram na mesma camada).
 */
export interface Recorte {
  nome: string;
  descricao: string;
  camada: string;
  campos: readonly string[];
  filtro?: string;
  /** Campo aceito em `codigo`; ausente = o recorte não tem código próprio. */
  codigo?: { campo: string; numerico: boolean; exemplo: string; oque: string };
}

/** Ordem em que os recortes aparecem no catálogo e no esquema publicado. */
export const TEMAS = [
  "biomas",
  "amazonia_legal",
  "semiarido",
  "costeiro",
  "fronteira",
  "metropolitana",
  "ride",
] as const;

export type Tema = (typeof TEMAS)[number];

export const RECORTES: Record<Tema, Recorte> = {
  biomas: {
    nome: "Biomas",
    descricao: "Os seis biomas continentais brasileiros",
    camada: "CGMAT:pbqg22_62_Biomas_Biomas",
    campos: ["cd_bioma", "nm_bioma"],
    codigo: { campo: "cd_bioma", numerico: true, exemplo: "1", oque: "código do bioma" },
  },
  amazonia_legal: {
    nome: "Amazônia Legal",
    descricao: "Limite da Amazônia Legal brasileira",
    camada: "CGMAT:pbqg22_15_LimAmazoniaLegal",
    campos: ["id", "nome", "area_km2"],
  },
  semiarido: {
    nome: "Semiárido",
    descricao: "Área do semiárido brasileiro",
    camada: "CGMAT:pbqg22_17_Semiarido_AreaSemiarido2021",
    campos: ["cd_semiarido", "nm_semiarido"],
  },
  costeiro: {
    nome: "Zona Costeira",
    descricao: "Municípios da zona costeira",
    camada: "CGMAT:pbqg22_19_MunicipiosCosteiros_MunCosteiros2021",
    campos: ["cd_mun", "nm_mun", "nm_muncost"],
    codigo: {
      campo: "cd_mun",
      numerico: false,
      exemplo: "3550308",
      oque: "código IBGE de 7 dígitos do município",
    },
  },
  fronteira: {
    nome: "Faixa de Fronteira",
    descricao: "Municípios na faixa de fronteira",
    camada: "CGMAT:pbqg22_21_MunicipiosDaFaixaDeFronteira_MunFaixaFront21",
    campos: ["cd_mun", "nm_mun", "nm_faixafront"],
    codigo: {
      campo: "cd_mun",
      numerico: false,
      exemplo: "4108304",
      oque: "código IBGE de 7 dígitos do município",
    },
  },
  metropolitana: {
    nome: "Regiões Metropolitanas",
    descricao: "Regiões metropolitanas instituídas",
    camada: "CGEO:RegioesMetropolitanas",
    campos: ["RM", "FIRST_TIPO"],
    filtro: "FIRST_TIPO='RM'",
  },
  ride: {
    nome: "RIDEs",
    descricao: "Regiões Integradas de Desenvolvimento",
    camada: "CGEO:RegioesMetropolitanas",
    campos: ["RM", "FIRST_TIPO"],
    filtro: "FIRST_TIPO='RIDE'",
  },
};

/** Teto de feições trazidas numa chamada (a faixa de fronteira tem 590). */
const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 600;

// Schema for the tool input
export const malhasTemaSchema = z.object({
  tema: z.enum([...TEMAS, "listar"]).describe(`Recorte temático do território:
- biomas: os seis biomas continentais
- amazonia_legal: limite da Amazônia Legal
- semiarido: área do semiárido
- costeiro: municípios da zona costeira
- fronteira: municípios da faixa de fronteira
- metropolitana: regiões metropolitanas
- ride: Regiões Integradas de Desenvolvimento
- listar: lista os recortes disponíveis, sem consultar a fonte`),
  codigo: z
    .string()
    .optional()
    .describe(
      "Filtra uma feição do recorte. Só os recortes que têm código próprio " +
        'aceitam: biomas (cd_bioma, ex. "1") e os dois de municípios, costeiro ' +
        "e fronteira (código IBGE de 7 dígitos). Nos demais a chamada é recusada " +
        "com a lista do que aceita."
    ),
  limite: z
    .number()
    .int()
    .min(1)
    .max(LIMITE_MAXIMO)
    .optional()
    .default(LIMITE_PADRAO)
    .describe(
      `Quantas feições trazer (padrão ${LIMITE_PADRAO}, máx. ${LIMITE_MAXIMO}). ` +
        "O total do recorte vem sempre, mesmo quando o limite corta a lista."
    ),
});

export type MalhasTemaInput = z.infer<typeof malhasTemaSchema>;

/**
 * Structured output payload (validated against this schema by the MCP SDK).
 * Metadados e ATRIBUTOS das feições; nunca a geometria — ver o cabeçalho.
 */
export const malhasTemaOutputSchema = z.object({
  tema: z.string().describe("Recorte solicitado (ou 'listar')"),
  codigo: z.string().optional().describe("Código usado como filtro, quando informado"),
  camada: z.string().optional().describe("Camada WFS do IBGE Geosserviços consultada"),
  feicoes: z.number().optional().describe("Total de feições do recorte na fonte"),
  feicoes_retornadas: z.number().optional().describe("Quantas vieram nesta resposta"),
  registros: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("Atributos de cada feição (sem geometria)"),
  url_geometria: z
    .string()
    .optional()
    .describe("URL canônica do WFS que devolve a malha COM geometria, em GeoJSON"),
  temas: z
    .array(
      z.object({
        tema: z.string().describe("Identificador do recorte"),
        nome: z.string().describe("Nome do recorte"),
        descricao: z.string().describe("Descrição do recorte"),
      })
    )
    .optional()
    .describe("Lista de recortes disponíveis (somente no modo 'listar')"),
});

/** Resposta GeoJSON do GeoServer: traz o total mesmo quando a lista é cortada. */
interface RespostaWfs {
  type?: string;
  numberMatched?: number;
  numberReturned?: number;
  totalFeatures?: number;
  crs?: { properties?: { name?: string } };
  features?: Array<{
    properties?: Record<string, unknown> | null;
    bbox?: number[];
  }>;
}

/** Monta a URL do WFS. `comGeometria` troca `propertyName` pelo padrão (tudo). */
function urlWfs(r: Recorte, opts: { filtro?: string; limite?: number; comGeometria?: boolean }) {
  const query = buildQueryString({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: r.camada,
    outputFormat: "application/json",
    propertyName: opts.comGeometria ? undefined : r.campos.join(","),
    count: opts.limite,
    CQL_FILTER: opts.filtro,
  });
  return `${IBGE_API.GEOSERVICOS}?${query}`;
}

/** Junta o filtro fixo do recorte com o filtro do `codigo`, quando há os dois. */
function filtroDe(r: Recorte, codigo?: string): string | undefined {
  const partes: string[] = [];
  if (r.filtro) partes.push(r.filtro);
  if (codigo && r.codigo) {
    partes.push(
      r.codigo.numerico
        ? `${r.codigo.campo}=${Number(codigo)}`
        : `${r.codigo.campo}='${codigo.replace(/'/g, "''")}'`
    );
  }
  return partes.length ? partes.join(" AND ") : undefined;
}

/**
 * Fetches thematic geographic recortes from the IBGE Geosserviços WFS
 */
export async function ibgeMalhasTema(input: MalhasTemaInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_malhas_tema", "geosservicos", async () => {
    if (input.tema === "listar") {
      const temas = Object.entries(RECORTES).map(([key, r]) => ({
        tema: key,
        nome: r.nome,
        descricao: r.descricao,
      }));
      return {
        markdown: listaDeRecortes(),
        structured: { tema: "listar", temas },
        provenance: provenienciaIbge({
          fonte: "GEOSERVICOS",
          url: IBGE_API.GEOSERVICOS,
          pesquisa: "catálogo de recortes temáticos mantido pelo servidor",
        }),
      };
    }

    const recorte = RECORTES[input.tema as Tema];
    if (!recorte) {
      return { markdown: recorteInvalido(input.tema), isError: true };
    }
    if (input.codigo && !recorte.codigo) {
      return { markdown: semCodigo(input), isError: true };
    }
    if (input.codigo && recorte.codigo?.numerico && !/^\d+$/.test(input.codigo)) {
      return { markdown: codigoNaoNumerico(input, recorte), isError: true };
    }

    try {
      const filtro = filtroDe(recorte, input.codigo);
      const url = urlWfs(recorte, { filtro, limite: input.limite ?? LIMITE_PADRAO });
      const key = cacheKey(url);
      const data = await cachedFetch<RespostaWfs>(url, key, CACHE_TTL.STATIC);

      const feicoes = data.features ?? [];
      const total = data.numberMatched ?? data.totalFeatures ?? feicoes.length;
      if (total === 0) {
        return { markdown: nadaEncontrado(input, recorte), isError: true };
      }

      const urlGeometria = urlWfs(recorte, { filtro, comGeometria: true });
      const registros = feicoes.map((f) => ({
        ...(f.properties ?? {}),
        ...(f.bbox ? { bbox: f.bbox } : {}),
      }));

      return {
        markdown: formataRecorte(input, recorte, data, total, registros, urlGeometria),
        structured: {
          tema: input.tema,
          ...(input.codigo ? { codigo: input.codigo } : {}),
          camada: recorte.camada,
          feicoes: total,
          feicoes_retornadas: registros.length,
          registros,
          url_geometria: urlGeometria,
        },
        provenance: provenienciaIbge({
          fonte: "GEOSERVICOS",
          url,
          chaveCache: key,
          pesquisa: `Geosserviços, camada ${recorte.camada} (${recorte.nome})`,
        }),
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: parseHttpError(
            error,
            "ibge_malhas_tema",
            { tema: input.tema, codigo: input.codigo, camada: recorte.camada },
            ["ibge_malhas"]
          ),
          isError: true,
        };
      }
      return { markdown: ValidationErrors.emptyResult("ibge_malhas_tema"), isError: true };
    }
  });
}

// ============================================================================
// Mensagens de erro — todas nomeiam o que aceitar no lugar
// ============================================================================

function recorteInvalido(tema: string): string {
  return formatError({
    message: `Recorte temático desconhecido: "${tema}"`,
    tool: "ibge_malhas_tema",
    suggestion: `Recortes aceitos: ${TEMAS.join(", ")}. Use tema="listar" para ver a descrição de cada um.`,
    relatedTools: ["ibge_malhas"],
  });
}

function semCodigo(input: MalhasTemaInput): string {
  const comCodigo = TEMAS.filter((t) => RECORTES[t].codigo);
  return formatError({
    message: `O recorte "${input.tema}" não tem código por feição`,
    tool: "ibge_malhas_tema",
    params: { tema: input.tema, codigo: input.codigo },
    suggestion:
      `Chame sem \`codigo\` para ver as feições deste recorte. ` +
      `Aceitam código: ${comCodigo.join(", ")}.`,
    relatedTools: ["ibge_malhas"],
  });
}

function codigoNaoNumerico(input: MalhasTemaInput, r: Recorte): string {
  return formatError({
    message: `Código inválido para "${input.tema}": "${input.codigo}"`,
    tool: "ibge_malhas_tema",
    params: { tema: input.tema, codigo: input.codigo },
    suggestion: `Aqui \`codigo\` é o ${r.codigo?.oque} (ex.: "${r.codigo?.exemplo}"). Chame sem \`codigo\` para ver os disponíveis.`,
  });
}

function nadaEncontrado(input: MalhasTemaInput, r: Recorte): string {
  return formatError({
    message: `Nenhuma feição encontrada em "${input.tema}"${input.codigo ? ` para o código "${input.codigo}"` : ""}`,
    tool: "ibge_malhas_tema",
    params: { tema: input.tema, codigo: input.codigo, camada: r.camada },
    suggestion: input.codigo
      ? `Chame sem \`codigo\` para ver quais existem neste recorte.`
      : `A camada respondeu vazia, o que não é esperado para este recorte — pode ser mudança na fonte.`,
    relatedTools: ["ibge_malhas"],
  });
}

// ============================================================================
// Formatação
// ============================================================================

function listaDeRecortes(): string {
  let out = "## Recortes temáticos disponíveis\n\n";
  out += "| Tema | Nome | Descrição |\n|:-----|:-----|:----------|\n";
  for (const [key, r] of Object.entries(RECORTES)) {
    out += `| \`${key}\` | ${r.nome} | ${r.descricao} |\n`;
  }
  out += "\nFonte: IBGE Geosserviços (WFS). ";
  out += "Malha administrativa (país, região, UF, município) é `ibge_malhas`.\n";
  return out;
}

function formataRecorte(
  input: MalhasTemaInput,
  r: Recorte,
  data: RespostaWfs,
  total: number,
  registros: Array<Record<string, unknown>>,
  urlGeometria: string
): string {
  const crs = data.crs?.properties?.name?.replace(/^urn:ogc:def:crs:/, "").replace("::", ":");

  let out = `## ${r.nome}\n\n`;
  out += `| Campo | Valor |\n|:------|:------|\n`;
  out += `| **Recorte** | ${r.descricao} |\n`;
  out += `| **Feições** | ${total}${registros.length < total ? ` (mostrando ${registros.length})` : ""} |\n`;
  if (input.codigo) out += `| **Filtro** | ${r.codigo?.oque} = ${input.codigo} |\n`;
  if (crs) out += `| **Sistema de coordenadas** | ${crs} |\n`;
  out += `| **Camada** | \`${r.camada}\` |\n`;
  out += "\n";

  // Uma coluna por atributo do recorte, mais a caixa envolvente quando vier.
  const colunas = [...r.campos, ...(registros.some((x) => x.bbox) ? ["bbox"] : [])];
  out += `### Feições\n\n`;
  out += "| " + colunas.join(" | ") + " |\n";
  out += "|" + colunas.map(() => ":---").join("|") + "|\n";
  for (const reg of registros) {
    out +=
      "| " +
      colunas
        .map((c) => {
          const v = reg[c];
          if (Array.isArray(v)) return v.map((n) => Number(n).toFixed(2)).join(", ");
          return v === undefined || v === null ? "-" : String(v);
        })
        .join(" | ") +
      " |\n";
  }
  if (registros.length < total) {
    out += `\n_… e mais ${total - registros.length}. Use \`limite\` para trazer mais._\n`;
  }

  out += `\n### Geometria\n\n`;
  out += `Não vai na resposta de propósito: um polígono de bioma sozinho passa de 9 MB. `;
  out += `A URL abaixo devolve o recorte com geometria, em GeoJSON:\n\n`;
  out += "```\n" + urlGeometria + "\n```\n";
  return out;
}
