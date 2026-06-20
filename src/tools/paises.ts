import { z } from "zod";
import { IBGE_API, Pais, PaisIndicadorResultado } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, formatNumber } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import type { StructuredToolResult } from "../structured.js";

// Schema for the tool input
export const paisesSchema = z.object({
  tipo: z
    .enum(["listar", "detalhes", "indicadores", "buscar"])
    .optional()
    .default("listar")
    .describe("Tipo de consulta: listar (todos), detalhes (de um país), indicadores, buscar"),
  pais: z.string().optional().describe("Código ISO-ALPHA-2 do país (ex: BR, US, AR) ou código M49"),
  busca: z.string().optional().describe("Termo de busca para filtrar países pelo nome"),
  indicadores: z
    .string()
    .optional()
    .describe("IDs dos indicadores separados por | (ex: 77819|77820)"),
  regiao: z
    .string()
    .optional()
    .describe("Filtrar por região/continente: americas, europa, africa, asia, oceania"),
});

export type PaisesInput = z.infer<typeof paisesSchema>;

/** Structured output payload (validated against this schema by the MCP SDK). */
export const paisesOutputSchema = z.object({
  tipo: z
    .enum(["listar", "buscar", "detalhes", "indicadores"])
    .describe("Modo de consulta que originou este resultado"),

  // Modos listar / buscar
  paises: z
    .array(
      z.object({
        codigo: z.string().describe("Código ISO-ALPHA-2 do país (ou '-' se ausente)"),
        nome: z.string().describe("Nome do país"),
        regiao: z.string().describe("Nome da região/continente (ou '-' se ausente)"),
        subRegiao: z.string().describe("Nome da sub-região (ou '-' se ausente)"),
      })
    )
    .optional()
    .describe("Lista de países (modos listar/buscar). Limitada aos 50 primeiros na exibição"),
  total: z.number().optional().describe("Total de países encontrados (modos listar/buscar)"),
  busca: z.string().optional().describe("Termo de busca aplicado, se houver"),
  regiao: z.string().optional().describe("Filtro de região/continente aplicado, se houver"),

  // Modo detalhes
  pais: z
    .object({
      nome: z.string().describe("Nome do país"),
      m49: z.number().describe("Código M49 do país"),
      isoAlpha2: z.string().describe("Código ISO-ALPHA-2"),
      isoAlpha3: z.string().describe("Código ISO-ALPHA-3"),
      regiao: z.string().optional().describe("Nome da região/continente"),
      subRegiao: z.string().optional().describe("Nome da sub-região"),
      regiaoIntermediaria: z.string().optional().describe("Nome da região intermediária"),
      areaTotalKm2: z.number().optional().describe("Área territorial total em km²"),
      linguas: z.array(z.string()).optional().describe("Línguas faladas no país"),
      moedas: z
        .array(
          z.object({
            id: z.string().describe("Código da unidade monetária"),
            nome: z.string().describe("Nome da unidade monetária"),
          })
        )
        .optional()
        .describe("Unidades monetárias do país"),
      historico: z.string().optional().describe("Texto histórico sobre o país"),
      indicadores: z
        .array(
          z.object({
            indicador: z.string().describe("Nome do indicador"),
            valor: z.string().describe("Valor mais recente do indicador"),
            ano: z.string().describe("Ano de referência do valor"),
          })
        )
        .optional()
        .describe("Indicadores principais com o valor mais recente disponível"),
    })
    .optional()
    .describe("Detalhes de um país específico (modo detalhes)"),

  // Modo indicadores
  indicadores: z
    .array(
      z.object({
        id: z.number().describe("ID do indicador na API do IBGE"),
        nome: z.string().describe("Nome do indicador"),
        alias: z.string().describe("Apelido amigável do indicador"),
      })
    )
    .optional()
    .describe("Indicadores disponíveis para consulta de países (modo indicadores)"),
});

// Mapeamento de regiões M49
const REGIOES_M49: Record<string, number> = {
  africa: 2,
  americas: 19,
  asia: 142,
  europa: 150,
  oceania: 9,
};

// Indicadores comuns de países
const INDICADORES_PAISES: Record<string, { id: number; nome: string }> = {
  populacao: { id: 77827, nome: "População total" },
  area: { id: 77819, nome: "Área territorial" },
  densidade: { id: 77828, nome: "Densidade demográfica" },
  pib: { id: 77821, nome: "PIB" },
  pib_per_capita: { id: 77823, nome: "PIB per capita" },
  idh: { id: 77830, nome: "IDH" },
  expectativa_vida: { id: 77831, nome: "Expectativa de vida" },
  mortalidade_infantil: { id: 77832, nome: "Mortalidade infantil" },
};

/**
 * Consulta dados de países via IBGE API
 */
export async function ibgePaises(input: PaisesInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_paises", "paises", async () => {
    try {
      switch (input.tipo) {
        case "listar":
          return await listarPaises(input.busca, input.regiao);
        case "detalhes":
          if (!input.pais) {
            return {
              markdown: ValidationErrors.invalidCode(
                "",
                "ibge_paises",
                "Informe o código ISO-ALPHA-2 do país (ex: BR, US, AR)"
              ),
              isError: true,
            };
          }
          return await detalhesPais(input.pais);
        case "indicadores":
          return listarIndicadores();
        case "buscar":
          if (!input.busca) {
            return {
              markdown: ValidationErrors.emptyResult(
                "ibge_paises",
                "Informe um termo de busca para encontrar países"
              ),
              isError: true,
            };
          }
          return await listarPaises(input.busca, input.regiao);
        default:
          return await listarPaises(input.busca, input.regiao);
      }
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: parseHttpError(error, "ibge_paises", {
            tipo: input.tipo,
            pais: input.pais,
            busca: input.busca,
          }),
          isError: true,
        };
      }
      return { markdown: ValidationErrors.emptyResult("ibge_paises"), isError: true };
    }
  });
}

async function listarPaises(busca?: string, regiao?: string): Promise<StructuredToolResult> {
  const url = `${IBGE_API.PAISES}`;
  const key = cacheKey(url);

  const paises = await cachedFetch<Pais[]>(url, key, CACHE_TTL.STATIC);

  if (!paises || paises.length === 0) {
    return { markdown: ValidationErrors.emptyResult("ibge_paises"), isError: true };
  }

  let resultado = paises;

  // Filtrar por região se especificado
  if (regiao) {
    const regiaoNormalizada = regiao.toLowerCase();
    const regiaoId = REGIOES_M49[regiaoNormalizada];
    if (regiaoId) {
      resultado = resultado.filter((p) => p.localizacao?.regiao?.id === regiaoId);
    }
  }

  // Filtrar por busca se especificado
  if (busca) {
    const buscaNormalizada = busca.toLowerCase();
    resultado = resultado.filter((p) => p.nome.toLowerCase().includes(buscaNormalizada));
  }

  if (resultado.length === 0) {
    return {
      markdown: ValidationErrors.emptyResult(
        "ibge_paises",
        busca ? `Nenhum país encontrado para "${busca}"` : "Nenhum país encontrado"
      ),
      isError: true,
    };
  }

  let output = `## Países${busca ? ` - Busca: "${busca}"` : ""}${regiao ? ` - Região: ${regiao}` : ""}\n\n`;
  output += `**Total:** ${resultado.length} países\n\n`;

  const paisesEstruturados = resultado.map((p) => ({
    codigo: p.id["ISO-ALPHA-2"] || "-",
    nome: p.nome,
    regiao: p.localizacao?.regiao?.nome || "-",
    subRegiao: p.localizacao?.["sub-regiao"]?.nome || "-",
  }));

  const rows = paisesEstruturados
    .slice(0, 50)
    .map((p) => [p.codigo, p.nome, p.regiao, p.subRegiao]);

  output += createMarkdownTable(["Código", "País", "Região", "Sub-região"], rows, {
    alignment: ["center", "left", "left", "left"],
  });

  if (resultado.length > 50) {
    output += `\n_Mostrando 50 de ${resultado.length} países. Use o parâmetro 'busca' para filtrar._\n`;
  }

  return {
    markdown: output,
    structured: {
      tipo: busca ? "buscar" : "listar",
      paises: paisesEstruturados,
      total: resultado.length,
      ...(busca ? { busca } : {}),
      ...(regiao ? { regiao } : {}),
    },
  };
}

async function detalhesPais(codigoPais: string): Promise<StructuredToolResult> {
  const url = `${IBGE_API.PAISES}/${codigoPais.toUpperCase()}`;
  const key = cacheKey(url);

  const paises = await cachedFetch<Pais[]>(url, key, CACHE_TTL.STATIC);

  if (!paises || paises.length === 0) {
    return {
      markdown: ValidationErrors.notFound(
        `País com código "${codigoPais}"`,
        "ibge_paises",
        "ibge_paises tipo='listar'"
      ),
      isError: true,
    };
  }

  const pais = paises[0];

  const detalhes: Record<string, unknown> = {
    nome: pais.nome,
    m49: pais.id.M49,
    isoAlpha2: pais.id["ISO-ALPHA-2"],
    isoAlpha3: pais.id["ISO-ALPHA-3"],
  };

  let output = `## ${pais.nome}\n\n`;

  output += "### Identificação\n\n";
  output += `- **Código M49:** ${pais.id.M49}\n`;
  output += `- **ISO Alpha-2:** ${pais.id["ISO-ALPHA-2"]}\n`;
  output += `- **ISO Alpha-3:** ${pais.id["ISO-ALPHA-3"]}\n\n`;

  if (pais.localizacao) {
    output += "### Localização\n\n";
    output += `- **Região:** ${pais.localizacao.regiao?.nome || "-"}\n`;
    if (pais.localizacao.regiao?.nome) {
      detalhes.regiao = pais.localizacao.regiao.nome;
    }
    if (pais.localizacao["sub-regiao"]) {
      output += `- **Sub-região:** ${pais.localizacao["sub-regiao"].nome}\n`;
      detalhes.subRegiao = pais.localizacao["sub-regiao"].nome;
    }
    if (pais.localizacao["regiao-intermediaria"]) {
      output += `- **Região Intermediária:** ${pais.localizacao["regiao-intermediaria"].nome}\n`;
      detalhes.regiaoIntermediaria = pais.localizacao["regiao-intermediaria"].nome;
    }
    output += "\n";
  }

  if (pais.area?.total) {
    output += "### Área\n\n";
    output += `- **Área total:** ${formatNumber(parseFloat(pais.area.total))} km²\n\n`;
    detalhes.areaTotalKm2 = parseFloat(pais.area.total);
  }

  if (pais.linguas && pais.linguas.length > 0) {
    output += "### Línguas\n\n";
    pais.linguas.forEach((lingua) => {
      output += `- ${lingua.nome}\n`;
    });
    output += "\n";
    detalhes.linguas = pais.linguas.map((lingua) => lingua.nome);
  }

  if (pais["unidades-monetarias"] && pais["unidades-monetarias"].length > 0) {
    output += "### Moeda\n\n";
    pais["unidades-monetarias"].forEach((moeda) => {
      output += `- ${moeda.nome} (${moeda.id})\n`;
    });
    output += "\n";
    detalhes.moedas = pais["unidades-monetarias"].map((moeda) => ({
      id: moeda.id,
      nome: moeda.nome,
    }));
  }

  if (pais.historico) {
    output += "### Histórico\n\n";
    output += pais.historico + "\n\n";
    detalhes.historico = pais.historico;
  }

  // Tentar buscar indicadores principais
  try {
    const indicadoresUrl = `${IBGE_API.PAISES}/${codigoPais.toUpperCase()}/indicadores/77827|77821|77823|77830`;
    const indicadoresKey = cacheKey(indicadoresUrl);
    const indicadores = await cachedFetch<PaisIndicadorResultado[]>(
      indicadoresUrl,
      indicadoresKey,
      CACHE_TTL.MEDIUM
    );

    if (indicadores && indicadores.length > 0) {
      output += "### Indicadores\n\n";
      const indicadoresEstruturados: Array<{ indicador: string; valor: string; ano: string }> = [];
      for (const ind of indicadores) {
        if (ind.series && ind.series.length > 0) {
          const serie = ind.series[0].serie;
          const anos = Object.keys(serie).sort().reverse();
          const ultimoAno = anos[0];
          const valor = serie[ultimoAno];
          if (valor !== null && valor !== undefined && valor !== "-") {
            output += `- **${ind.indicador}:** ${valor} (${ultimoAno})\n`;
            indicadoresEstruturados.push({
              indicador: ind.indicador,
              valor: String(valor),
              ano: ultimoAno,
            });
          }
        }
      }
      output += "\n";
      if (indicadoresEstruturados.length > 0) {
        detalhes.indicadores = indicadoresEstruturados;
      }
    }
  } catch {
    // Ignorar erro ao buscar indicadores
  }

  output += "### Ferramentas Relacionadas\n\n";
  output += "- Use `ibge_paises tipo='indicadores'` para ver indicadores disponíveis\n";
  output += "- Use `ibge_paises tipo='listar' regiao='americas'` para ver países da mesma região\n";

  return { markdown: output, structured: { tipo: "detalhes", pais: detalhes } };
}

function listarIndicadores(): StructuredToolResult {
  let output = "## Indicadores de Países Disponíveis\n\n";
  output += "Os seguintes indicadores podem ser consultados para qualquer país:\n\n";

  const indicadoresEstruturados = Object.entries(INDICADORES_PAISES).map(([key, info]) => ({
    id: info.id,
    nome: info.nome,
    alias: key,
  }));

  const rows = indicadoresEstruturados.map((info) => [String(info.id), info.nome, info.alias]);

  output += createMarkdownTable(["ID", "Indicador", "Alias"], rows, {
    alignment: ["center", "left", "left"],
  });

  output += "\n### Exemplo de Uso\n\n";
  output += "```\n";
  output += 'ibge_paises tipo="detalhes" pais="BR"\n';
  output += 'ibge_paises tipo="listar" regiao="americas"\n';
  output += 'ibge_paises tipo="buscar" busca="Argentina"\n';
  output += "```\n";

  return { markdown: output, structured: { tipo: "indicadores", indicadores: indicadoresEstruturados } };
}
