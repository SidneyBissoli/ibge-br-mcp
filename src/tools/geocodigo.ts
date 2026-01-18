import { z } from "zod";
import { IBGE_API, Municipio, MunicipioSimples } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";

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
  uf: z.string().optional().describe("Sigla da UF para restringir a busca por nome de município"),
});

export type GeocodigoInput = z.infer<typeof geocodigoSchema>;

/**
 * Reverse lookup for IBGE codes
 */
export async function ibgeGeocodigo(input: GeocodigoInput): Promise<string> {
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
      return showGeocodigoHelp();
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(
          error,
          "ibge_geocodigo",
          {
            codigo: input.codigo,
            nome: input.nome,
          },
          ["ibge_municipios", "ibge_estados"]
        );
      }
      return ValidationErrors.emptyResult("ibge_geocodigo");
    }
  });
}

async function decodeIbgeCode(codigo: string): Promise<string> {
  const normalized = codigo.replace(/\D/g, "");

  if (normalized.length === 1) {
    // Region code
    const regiao = REGIOES_MAP[parseInt(normalized)];
    if (!regiao) {
      return `Código de região inválido: "${codigo}"\n\nRegiões válidas: 1 (Norte), 2 (Nordeste), 3 (Sudeste), 4 (Sul), 5 (Centro-Oeste)`;
    }
    return formatRegiaoInfo(parseInt(normalized), regiao);
  }

  if (normalized.length === 2) {
    // State code
    const estado = ESTADOS_MAP[parseInt(normalized)];
    if (!estado) {
      return `Código de UF inválido: "${codigo}"\n\nUse ibge_estados() para ver a lista de estados.`;
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

  return (
    `Código IBGE inválido: "${codigo}"\n\n` +
    `Formatos aceitos:\n` +
    `- 1 dígito: Região (1-5)\n` +
    `- 2 dígitos: UF (11-53)\n` +
    `- 7 dígitos: Município\n` +
    `- 9 dígitos: Distrito\n\n` +
    `Use ibge_geocodigo(nome="...") para buscar por nome.`
  );
}

async function decodeMunicipio(codigo: string): Promise<string> {
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

    if (data["regiao-imediata"]) {
      rows.push([
        "Região Imediata",
        String(data["regiao-imediata"].id),
        data["regiao-imediata"].nome,
      ]);
      if (data["regiao-imediata"]["regiao-intermediaria"]) {
        rows.push([
          "Região Intermediária",
          String(data["regiao-imediata"]["regiao-intermediaria"].id),
          data["regiao-imediata"]["regiao-intermediaria"].nome,
        ]);
      }
    }

    rows.push(["Município", String(data.id), data.nome]);

    output += createMarkdownTable(["Nível", "Código", "Nome"], rows, {
      alignment: ["left", "right", "left"],
    });

    output += `\n### Códigos relacionados\n\n`;
    output += `- **Código SIDRA (6 dígitos):** ${codigo.substring(0, 6)}\n`;
    output += `- **Código completo (7 dígitos):** ${codigo}\n`;

    return output;
  } catch {
    return (
      `Município não encontrado para o código: ${codigo}\n\n` +
      `Use ibge_municipios(busca="nome") para buscar municípios.`
    );
  }
}

async function decodeDistrito(codigo: string): Promise<string> {
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

    return output;
  } catch {
    return (
      `Distrito não encontrado para o código: ${codigo}\n\n` +
      `Verifique se o código possui 9 dígitos.`
    );
  }
}

async function searchByName(nome: string, uf?: string): Promise<string> {
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
  if (uf) {
    const ufCode = Object.entries(ESTADOS_MAP).find(
      ([, info]) => info.sigla.toLowerCase() === uf.toLowerCase()
    )?.[0];
    if (ufCode) {
      endpoint = `${IBGE_API.LOCALIDADES}/estados/${ufCode}/municipios`;
    }
  }

  const key = cacheKey("municipios", { uf: uf || "all" });
  const municipios = await cachedFetch<MunicipioSimples[]>(endpoint, key, CACHE_TTL.STATIC);

  const matches = municipios
    .filter((m) => m.nome.toLowerCase().includes(nomeNormalized))
    .slice(0, 20);

  if (matches.length === 0) {
    return (
      `Nenhuma localidade encontrada para "${nome}"${uf ? ` em ${uf.toUpperCase()}` : ""}.\n\n` +
      `Dicas:\n` +
      `- Verifique a grafia do nome\n` +
      `- Tente um termo mais específico\n` +
      `- Use ibge_municipios(busca="...") para busca mais detalhada`
    );
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

  return output;
}

function formatRegiaoInfo(codigo: number, regiao: { sigla: string; nome: string }): string {
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

  return output;
}

function formatEstadoInfo(
  codigo: number,
  estado: { sigla: string; nome: string; regiao: string }
): string {
  const regiaoCode = Object.entries(REGIOES_MAP).find(([, r]) => r.nome === estado.regiao)?.[0];

  let output = `## Estado: ${estado.nome}\n\n`;
  output += `**Código IBGE:** ${codigo}\n`;
  output += `**Sigla:** ${estado.sigla}\n`;
  output += `**Região:** ${estado.regiao} (código ${regiaoCode})\n\n`;

  output += `### Códigos relacionados\n\n`;
  output += `- Use ibge_municipios(uf="${estado.sigla}") para listar municípios\n`;
  output += `- Use ibge_sidra com nivel_territorial="3", localidades="${codigo}" para dados do estado\n`;

  return output;
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

// Tool definition for MCP
export const geocodigoTool = {
  name: "ibge_geocodigo",
  description: `Decodifica códigos IBGE ou busca códigos pelo nome da localidade.

Funcionalidades:
- Decodifica códigos de região, UF, município ou distrito
- Busca código IBGE pelo nome
- Mostra hierarquia geográfica completa
- Retorna códigos relacionados

Estrutura dos códigos:
- 1 dígito: Região (1-5)
- 2 dígitos: UF (11-53)
- 7 dígitos: Município
- 9 dígitos: Distrito

Exemplos:
- Decodificar município: codigo="3550308"
- Decodificar UF: codigo="35"
- Buscar por nome: nome="São Paulo"
- Buscar município em UF: nome="Campinas", uf="SP"`,
  inputSchema: geocodigoSchema,
  handler: ibgeGeocodigo,
};
