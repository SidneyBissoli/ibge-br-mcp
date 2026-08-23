/**
 * Reference catalogs exposed as MCP resources (roadmap 1.6).
 *
 * These let a client read the lookup tables an agent needs to build correct
 * tool calls — UF/region codes, SIDRA territorial levels, common SIDRA table
 * codes, biome codes — without guessing or spending a tool round-trip. Each is
 * a static `ibge://catalogos/...` resource returning JSON.
 */

import type { McpServer } from "@modelcontextprotocol/server";

import {
  UF_CODES,
  UF_NAMES,
  REGION_CODES,
  REGION_NAMES,
  STATES_BY_REGION,
  TERRITORIAL_LEVEL_NAMES,
  TERRITORIAL_LEVEL_LABELS,
  ALL_TERRITORIAL_LEVELS,
  BIOME_NAMES,
  SIDRA_TABLES,
} from "./config.js";

/** Human-readable description for each common SIDRA table code. */
const SIDRA_TABLE_DESCRIPTIONS: Record<keyof typeof SIDRA_TABLES, string> = {
  POPULACAO_ESTIMATIVA: "População estimada (anual)",
  POPULACAO_CENSO_2022: "População — Censo 2022",
  POPULACAO_CENSOS_HISTORICO: "População — Censos 1970–2010",
  PIB_CORRENTE: "PIB a preços correntes",
  PIB_PER_CAPITA: "PIB per capita",
  AREA_TERRITORIAL: "Área territorial — Censo 2022",
  DENSIDADE_DEMOGRAFICA: "Densidade demográfica — Censo 2022",
  TAXA_DESOCUPACAO: "Taxa de desocupação (PNAD Contínua)",
  RENDIMENTO_MEDIO: "Rendimento médio (PNAD Contínua)",
  IPCA_MENSAL: "IPCA — variação mensal",
  IPCA_ACUMULADO: "IPCA — acumulado",
  ALFABETIZACAO: "Taxa de alfabetização",
  DOMICILIOS: "Domicílios",
};

/** Brazilian states with their IBGE code, name, and region. */
function ufCatalog() {
  return Object.keys(UF_CODES)
    .map((sigla) => {
      const codigo = UF_CODES[sigla];
      const regiao = Math.floor(codigo / 10); // first digit of a UF code is its region
      return {
        sigla,
        codigo,
        nome: UF_NAMES[sigla],
        regiao_codigo: regiao,
        regiao_nome: REGION_NAMES[regiao],
      };
    })
    .sort((a, b) => a.codigo - b.codigo);
}

/** The five Brazilian regions with their code, abbreviation, and member UFs. */
function regionCatalog() {
  const siglaByCode = Object.fromEntries(
    Object.entries(REGION_CODES).map(([sigla, code]) => [code, sigla])
  );
  return Object.entries(REGION_NAMES).map(([code, nome]) => ({
    codigo: Number(code),
    sigla: siglaByCode[Number(code)],
    nome,
    ufs: STATES_BY_REGION[Number(code)],
  }));
}

/** SIDRA territorial level codes with their canonical short label and full name. */
function territorialLevelCatalog() {
  return ALL_TERRITORIAL_LEVELS.map((codigo) => ({
    codigo,
    label: TERRITORIAL_LEVEL_LABELS[codigo],
    nome: TERRITORIAL_LEVEL_NAMES[codigo] ?? TERRITORIAL_LEVEL_LABELS[codigo],
  }));
}

/** Commonly used SIDRA table codes with a readable description. */
function sidraTableCatalog() {
  return (Object.keys(SIDRA_TABLES) as Array<keyof typeof SIDRA_TABLES>).map((chave) => ({
    codigo: SIDRA_TABLES[chave],
    chave,
    descricao: SIDRA_TABLE_DESCRIPTIONS[chave],
  }));
}

/** Brazilian biome codes (used by ibge_malhas_tema). */
function biomeCatalog() {
  return Object.entries(BIOME_NAMES).map(([codigo, nome]) => ({
    codigo: Number(codigo),
    nome,
  }));
}

/** Registers all reference-catalog resources on the server. */
export function registerResources(server: McpServer): void {
  const catalogs: Array<{
    name: string;
    uri: string;
    title: string;
    description: string;
    build: () => unknown;
  }> = [
    {
      name: "ufs",
      uri: "ibge://catalogos/ufs",
      title: "UFs do Brasil",
      description: "As 27 Unidades da Federação com código IBGE (2 dígitos), sigla, nome e região.",
      build: ufCatalog,
    },
    {
      name: "regioes",
      uri: "ibge://catalogos/regioes",
      title: "Regiões do Brasil",
      description: "As 5 grandes regiões com código, sigla, nome e UFs que as compõem.",
      build: regionCatalog,
    },
    {
      name: "niveis-territoriais",
      uri: "ibge://catalogos/niveis-territoriais",
      title: "Níveis territoriais SIDRA",
      description:
        "Códigos de nível territorial (nivel_territorial) aceitos pelas tools SIDRA, com rótulo e nome.",
      build: territorialLevelCatalog,
    },
    {
      name: "tabelas-sidra",
      uri: "ibge://catalogos/tabelas-sidra",
      title: "Tabelas SIDRA comuns",
      description:
        "Códigos das tabelas SIDRA mais usadas (população, PIB, IPCA, etc.) com descrição.",
      build: sidraTableCatalog,
    },
    {
      name: "biomas",
      uri: "ibge://catalogos/biomas",
      title: "Biomas do Brasil",
      description: "Códigos dos 6 biomas brasileiros (usados por ibge_malhas_tema).",
      build: biomeCatalog,
    },
  ];

  for (const catalog of catalogs) {
    server.registerResource(
      catalog.name,
      catalog.uri,
      {
        title: catalog.title,
        description: catalog.description,
        mimeType: "application/json",
      },
      (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(catalog.build(), null, 2),
          },
        ],
      })
    );
  }
}
