import { z } from "zod";
import { IBGE_API, Pais, PaisIndicador, PaisIndicadorResultado } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, formatNumber } from "../utils/index.js";
import {
  ValidationErrors,
  erroDoCatch,
  erroContrato,
  erroFonte,
  erroNaoEncontrado,
} from "../errors.js";
import type { StructuredToolResult } from "../structured.js";
import { provenienciaIbge } from "../provenance.js";

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
    .describe(
      "Indicadores a trazer no modo detalhes, separados por | — IDs ou apelidos " +
        "(ex: 77819|77820 ou idh|populacao). Lista completa: tipo='indicadores'. " +
        "Sem este parâmetro: população, PIB, PIB per capita, IDH e esperança de vida"
    ),
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
            id: z.number().describe("ID do indicador na API do IBGE"),
            indicador: z.string().describe("Nome do indicador, como a fonte o publica"),
            valor: z
              .string()
              .describe(
                "Valor mais recente publicado, como texto da fonte (pode ser não numérico, ex.: '<2.5')"
              ),
            ano: z.string().describe("Ano ou período (ex.: '2021-2023') do valor"),
            unidade: z
              .string()
              .nullable()
              .describe("Unidade do valor (ex.: 'US$', '% do PIB'); null se a fonte não informa"),
            multiplicador: z
              .number()
              .nullable()
              .describe(
                "Escala do valor (ex.: 1000000000 = valor em bilhões da unidade); " +
                  "null se a fonte não informa"
              ),
          })
        )
        .optional()
        .describe("Indicadores pedidos, cada um com o valor mais recente publicado"),
      indicadoresSemValor: z
        .array(
          z.object({
            id: z.number().describe("ID do indicador na API do IBGE"),
            indicador: z.string().describe("Nome do indicador, como a fonte o publica"),
          })
        )
        .optional()
        .describe(
          "Indicadores pedidos para os quais a fonte não publica valor algum para o país " +
            "(série inteira em branco) — ausência na fonte, não zero"
        ),
    })
    .optional()
    .describe("Detalhes de um país específico (modo detalhes)"),

  // Modo indicadores
  indicadores: z
    .array(
      z.object({
        id: z.number().describe("ID do indicador na API do IBGE"),
        nome: z.string().describe("Nome do indicador, como a fonte o publica"),
        alias: z
          .string()
          .describe(
            "O que passar no parâmetro `indicadores`: o apelido (ex.: 'idh'), ou o próprio ID " +
              "quando o indicador não tem apelido"
          ),
        unidade: z
          .string()
          .nullable()
          .describe("Unidade do indicador; null se a fonte não informa"),
        multiplicador: z
          .number()
          .nullable()
          .describe("Escala dos valores; null se a fonte não informa"),
      })
    )
    .optional()
    .describe("Catálogo de indicadores de países publicado pelo IBGE (modo indicadores)"),
});

// Mapeamento de regiões M49
const REGIOES_M49: Record<string, number> = {
  africa: 2,
  americas: 19,
  asia: 142,
  europa: 150,
  oceania: 9,
};

/**
 * Aliases accepted in `indicadores`. Only the id is written by hand: names,
 * units and scale come from the source (`/paises/indicadores/`). Each id is
 * checked against the published catalog in tests/paises.tool.test.ts — until
 * 5.9.0 this map carried hand-written labels on the wrong ids (77827 "População
 * total" is the GDP) and two ids the API does not have.
 */
export const ALIASES_INDICADORES_PAISES: Record<string, number> = {
  populacao: 77849,
  densidade: 77844,
  pib: 77827,
  pib_per_capita: 77823,
  idh: 77831,
  expectativa_vida: 77830,
};

/** What `detalhes` brings when `indicadores` is not given. */
const INDICADORES_PADRAO = ["populacao", "pib", "pib_per_capita", "idh", "expectativa_vida"].map(
  (alias) => ALIASES_INDICADORES_PAISES[alias]
);

const URL_CATALOGO_INDICADORES = `${IBGE_API.PAISES}/indicadores/`;

/** Fields of `pais` read from the indicators endpoint (a provenance part of its own). */
const CAMPOS_DOS_INDICADORES = ["indicadores", "indicadoresSemValor"];

/** Ids and/or aliases separated by `|` (or comma) → ids; unknown alias → its name. */
function resolverIndicadores(texto: string): { ids: number[] } | { desconhecido: string } {
  const ids: number[] = [];
  for (const parte of texto
    .split(/[|,]/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const id = /^\d+$/.test(parte)
      ? Number(parte)
      : ALIASES_INDICADORES_PAISES[parte.toLowerCase()];
    if (id === undefined) return { desconhecido: parte };
    if (!ids.includes(id)) ids.push(id);
  }
  return { ids };
}

/**
 * Latest published point of a series: the last item, in the source's own
 * (chronological) order, whose value is not null — skipping the {"-": null}
 * opener. A 5-year range ("2021-2023") is a valid period.
 */
function ultimoValor(
  serie: Array<Record<string, string | null>>
): { ano: string; valor: string } | null {
  for (let i = serie.length - 1; i >= 0; i--) {
    const [ano, valor] = Object.entries(serie[i] ?? {})[0] ?? [];
    if (ano !== undefined && ano !== "-" && valor !== null && valor !== undefined && valor !== "") {
      return { ano, valor: String(valor) };
    }
  }
  return null;
}

/** "8509360,850" (decimal comma, the country record's format) → 8509360.85. */
function numeroDaFonte(texto: string): number {
  return parseFloat(texto.includes(",") ? texto.replace(/\./g, "").replace(",", ".") : texto);
}

function unidadeLegivel(unidade: string | null, multiplicador: number | null): string {
  if (!unidade) return "";
  return multiplicador !== null && multiplicador !== 1
    ? `${unidade} (multiplicador ${formatNumber(multiplicador)})`
    : unidade;
}

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
            return erroContrato(
              ValidationErrors.invalidCode(
                "",
                "ibge_paises",
                "Informe o código ISO-ALPHA-2 do país (ex: BR, US, AR)"
              )
            );
          }
          {
            const pedidos = input.indicadores ? resolverIndicadores(input.indicadores) : null;
            if (pedidos && "desconhecido" in pedidos) {
              return erroContrato(
                ValidationErrors.invalidCode(
                  pedidos.desconhecido,
                  "ibge_paises",
                  `Indicador "${pedidos.desconhecido}" desconhecido: use IDs numéricos ou os ` +
                    `apelidos ${Object.keys(ALIASES_INDICADORES_PAISES).join(", ")} ` +
                    "(lista completa: ibge_paises tipo='indicadores')"
                )
              );
            }
            return await detalhesPais(input.pais, pedidos?.ids);
          }
        case "indicadores":
          return await listarIndicadores();
        case "buscar":
          if (!input.busca) {
            // Falta parâmetro: é `contrato`, embora o texto (de sempre) diga
            // "Nenhum dado encontrado" — a classe não sai mais da frase.
            return erroContrato(
              ValidationErrors.emptyResult(
                "ibge_paises",
                "Informe um termo de busca para encontrar países"
              )
            );
          }
          return await listarPaises(input.busca, input.regiao);
        default:
          return await listarPaises(input.busca, input.regiao);
      }
    } catch (error) {
      return erroDoCatch(error, "ibge_paises", {
        tipo: input.tipo,
        pais: input.pais,
        busca: input.busca,
      });
    }
  });
}

async function listarPaises(busca?: string, regiao?: string): Promise<StructuredToolResult> {
  const url = `${IBGE_API.PAISES}`;
  const key = cacheKey(url);

  const paises = await cachedFetch<Pais[]>(url, key, CACHE_TTL.STATIC);

  if (!paises || paises.length === 0) {
    return erroFonte(ValidationErrors.emptyResult("ibge_paises"));
  }

  let resultado = paises;

  // Filtrar por região se especificado
  if (regiao) {
    const regiaoNormalizada = regiao.toLowerCase();
    const regiaoId = REGIOES_M49[regiaoNormalizada];
    if (regiaoId) {
      resultado = resultado.filter((p) => p.localizacao?.regiao?.id?.M49 === regiaoId);
    }
  }

  // Filtrar por busca se especificado
  if (busca) {
    const buscaNormalizada = busca.toLowerCase();
    resultado = resultado.filter((p) => p.nome.abreviado.toLowerCase().includes(buscaNormalizada));
  }

  if (resultado.length === 0) {
    return erroNaoEncontrado(
      ValidationErrors.emptyResult(
        "ibge_paises",
        busca ? `Nenhum país encontrado para "${busca}"` : "Nenhum país encontrado"
      )
    );
  }

  let output = `## Países${busca ? ` - Busca: "${busca}"` : ""}${regiao ? ` - Região: ${regiao}` : ""}\n\n`;
  output += `**Total:** ${resultado.length} países\n\n`;

  const paisesEstruturados = resultado.map((p) => ({
    codigo: p.id["ISO-3166-1-ALPHA-2"] || "-",
    nome: p.nome.abreviado,
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
    provenance: provenienciaIbge({
      fonte: "PAISES",
      url,
      chaveCache: key,
      pesquisa: "API de Países",
    }),
  };
}

async function detalhesPais(
  codigoPais: string,
  idsPedidos?: number[]
): Promise<StructuredToolResult> {
  const url = `${IBGE_API.PAISES}/${codigoPais.toUpperCase()}`;
  const key = cacheKey(url);

  const paises = await cachedFetch<Pais[]>(url, key, CACHE_TTL.STATIC);

  if (!paises || paises.length === 0) {
    return erroNaoEncontrado(
      ValidationErrors.notFound(
        `País com código "${codigoPais}"`,
        "ibge_paises",
        "ibge_paises tipo='listar'"
      )
    );
  }

  const pais = paises[0];

  const detalhes: Record<string, unknown> = {
    nome: pais.nome.abreviado,
    m49: pais.id.M49,
    isoAlpha2: pais.id["ISO-3166-1-ALPHA-2"],
    isoAlpha3: pais.id["ISO-3166-1-ALPHA-3"],
  };

  let output = `## ${pais.nome.abreviado}\n\n`;

  output += "### Identificação\n\n";
  output += `- **Código M49:** ${pais.id.M49}\n`;
  output += `- **ISO Alpha-2:** ${pais.id["ISO-3166-1-ALPHA-2"]}\n`;
  output += `- **ISO Alpha-3:** ${pais.id["ISO-3166-1-ALPHA-3"]}\n\n`;

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
    const area = numeroDaFonte(pais.area.total);
    output += `- **Área total:** ${formatNumber(area)} km²\n\n`;
    detalhes.areaTotalKm2 = area;
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
      output += `- ${moeda.nome} (${moeda.id["ISO-4217-ALPHA"]})\n`;
    });
    output += "\n";
    detalhes.moedas = pais["unidades-monetarias"].map((moeda) => ({
      id: moeda.id["ISO-4217-ALPHA"],
      nome: moeda.nome,
    }));
  }

  if (pais.historico) {
    output += "### Histórico\n\n";
    output += pais.historico + "\n\n";
    detalhes.historico = pais.historico;
  }

  // Indicadores: os pedidos em `indicadores`, ou os principais
  const ids = idsPedidos ?? INDICADORES_PADRAO;
  const indicadoresUrl = `${IBGE_API.PAISES}/${codigoPais.toUpperCase()}/indicadores/${ids.join("|")}`;
  try {
    const indicadoresKey = cacheKey(indicadoresUrl);
    const indicadores = await cachedFetch<PaisIndicadorResultado[]>(
      indicadoresUrl,
      indicadoresKey,
      CACHE_TTL.MEDIUM
    );

    if (indicadores && indicadores.length > 0) {
      output += "### Indicadores\n\n";
      const porId = new Map(indicadores.map((ind) => [ind.id, ind] as const));
      const indicadoresEstruturados = [];
      const semValor: Array<{ id: number; indicador: string }> = [];
      const semResposta: number[] = [];
      // In the order asked for; the source answers sorted by id.
      for (const id of ids) {
        const ind = porId.get(id);
        if (!ind) {
          semResposta.push(id);
          continue;
        }
        const ponto = ultimoValor(ind.series?.[0]?.serie ?? []);
        if (!ponto) {
          output += `- **${ind.indicador}:** sem valor publicado para o país\n`;
          semValor.push({ id: ind.id, indicador: ind.indicador });
          continue;
        }
        const unidade = ind.unidade?.id ?? null;
        const multiplicador = ind.unidade?.multiplicador ?? null;
        output += `- **${ind.indicador}:** ${[ponto.valor, unidadeLegivel(unidade, multiplicador)].filter(Boolean).join(" ")} (${ponto.ano})\n`;
        indicadoresEstruturados.push({
          id: ind.id,
          indicador: ind.indicador,
          valor: ponto.valor,
          ano: ponto.ano,
          unidade,
          multiplicador,
        });
      }
      if (semResposta.length > 0) {
        output += `\n_A fonte não respondeu pelos IDs ${semResposta.join(", ")} — confira em ibge_paises tipo='indicadores'._\n`;
      }
      output += "\n";
      if (indicadoresEstruturados.length > 0) {
        detalhes.indicadores = indicadoresEstruturados;
      }
      if (semValor.length > 0) {
        detalhes.indicadoresSemValor = semValor;
      }
    }
  } catch (error) {
    // The main indicators are an extra: the country record stands without
    // them. Indicators the caller asked for are the answer — fail loudly.
    if (idsPedidos) throw error;
  }

  output += "### Ferramentas Relacionadas\n\n";
  output += "- Use `ibge_paises tipo='indicadores'` para ver indicadores disponíveis\n";
  output += "- Use `ibge_paises tipo='listar' regiao='americas'` para ver países da mesma região\n";

  return {
    markdown: output,
    structured: { tipo: "detalhes", pais: detalhes },
    // The country record (24 h) and its indicators (1 h) are two reads that
    // expire apart: when the indicators made it to the response, both are
    // parts and the block sits at the oldest (contract §3).
    provenance: provenienciaIbge({
      fonte: "PAISES",
      url,
      chaveCache: key,
      pesquisa: "API de Países",
      partes: [
        {
          fields: Object.keys(detalhes)
            .filter((k) => !CAMPOS_DOS_INDICADORES.includes(k))
            .map((k) => `pais.${k}`),
          url,
        },
        ...(CAMPOS_DOS_INDICADORES.some((k) => detalhes[k] !== undefined)
          ? [
              {
                fields: CAMPOS_DOS_INDICADORES.filter((k) => detalhes[k] !== undefined).map(
                  (k) => `pais.${k}`
                ),
                url: indicadoresUrl,
              },
            ]
          : []),
      ],
    }),
  };
}

async function listarIndicadores(): Promise<StructuredToolResult> {
  const url = URL_CATALOGO_INDICADORES;
  const key = cacheKey(url);
  const catalogo = await cachedFetch<PaisIndicador[]>(url, key, CACHE_TTL.STATIC);

  if (!catalogo || catalogo.length === 0) {
    return erroFonte(ValidationErrors.emptyResult("ibge_paises"));
  }

  const aliasPorId = new Map(
    Object.entries(ALIASES_INDICADORES_PAISES).map(([alias, id]) => [id, alias] as const)
  );
  const indicadoresEstruturados = catalogo.map((ind) => ({
    id: ind.id,
    nome: ind.indicador,
    alias: aliasPorId.get(ind.id) ?? String(ind.id),
    unidade: ind.unidade?.id ?? null,
    multiplicador: ind.unidade?.multiplicador ?? null,
  }));

  let output = "## Indicadores de Países Disponíveis\n\n";
  output += `Catálogo publicado pelo IBGE: ${catalogo.length} indicadores, consultáveis para qualquer país `;
  output += "com `tipo='detalhes'` e o parâmetro `indicadores` (IDs ou apelidos).\n\n";

  const rows = indicadoresEstruturados.map((info) => [
    String(info.id),
    info.nome,
    unidadeLegivel(info.unidade, info.multiplicador) || "-",
    aliasPorId.get(info.id) ?? "-",
  ]);

  output += createMarkdownTable(["ID", "Indicador", "Unidade", "Apelido"], rows, {
    alignment: ["center", "left", "left", "left"],
  });

  output += "\n### Exemplo de Uso\n\n";
  output += "```\n";
  output += 'ibge_paises tipo="detalhes" pais="BR"\n';
  output += 'ibge_paises tipo="detalhes" pais="AR" indicadores="idh|77852"\n';
  output += 'ibge_paises tipo="listar" regiao="americas"\n';
  output += 'ibge_paises tipo="buscar" busca="Argentina"\n';
  output += "```\n";

  return {
    markdown: output,
    structured: { tipo: "indicadores", indicadores: indicadoresEstruturados },
    provenance: provenienciaIbge({
      fonte: "PAISES",
      url,
      chaveCache: key,
      pesquisa: "API de Países — catálogo de indicadores",
    }),
  };
}
