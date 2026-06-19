import { z } from "zod";
import { IBGE_API, PesquisaResultado, PesquisaIndicador, PesquisaDetalhe } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, formatNumber } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import { isValidIbgeCode, formatValidationError } from "../validation.js";
import type { StructuredToolResult } from "../structured.js";

// Schema for the tool input
export const cidadesSchema = z.object({
  tipo: z
    .enum(["panorama", "indicador", "pesquisas", "historico"])
    .optional()
    .default("panorama")
    .describe(
      "Tipo de consulta: panorama (resumo geral), indicador (específico), pesquisas (listar), historico"
    ),
  municipio: z.string().optional().describe("Código IBGE do município (7 dígitos)"),
  uf: z.string().optional().describe("Código ou sigla da UF para filtrar (ex: 35 ou SP)"),
  indicador: z.string().optional().describe("ID do indicador ou nome para busca"),
  pesquisa: z.string().optional().describe("ID da pesquisa para filtrar indicadores"),
});

export type CidadesInput = z.infer<typeof cidadesSchema>;

/** Structured output payload (validated against this schema by the MCP SDK). */
export const cidadesOutputSchema = z.object({
  tipo: z.string().describe("Tipo de consulta (panorama, indicador, pesquisas, historico)"),
  municipio: z.string().optional().describe("Código IBGE do município"),
  nome: z.string().optional().describe("Nome do município/indicador"),
  indicadores: z
    .array(
      z.object({
        nome: z.string(),
        valor: z.string(),
        ano: z.string().optional(),
      })
    )
    .describe("Indicadores retornados (vazio para respostas de catálogo)"),
});

/** Minimal valid payload for catalog/listing responses. */
function listingPayload(tipo: string): Record<string, unknown> {
  return { tipo, indicadores: [] };
}

// Indicadores principais do panorama (usados em cidades.ibge.gov.br)
const INDICADORES_PANORAMA: Record<string, { id: number; pesquisa: string; nome: string }> = {
  populacao: { id: 29171, pesquisa: "33", nome: "População estimada" },
  densidade: { id: 29168, pesquisa: "33", nome: "Densidade demográfica" },
  escolarizacao: { id: 60045, pesquisa: "40", nome: "Taxa de escolarização 6-14 anos" },
  idh: { id: 30255, pesquisa: "37", nome: "IDH Municipal" },
  mortalidade: { id: 30279, pesquisa: "39", nome: "Mortalidade infantil" },
  pib_per_capita: { id: 47001, pesquisa: "38", nome: "PIB per capita" },
  salario_medio: { id: 29765, pesquisa: "33", nome: "Salário médio mensal" },
  populacao_ocupada: { id: 29763, pesquisa: "33", nome: "Pessoal ocupado" },
  receitas: { id: 28141, pesquisa: "33", nome: "Receitas realizadas" },
  despesas: { id: 28142, pesquisa: "33", nome: "Despesas empenhadas" },
  idhm_renda: { id: 30257, pesquisa: "37", nome: "IDHM Renda" },
  idhm_longevidade: { id: 30259, pesquisa: "37", nome: "IDHM Longevidade" },
  idhm_educacao: { id: 30261, pesquisa: "37", nome: "IDHM Educação" },
  area: { id: 29167, pesquisa: "33", nome: "Área territorial" },
};

// Pesquisas principais disponíveis
const PESQUISAS_PRINCIPAIS = [
  { id: "33", nome: "Cadastro Central de Empresas" },
  { id: "37", nome: "Índice de Desenvolvimento Humano Municipal" },
  { id: "38", nome: "Produto Interno Bruto dos Municípios" },
  { id: "39", nome: "Pesquisa Nacional de Saúde" },
  { id: "40", nome: "Censo Escolar" },
  { id: "36", nome: "Pesquisa de Informações Básicas Municipais" },
  { id: "21", nome: "Censo Demográfico" },
];

/**
 * Consulta indicadores municipais via API de Pesquisas do IBGE
 */
export async function ibgeCidades(input: CidadesInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_cidades", "cidades", async () => {
    try {
      switch (input.tipo) {
        case "panorama":
          if (!input.municipio) {
            return {
              markdown: ValidationErrors.invalidCode(
                "",
                "ibge_cidades",
                "Informe o código IBGE do município (7 dígitos)"
              ),
              isError: true,
            };
          }
          return await panoramaMunicipio(input.municipio);
        case "indicador":
          if (!input.indicador) {
            return listarIndicadoresDisponiveis();
          }
          return await consultarIndicador(input.indicador, input.municipio, input.uf);
        case "pesquisas":
          return await listarPesquisas(input.pesquisa);
        case "historico":
          if (!input.municipio || !input.indicador) {
            return {
              markdown: formatValidationError(
                "municipio/indicador",
                "",
                "Informe o código do município e o ID do indicador para ver histórico"
              ),
              isError: true,
            };
          }
          return await historicoIndicador(input.municipio, input.indicador);
        default:
          return listarIndicadoresDisponiveis();
      }
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: parseHttpError(
            error,
            "ibge_cidades",
            {
              tipo: input.tipo,
              municipio: input.municipio,
              indicador: input.indicador,
            },
            ["ibge_comparar", "ibge_censo"]
          ),
          isError: true,
        };
      }
      return { markdown: ValidationErrors.emptyResult("ibge_cidades"), isError: true };
    }
  });
}

async function panoramaMunicipio(codigoMunicipio: string): Promise<StructuredToolResult> {
  // Validar código do município
  if (!isValidIbgeCode(codigoMunicipio) || codigoMunicipio.length !== 7) {
    return {
      markdown: formatValidationError(
        "municipio",
        codigoMunicipio,
        "Código IBGE de 7 dígitos (ex: 3550308 para São Paulo)"
      ),
      isError: true,
    };
  }

  // Buscar nome do município
  let nomeMunicipio = codigoMunicipio;
  try {
    const localidadeUrl = `${IBGE_API.LOCALIDADES}/municipios/${codigoMunicipio}`;
    const localidadeKey = cacheKey(localidadeUrl);
    const localidade = await cachedFetch<{
      nome: string;
      microrregiao?: { mesorregiao?: { UF?: { nome: string; sigla: string } } };
    }>(localidadeUrl, localidadeKey, CACHE_TTL.STATIC);
    if (localidade?.nome) {
      const uf = localidade.microrregiao?.mesorregiao?.UF?.sigla || "";
      nomeMunicipio = `${localidade.nome}${uf ? ` (${uf})` : ""}`;
    }
  } catch {
    // Usar código como fallback
  }

  let output = `## Panorama: ${nomeMunicipio}\n\n`;
  output += `**Código IBGE:** ${codigoMunicipio}\n\n`;

  // Buscar indicadores do panorama
  const indicadoresParaBuscar = [
    "populacao",
    "area",
    "densidade",
    "pib_per_capita",
    "idh",
    "escolarizacao",
    "mortalidade",
    "salario_medio",
  ];

  const resultados: Array<{ nome: string; valor: string; ano: string }> = [];

  for (const indKey of indicadoresParaBuscar) {
    const indInfo = INDICADORES_PANORAMA[indKey];
    if (!indInfo) continue;

    try {
      const url = `${IBGE_API.PESQUISAS}/${indInfo.pesquisa}/indicadores/${indInfo.id}/resultados/${codigoMunicipio}`;
      const key = cacheKey(url);
      const data = await cachedFetch<PesquisaResultado[]>(url, key, CACHE_TTL.MEDIUM);

      if (data && data.length > 0 && data[0].res && data[0].res.length > 0) {
        const resultado = data[0].res[0].res;
        const anos = Object.keys(resultado).sort().reverse();

        for (const ano of anos) {
          const valor = resultado[ano];
          if (valor !== null && valor !== "-" && valor !== "...") {
            let valorFormatado = String(valor);

            // Formatar números
            if (!isNaN(Number(valor))) {
              const num = Number(valor);
              if (indKey === "populacao" || indKey === "populacao_ocupada") {
                valorFormatado = formatNumber(num) + " pessoas";
              } else if (indKey === "area") {
                valorFormatado = formatNumber(num, { maximumFractionDigits: 2 }) + " km²";
              } else if (indKey === "densidade") {
                valorFormatado = formatNumber(num, { maximumFractionDigits: 2 }) + " hab/km²";
              } else if (indKey === "pib_per_capita" || indKey === "salario_medio") {
                valorFormatado = "R$ " + formatNumber(num, { maximumFractionDigits: 2 });
              } else if (indKey === "idh" || indKey.startsWith("idhm")) {
                valorFormatado = formatNumber(num, { maximumFractionDigits: 3 });
              } else if (indKey === "escolarizacao" || indKey === "mortalidade") {
                valorFormatado = formatNumber(num, { maximumFractionDigits: 1 }) + "%";
              } else {
                valorFormatado = formatNumber(num);
              }
            }

            resultados.push({
              nome: indInfo.nome,
              valor: valorFormatado,
              ano,
            });
            break;
          }
        }
      }
    } catch {
      // Ignorar erros individuais
    }
  }

  if (resultados.length === 0) {
    return {
      markdown: ValidationErrors.emptyResult(
        "ibge_cidades",
        `Nenhum indicador encontrado para o município ${codigoMunicipio}`
      ),
      structured: {
        tipo: "panorama",
        municipio: codigoMunicipio,
        nome: nomeMunicipio,
        indicadores: [],
      },
    };
  }

  output += "### Indicadores\n\n";
  output += createMarkdownTable(
    ["Indicador", "Valor", "Ano"],
    resultados.map((r) => [r.nome, r.valor, r.ano]),
    { alignment: ["left", "right", "center"] }
  );

  output += "\n### Ferramentas Relacionadas\n\n";
  output += `- \`ibge_cidades tipo="historico" municipio="${codigoMunicipio}" indicador="29171"\` - Histórico de população\n`;
  output += `- \`ibge_cidades tipo="pesquisas"\` - Ver pesquisas disponíveis\n`;
  output += `- \`ibge_cidades tipo="indicador"\` - Ver indicadores disponíveis\n`;

  return {
    markdown: output,
    structured: {
      tipo: "panorama",
      municipio: codigoMunicipio,
      nome: nomeMunicipio,
      indicadores: resultados,
    },
  };
}

async function consultarIndicador(
  indicador: string,
  municipio?: string,
  _uf?: string
): Promise<StructuredToolResult> {
  // Verificar se é um alias conhecido
  const indicadorInfo = INDICADORES_PANORAMA[indicador.toLowerCase()];

  if (indicadorInfo) {
    if (!municipio) {
      return {
        markdown: formatValidationError(
          "municipio",
          "",
          "Informe o código do município para consultar o indicador"
        ),
        isError: true,
      };
    }

    const url = `${IBGE_API.PESQUISAS}/${indicadorInfo.pesquisa}/indicadores/${indicadorInfo.id}/resultados/${municipio}`;
    const key = cacheKey(url);
    const data = await cachedFetch<PesquisaResultado[]>(url, key, CACHE_TTL.MEDIUM);

    if (!data || data.length === 0) {
      return {
        markdown: ValidationErrors.emptyResult("ibge_cidades"),
        structured: { tipo: "indicador", municipio, nome: indicadorInfo.nome, indicadores: [] },
      };
    }

    let output = `## ${indicadorInfo.nome}\n\n`;
    output += `**Município:** ${municipio}\n\n`;

    const indicadores: Array<{ nome: string; valor: string; ano?: string }> = [];

    if (data[0].res && data[0].res.length > 0) {
      const resultado = data[0].res[0].res;
      const entries = Object.entries(resultado)
        .filter(([, v]) => v !== null && v !== "-" && v !== "...")
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 20);

      output += createMarkdownTable(
        ["Ano", "Valor"],
        entries.map(([ano, valor]) => [ano, String(valor)]),
        { alignment: ["center", "right"] }
      );

      for (const [ano, valor] of entries) {
        indicadores.push({ nome: indicadorInfo.nome, valor: String(valor), ano });
      }
    }

    return {
      markdown: output,
      structured: { tipo: "indicador", municipio, nome: indicadorInfo.nome, indicadores },
    };
  }

  // Se não for alias, mostrar lista de indicadores disponíveis
  return listarIndicadoresDisponiveis();
}

async function listarPesquisas(pesquisaId?: string): Promise<StructuredToolResult> {
  if (pesquisaId) {
    // Buscar detalhes de uma pesquisa específica
    try {
      const url = `${IBGE_API.PESQUISAS}/${pesquisaId}`;
      const key = cacheKey(url);
      const pesquisa = await cachedFetch<PesquisaDetalhe>(url, key, CACHE_TTL.STATIC);

      let output = `## Pesquisa: ${pesquisa.nome}\n\n`;
      output += `**ID:** ${pesquisa.id}\n`;
      if (pesquisa.periodicidade) {
        output += `**Periodicidade:** ${pesquisa.periodicidade}\n`;
      }

      // Buscar indicadores da pesquisa
      const indicadoresUrl = `${IBGE_API.PESQUISAS}/${pesquisaId}/indicadores`;
      const indicadoresKey = cacheKey(indicadoresUrl);
      const indicadores = await cachedFetch<PesquisaIndicador[]>(
        indicadoresUrl,
        indicadoresKey,
        CACHE_TTL.STATIC
      );

      if (indicadores && indicadores.length > 0) {
        output += `\n### Indicadores (${indicadores.length})\n\n`;

        const rows = indicadores
          .slice(0, 30)
          .map((ind) => [String(ind.id), ind.indicador, ind.unidade?.id || "-"]);

        output += createMarkdownTable(["ID", "Indicador", "Unidade"], rows, {
          alignment: ["center", "left", "center"],
        });

        if (indicadores.length > 30) {
          output += `\n_Mostrando 30 de ${indicadores.length} indicadores._\n`;
        }
      }

      return { markdown: output, structured: listingPayload("pesquisas") };
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: parseHttpError(error, "ibge_cidades", { pesquisa: pesquisaId }, [
            "ibge_comparar",
            "ibge_censo",
          ]),
          isError: true,
        };
      }
      return { markdown: ValidationErrors.emptyResult("ibge_cidades"), isError: true };
    }
  }

  // Listar pesquisas principais
  let output = "## Pesquisas Disponíveis\n\n";
  output += "As seguintes pesquisas fornecem indicadores municipais:\n\n";

  const rows = PESQUISAS_PRINCIPAIS.map((p) => [p.id, p.nome]);
  output += createMarkdownTable(["ID", "Pesquisa"], rows, {
    alignment: ["center", "left"],
  });

  output += "\n### Exemplo de Uso\n\n";
  output += "```\n";
  output += 'ibge_cidades tipo="pesquisas" pesquisa="33"\n';
  output += "```\n";

  return { markdown: output, structured: listingPayload("pesquisas") };
}

async function historicoIndicador(
  municipio: string,
  indicador: string
): Promise<StructuredToolResult> {
  // Verificar se é um alias
  const indicadorInfo = INDICADORES_PANORAMA[indicador.toLowerCase()];
  const pesquisa = indicadorInfo?.pesquisa || "-";
  const indicadorId = indicadorInfo?.id || indicador;
  const indicadorNome = indicadorInfo?.nome || `Indicador ${indicador}`;

  const url = `${IBGE_API.PESQUISAS}/${pesquisa}/indicadores/${indicadorId}/resultados/${municipio}`;
  const key = cacheKey(url);

  const data = await cachedFetch<PesquisaResultado[]>(url, key, CACHE_TTL.MEDIUM);

  if (!data || data.length === 0 || !data[0].res || data[0].res.length === 0) {
    return {
      markdown: ValidationErrors.emptyResult(
        "ibge_cidades",
        `Nenhum histórico encontrado para o indicador ${indicador}`
      ),
      structured: { tipo: "historico", municipio, nome: indicadorNome, indicadores: [] },
    };
  }

  let output = `## Histórico: ${indicadorNome}\n\n`;
  output += `**Município:** ${municipio}\n\n`;

  const resultado = data[0].res[0].res;
  const entries = Object.entries(resultado)
    .filter(([, v]) => v !== null && v !== "-" && v !== "...")
    .sort(([a], [b]) => b.localeCompare(a));

  if (entries.length === 0) {
    return {
      markdown: ValidationErrors.emptyResult("ibge_cidades"),
      structured: { tipo: "historico", municipio, nome: indicadorNome, indicadores: [] },
    };
  }

  output += createMarkdownTable(
    ["Ano", "Valor"],
    entries.map(([ano, valor]) => [ano, String(valor)]),
    { alignment: ["center", "right"] }
  );

  return {
    markdown: output,
    structured: {
      tipo: "historico",
      municipio,
      nome: indicadorNome,
      indicadores: entries.map(([ano, valor]) => ({
        nome: indicadorNome,
        valor: String(valor),
        ano,
      })),
    },
  };
}

function listarIndicadoresDisponiveis(): StructuredToolResult {
  let output = "## Indicadores Disponíveis\n\n";
  output += "Os seguintes indicadores podem ser consultados por município:\n\n";

  const rows = Object.entries(INDICADORES_PANORAMA).map(([alias, info]) => [
    String(info.id),
    info.nome,
    alias,
  ]);

  output += createMarkdownTable(["ID", "Indicador", "Alias"], rows, {
    alignment: ["center", "left", "left"],
  });

  output += "\n### Exemplo de Uso\n\n";
  output += "```\n";
  output += 'ibge_cidades tipo="panorama" municipio="3550308"\n';
  output += 'ibge_cidades tipo="indicador" indicador="populacao" municipio="3550308"\n';
  output += 'ibge_cidades tipo="historico" municipio="3550308" indicador="29171"\n';
  output += "```\n";

  return { markdown: output, structured: listingPayload("indicador") };
}
