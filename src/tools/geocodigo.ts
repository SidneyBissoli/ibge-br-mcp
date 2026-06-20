import { z } from "zod";
import { IBGE_API, Municipio, MunicipioSimples } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import { resolveUf } from "../config.js";
import type { StructuredToolResult } from "../structured.js";

// Map of state codes to names
const ESTADOS_MAP: Record<number, { sigla: string; nome: string; regiao: string }> = {
  11: { sigla: "RO", nome: "Rondônia", regiao: "Norte" },
  12: { sigla: "AC", nome: "Acre", regiao: "Norte" },
  13: { sigla: "AM", nome: "Amazonas", regiao: "Norte" },
  14: { sigla: "RR", nome: "Roraima", regiao: "Norte" },
  15: { sigla: "PA", nome: "Pará", regiao: "Norte" },
  16: { sigla: "AP", nome: "Amapá", regiao: "Norte" },
  17: { sigla: "TO", nome: "Tocantins", regiao: "Norte" },
  21: { sigla: "MA", nome: "Maranhão", regiao: "Nordeste" },
  22: { sigla: "PI", nome: "Piauí", regiao: "Nordeste" },
  23: { sigla: "CE", nome: "Ceará", regiao: "Nordeste" },
  24: { sigla: "RN", nome: "Rio Grande do Norte", regiao: "Nordeste" },
  25: { sigla: "PB", nome: "Paraíba", regiao: "Nordeste" },
  26: { sigla: "PE", nome: "Pernambuco", regiao: "Nordeste" },
  27: { sigla: "AL", nome: "Alagoas", regiao: "Nordeste" },
  28: { sigla: "SE", nome: "Sergipe", regiao: "Nordeste" },
  29: { sigla: "BA", nome: "Bahia", regiao: "Nordeste" },
  31: { sigla: "MG", nome: "Minas Gerais", regiao: "Sudeste" },
  32: { sigla: "ES", nome: "Espírito Santo", regiao: "Sudeste" },
  33: { sigla: "RJ", nome: "Rio de Janeiro", regiao: "Sudeste" },
  35: { sigla: "SP", nome: "São Paulo", regiao: "Sudeste" },
  41: { sigla: "PR", nome: "Paraná", regiao: "Sul" },
  42: { sigla: "SC", nome: "Santa Catarina", regiao: "Sul" },
  43: { sigla: "RS", nome: "Rio Grande do Sul", regiao: "Sul" },
  50: { sigla: "MS", nome: "Mato Grosso do Sul", regiao: "Centro-Oeste" },
  51: { sigla: "MT", nome: "Mato Grosso", regiao: "Centro-Oeste" },
  52: { sigla: "GO", nome: "Goiás", regiao: "Centro-Oeste" },
  53: { sigla: "DF", nome: "Distrito Federal", regiao: "Centro-Oeste" },
};

// Map of region codes to names
const REGIOES_MAP: Record<number, { sigla: string; nome: string }> = {
  1: { sigla: "N", nome: "Norte" },
  2: { sigla: "NE", nome: "Nordeste" },
  3: { sigla: "SE", nome: "Sudeste" },
  4: { sigla: "S", nome: "Sul" },
  5: { sigla: "CO", nome: "Centro-Oeste" },
};

export const geocodigoSchema = z.object({
  codigo: z.string().optional().describe(`Código IBGE para decodificar.
Formatos aceitos:
- 1 dígito: Região (1-5)
- 2 dígitos: UF (11-53)
- 7 dígitos: Município
- 9 dígitos: Distrito`),
  nome: z
    .string()
    .optional()
    .describe("Nome da localidade para encontrar o código IBGE (estado ou município)"),
  uf: z
    .string()
    .optional()
    .describe(
      "Estado por sigla (SP), nome (São Paulo) ou código IBGE (35) para restringir a busca por nome de município"
    ),
});

export type GeocodigoInput = z.infer<typeof geocodigoSchema>;

/** One level of a geographic hierarchy (região → UF → ... → município/distrito). */
const hierarquiaNivelSchema = z.object({
  nivel: z.string().describe("Nome do nível territorial (Região, UF, Município, etc.)"),
  codigo: z.number().describe("Código IBGE do nível"),
  nome: z.string().describe("Nome da localidade neste nível"),
});

/** A single municipality match in a name search. */
const municipioMatchSchema = z.object({
  codigo: z.number().describe("Código IBGE (7 dígitos) do município"),
  nome: z.string().describe("Nome do município"),
});

/** Structured output payload (validated against this schema by the MCP SDK). */
export const geocodigoOutputSchema = z.object({
  tipo: z
    .enum(["regiao", "uf", "municipio", "distrito", "lista"])
    .describe(
      "Tipo do resultado: localidade decodificada (regiao/uf/municipio/distrito) ou lista de municípios encontrados (lista)"
    ),
  codigo: z
    .number()
    .optional()
    .describe("Código IBGE da localidade resolvida (ausente em resultados do tipo lista)"),
  nome: z.string().optional().describe("Nome da localidade resolvida"),
  sigla: z.string().optional().describe("Sigla da região ou UF, quando aplicável"),
  regiao: z.string().optional().describe("Nome da região à qual a UF pertence (apenas tipo uf)"),
  regiaoCodigo: z
    .number()
    .optional()
    .describe("Código IBGE da região à qual a UF pertence (apenas tipo uf)"),
  hierarquia: z
    .array(hierarquiaNivelSchema)
    .optional()
    .describe("Hierarquia geográfica completa, da região ao município/distrito (tipo municipio/distrito)"),
  codigoSidra: z
    .string()
    .optional()
    .describe("Código SIDRA de 6 dígitos do município (apenas tipo municipio)"),
  estados: z
    .array(
      z.object({
        codigo: z.number().describe("Código IBGE da UF"),
        sigla: z.string().describe("Sigla da UF"),
        nome: z.string().describe("Nome da UF"),
      })
    )
    .optional()
    .describe("Estados pertencentes à região (apenas tipo regiao)"),
  matches: z
    .array(municipioMatchSchema)
    .optional()
    .describe("Municípios encontrados na busca por nome (apenas tipo lista)"),
  total: z
    .number()
    .optional()
    .describe("Quantidade de municípios encontrados na busca por nome (apenas tipo lista)"),
});

/**
 * Reverse lookup for IBGE codes
 */
export async function ibgeGeocodigo(input: GeocodigoInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_geocodigo", "localidades", async () => {
    try {
      // Decode a code
      if (input.codigo) {
        return await decodeIbgeCode(input.codigo);
      }

      // Search by name
      if (input.nome) {
        return await searchByName(input.nome, input.uf);
      }

      // Show help
      return { markdown: showGeocodigoHelp(), isError: true };
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: parseHttpError(
            error,
            "ibge_geocodigo",
            {
              codigo: input.codigo,
              nome: input.nome,
            },
            ["ibge_municipios", "ibge_estados"]
          ),
          isError: true,
        };
      }
      return { markdown: ValidationErrors.emptyResult("ibge_geocodigo"), isError: true };
    }
  });
}

async function decodeIbgeCode(codigo: string): Promise<StructuredToolResult> {
  const normalized = codigo.replace(/\D/g, "");

  if (normalized.length === 1) {
    // Region code
    const regiao = REGIOES_MAP[parseInt(normalized)];
    if (!regiao) {
      return {
        markdown: `Código de região inválido: "${codigo}"\n\nRegiões válidas: 1 (Norte), 2 (Nordeste), 3 (Sudeste), 4 (Sul), 5 (Centro-Oeste)`,
        isError: true,
      };
    }
    return formatRegiaoInfo(parseInt(normalized), regiao);
  }

  if (normalized.length === 2) {
    // State code
    const estado = ESTADOS_MAP[parseInt(normalized)];
    if (!estado) {
      return {
        markdown: `Código de UF inválido: "${codigo}"\n\nUse ibge_estados() para ver a lista de estados.`,
        isError: true,
      };
    }
    return formatEstadoInfo(parseInt(normalized), estado);
  }

  if (normalized.length === 7) {
    // Municipality code
    return await decodeMunicipio(normalized);
  }

  if (normalized.length === 9) {
    // District code
    return await decodeDistrito(normalized);
  }

  return {
    markdown:
      `Código IBGE inválido: "${codigo}"\n\n` +
      `Formatos aceitos:\n` +
      `- 1 dígito: Região (1-5)\n` +
      `- 2 dígitos: UF (11-53)\n` +
      `- 7 dígitos: Município\n` +
      `- 9 dígitos: Distrito\n\n` +
      `Use ibge_geocodigo(nome="...") para buscar por nome.`,
    isError: true,
  };
}

async function decodeMunicipio(codigo: string): Promise<StructuredToolResult> {
  const endpoint = `${IBGE_API.LOCALIDADES}/municipios/${codigo}`;
  const key = cacheKey("municipio", { codigo });

  try {
    const data = await cachedFetch<Municipio>(endpoint, key, CACHE_TTL.STATIC);

    let output = `## Município: ${data.nome}\n\n`;
    output += `**Código IBGE:** ${data.id}\n\n`;
    output += `### Hierarquia Geográfica\n\n`;

    const rows: string[][] = [
      [
        "Região",
        String(data.microrregiao.mesorregiao.UF.regiao.id),
        data.microrregiao.mesorregiao.UF.regiao.nome,
      ],
      [
        "UF",
        String(data.microrregiao.mesorregiao.UF.id),
        `${data.microrregiao.mesorregiao.UF.nome} (${data.microrregiao.mesorregiao.UF.sigla})`,
      ],
      ["Mesorregião", String(data.microrregiao.mesorregiao.id), data.microrregiao.mesorregiao.nome],
      ["Microrregião", String(data.microrregiao.id), data.microrregiao.nome],
    ];

    const hierarquia = [
      {
        nivel: "Região",
        codigo: data.microrregiao.mesorregiao.UF.regiao.id,
        nome: data.microrregiao.mesorregiao.UF.regiao.nome,
      },
      {
        nivel: "UF",
        codigo: data.microrregiao.mesorregiao.UF.id,
        nome: data.microrregiao.mesorregiao.UF.nome,
      },
      {
        nivel: "Mesorregião",
        codigo: data.microrregiao.mesorregiao.id,
        nome: data.microrregiao.mesorregiao.nome,
      },
      {
        nivel: "Microrregião",
        codigo: data.microrregiao.id,
        nome: data.microrregiao.nome,
      },
    ];

    if (data["regiao-imediata"]) {
      rows.push([
        "Região Imediata",
        String(data["regiao-imediata"].id),
        data["regiao-imediata"].nome,
      ]);
      hierarquia.push({
        nivel: "Região Imediata",
        codigo: data["regiao-imediata"].id,
        nome: data["regiao-imediata"].nome,
      });
      if (data["regiao-imediata"]["regiao-intermediaria"]) {
        rows.push([
          "Região Intermediária",
          String(data["regiao-imediata"]["regiao-intermediaria"].id),
          data["regiao-imediata"]["regiao-intermediaria"].nome,
        ]);
        hierarquia.push({
          nivel: "Região Intermediária",
          codigo: data["regiao-imediata"]["regiao-intermediaria"].id,
          nome: data["regiao-imediata"]["regiao-intermediaria"].nome,
        });
      }
    }

    rows.push(["Município", String(data.id), data.nome]);
    hierarquia.push({ nivel: "Município", codigo: data.id, nome: data.nome });

    output += createMarkdownTable(["Nível", "Código", "Nome"], rows, {
      alignment: ["left", "right", "left"],
    });

    output += `\n### Códigos relacionados\n\n`;
    output += `- **Código SIDRA (6 dígitos):** ${codigo.substring(0, 6)}\n`;
    output += `- **Código completo (7 dígitos):** ${codigo}\n`;

    return {
      markdown: output,
      structured: {
        tipo: "municipio",
        codigo: data.id,
        nome: data.nome,
        hierarquia,
        codigoSidra: codigo.substring(0, 6),
      },
    };
  } catch {
    return {
      markdown:
        `Município não encontrado para o código: ${codigo}\n\n` +
        `Use ibge_municipios(busca="nome") para buscar municípios.`,
      isError: true,
    };
  }
}

async function decodeDistrito(codigo: string): Promise<StructuredToolResult> {
  const endpoint = `${IBGE_API.LOCALIDADES}/distritos/${codigo}`;
  const key = cacheKey("distrito", { codigo });

  try {
    const data = await cachedFetch<{
      id: number;
      nome: string;
      municipio: Municipio;
    }>(endpoint, key, CACHE_TTL.STATIC);

    let output = `## Distrito: ${data.nome}\n\n`;
    output += `**Código IBGE:** ${data.id}\n\n`;
    output += `### Hierarquia Geográfica\n\n`;

    output += createMarkdownTable(
      ["Nível", "Código", "Nome"],
      [
        [
          "Região",
          String(data.municipio.microrregiao.mesorregiao.UF.regiao.id),
          data.municipio.microrregiao.mesorregiao.UF.regiao.nome,
        ],
        [
          "UF",
          String(data.municipio.microrregiao.mesorregiao.UF.id),
          data.municipio.microrregiao.mesorregiao.UF.nome,
        ],
        ["Município", String(data.municipio.id), data.municipio.nome],
        ["Distrito", String(data.id), data.nome],
      ],
      {
        alignment: ["left", "right", "left"],
      }
    );

    return {
      markdown: output,
      structured: {
        tipo: "distrito",
        codigo: data.id,
        nome: data.nome,
        hierarquia: [
          {
            nivel: "Região",
            codigo: data.municipio.microrregiao.mesorregiao.UF.regiao.id,
            nome: data.municipio.microrregiao.mesorregiao.UF.regiao.nome,
          },
          {
            nivel: "UF",
            codigo: data.municipio.microrregiao.mesorregiao.UF.id,
            nome: data.municipio.microrregiao.mesorregiao.UF.nome,
          },
          { nivel: "Município", codigo: data.municipio.id, nome: data.municipio.nome },
          { nivel: "Distrito", codigo: data.id, nome: data.nome },
        ],
      },
    };
  } catch {
    return {
      markdown:
        `Distrito não encontrado para o código: ${codigo}\n\n` +
        `Verifique se o código possui 9 dígitos.`,
      isError: true,
    };
  }
}

async function searchByName(nome: string, uf?: string): Promise<StructuredToolResult> {
  const nomeNormalized = nome.toLowerCase().trim();

  // First, check if it's a state name or abbreviation
  const estadoMatch = Object.entries(ESTADOS_MAP).find(
    ([, info]) =>
      info.sigla.toLowerCase() === nomeNormalized ||
      info.nome.toLowerCase() === nomeNormalized ||
      info.nome.toLowerCase().includes(nomeNormalized)
  );

  if (estadoMatch && !uf) {
    const [codigoStr, info] = estadoMatch;
    return formatEstadoInfo(parseInt(codigoStr), info);
  }

  // Check regions
  const regiaoMatch = Object.entries(REGIOES_MAP).find(
    ([, info]) =>
      info.sigla.toLowerCase() === nomeNormalized || info.nome.toLowerCase() === nomeNormalized
  );

  if (regiaoMatch && !uf) {
    const [codigoStr, info] = regiaoMatch;
    return formatRegiaoInfo(parseInt(codigoStr), info);
  }

  // Search municipalities
  let endpoint = `${IBGE_API.LOCALIDADES}/municipios`;
  let ufKey = "all";
  if (uf) {
    const ufResolved = resolveUf(uf);
    if (ufResolved) {
      endpoint = `${IBGE_API.LOCALIDADES}/estados/${ufResolved.code}/municipios`;
      ufKey = ufResolved.sigla;
    }
  }

  const key = cacheKey("municipios", { uf: ufKey });
  const municipios = await cachedFetch<MunicipioSimples[]>(endpoint, key, CACHE_TTL.STATIC);

  const matches = municipios
    .filter((m) => m.nome.toLowerCase().includes(nomeNormalized))
    .slice(0, 20);

  if (matches.length === 0) {
    return {
      markdown:
        `Nenhuma localidade encontrada para "${nome}"${uf ? ` em ${uf.toUpperCase()}` : ""}.\n\n` +
        `Dicas:\n` +
        `- Verifique a grafia do nome\n` +
        `- Tente um termo mais específico\n` +
        `- Use ibge_municipios(busca="...") para busca mais detalhada`,
      isError: true,
    };
  }

  if (matches.length === 1) {
    // Return detailed info for single match
    return await decodeMunicipio(matches[0].id.toString());
  }

  // Multiple matches - show list
  let output = `## Resultados para "${nome}"${uf ? ` em ${uf.toUpperCase()}` : ""}\n\n`;
  output += `Encontrados ${matches.length} municípios:\n\n`;

  const rows = matches.map((mun) => [String(mun.id), mun.nome]);
  output += createMarkdownTable(["Código", "Município"], rows, {
    alignment: ["right", "left"],
  });

  output += `\nUse ibge_geocodigo(codigo="XXXXXXX") para ver detalhes de um município específico.`;

  return {
    markdown: output,
    structured: {
      tipo: "lista",
      matches: matches.map((mun) => ({ codigo: mun.id, nome: mun.nome })),
      total: matches.length,
    },
  };
}

function formatRegiaoInfo(
  codigo: number,
  regiao: { sigla: string; nome: string }
): StructuredToolResult {
  const estadosRegiao = Object.entries(ESTADOS_MAP)
    .filter(([, info]) => info.regiao === regiao.nome)
    .map(([cod, info]) => ({ codigo: parseInt(cod), ...info }));

  let output = `## Região: ${regiao.nome}\n\n`;
  output += `**Código IBGE:** ${codigo}\n`;
  output += `**Sigla:** ${regiao.sigla}\n\n`;
  output += `### Estados da região\n\n`;

  const rows = estadosRegiao.map((estado) => [String(estado.codigo), estado.sigla, estado.nome]);
  output += createMarkdownTable(["Código", "Sigla", "Nome"], rows, {
    alignment: ["right", "center", "left"],
  });

  return {
    markdown: output,
    structured: {
      tipo: "regiao",
      codigo,
      nome: regiao.nome,
      sigla: regiao.sigla,
      estados: estadosRegiao.map((estado) => ({
        codigo: estado.codigo,
        sigla: estado.sigla,
        nome: estado.nome,
      })),
    },
  };
}

function formatEstadoInfo(
  codigo: number,
  estado: { sigla: string; nome: string; regiao: string }
): StructuredToolResult {
  const regiaoCode = Object.entries(REGIOES_MAP).find(([, r]) => r.nome === estado.regiao)?.[0];

  let output = `## Estado: ${estado.nome}\n\n`;
  output += `**Código IBGE:** ${codigo}\n`;
  output += `**Sigla:** ${estado.sigla}\n`;
  output += `**Região:** ${estado.regiao} (código ${regiaoCode})\n\n`;

  output += `### Códigos relacionados\n\n`;
  output += `- Use ibge_municipios(uf="${estado.sigla}") para listar municípios\n`;
  output += `- Use ibge_sidra com nivel_territorial="3", localidades="${codigo}" para dados do estado\n`;

  return {
    markdown: output,
    structured: {
      tipo: "uf",
      codigo,
      nome: estado.nome,
      sigla: estado.sigla,
      regiao: estado.regiao,
      ...(regiaoCode ? { regiaoCodigo: parseInt(regiaoCode) } : {}),
    },
  };
}

function showGeocodigoHelp(): string {
  let output = `## ibge_geocodigo - Decodificador de códigos IBGE

Esta ferramenta permite:
1. **Decodificar** um código IBGE para obter informações da localidade
2. **Buscar** o código IBGE pelo nome da localidade

### Estrutura dos códigos IBGE

`;

  output += createMarkdownTable(
    ["Dígitos", "Nível", "Exemplo", "Descrição"],
    [
      ["1", "Região", "3", "Sudeste"],
      ["2", "UF", "35", "São Paulo"],
      ["7", "Município", "3550308", "São Paulo (capital)"],
      ["9", "Distrito", "355030805", "Sé (distrito de SP)"],
    ],
    { alignment: ["center", "left", "left", "left"] }
  );

  output += `

### Exemplos de uso

\`\`\`
# Decodificar um código de município
ibge_geocodigo(codigo="3550308")

# Decodificar um código de UF
ibge_geocodigo(codigo="35")

# Buscar código pelo nome
ibge_geocodigo(nome="São Paulo")

# Buscar município em um estado específico
ibge_geocodigo(nome="Campinas", uf="SP")

# Buscar região
ibge_geocodigo(nome="Sudeste")
\`\`\`

### Regiões do Brasil

`;

  output += createMarkdownTable(
    ["Código", "Sigla", "Nome"],
    [
      ["1", "N", "Norte"],
      ["2", "NE", "Nordeste"],
      ["3", "SE", "Sudeste"],
      ["4", "S", "Sul"],
      ["5", "CO", "Centro-Oeste"],
    ],
    { alignment: ["center", "center", "left"] }
  );

  return output;
}
