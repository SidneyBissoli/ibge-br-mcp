/**
 * Centralized configuration for IBGE MCP Server
 * Contains all constants, mappings, and endpoint definitions
 */

// ============================================================================
// API Endpoints
// ============================================================================

export const API_ENDPOINTS = {
  // IBGE APIs
  IBGE: {
    LOCALIDADES: "https://servicodados.ibge.gov.br/api/v1/localidades",
    NOMES: "https://servicodados.ibge.gov.br/api/v2/censos/nomes",
    AGREGADOS: "https://servicodados.ibge.gov.br/api/v3/agregados",
    MALHAS: "https://servicodados.ibge.gov.br/api/v3/malhas",
    NOTICIAS: "https://servicodados.ibge.gov.br/api/v3/noticias",
    POPULACAO: "https://servicodados.ibge.gov.br/api/v1/projecoes/populacao",
    CNAE: "https://servicodados.ibge.gov.br/api/v2/cnae",
    CALENDARIO: "https://servicodados.ibge.gov.br/api/v3/calendario",
    PAISES: "https://servicodados.ibge.gov.br/api/v1/paises",
    PESQUISAS: "https://servicodados.ibge.gov.br/api/v1/pesquisas",
  },
  SIDRA: "https://apisidra.ibge.gov.br/values",
  // External APIs
  BCB: {
    SGS: "https://api.bcb.gov.br/dados/serie/bcdata.sgs",
    PTAX: "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata",
    EXPECTATIVAS: "https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata",
  },
} as const;

// ============================================================================
// Geographic Codes
// ============================================================================

/**
 * Brazilian states (UF) codes
 * Maps state abbreviation to IBGE code
 */
export const UF_CODES: Record<string, number> = {
  // Norte
  RO: 11,
  AC: 12,
  AM: 13,
  RR: 14,
  PA: 15,
  AP: 16,
  TO: 17,
  // Nordeste
  MA: 21,
  PI: 22,
  CE: 23,
  RN: 24,
  PB: 25,
  PE: 26,
  AL: 27,
  SE: 28,
  BA: 29,
  // Sudeste
  MG: 31,
  ES: 32,
  RJ: 33,
  SP: 35,
  // Sul
  PR: 41,
  SC: 42,
  RS: 43,
  // Centro-Oeste
  MS: 50,
  MT: 51,
  GO: 52,
  DF: 53,
};

/**
 * Reverse mapping: IBGE code to state abbreviation
 */
export const UF_SIGLAS: Record<number, string> = Object.fromEntries(
  Object.entries(UF_CODES).map(([sigla, code]) => [code, sigla])
);

/**
 * State names by abbreviation
 */
export const UF_NAMES: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AM: "Amazonas",
  AP: "Amapá",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MG: "Minas Gerais",
  MS: "Mato Grosso do Sul",
  MT: "Mato Grosso",
  PA: "Pará",
  PB: "Paraíba",
  PE: "Pernambuco",
  PI: "Piauí",
  PR: "Paraná",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RO: "Rondônia",
  RR: "Roraima",
  RS: "Rio Grande do Sul",
  SC: "Santa Catarina",
  SE: "Sergipe",
  SP: "São Paulo",
  TO: "Tocantins",
};

/**
 * Region codes
 */
export const REGION_CODES: Record<string, number> = {
  N: 1, // Norte
  NE: 2, // Nordeste
  SE: 3, // Sudeste
  S: 4, // Sul
  CO: 5, // Centro-Oeste
};

/**
 * Region names
 */
export const REGION_NAMES: Record<number, string> = {
  1: "Norte",
  2: "Nordeste",
  3: "Sudeste",
  4: "Sul",
  5: "Centro-Oeste",
};

/**
 * States by region
 */
export const STATES_BY_REGION: Record<number, string[]> = {
  1: ["RO", "AC", "AM", "RR", "PA", "AP", "TO"], // Norte
  2: ["MA", "PI", "CE", "RN", "PB", "PE", "AL", "SE", "BA"], // Nordeste
  3: ["MG", "ES", "RJ", "SP"], // Sudeste
  4: ["PR", "SC", "RS"], // Sul
  5: ["MS", "MT", "GO", "DF"], // Centro-Oeste
};

// ============================================================================
// SIDRA Territorial Levels
// ============================================================================

/**
 * SIDRA territorial level codes
 */
export const TERRITORIAL_LEVELS = {
  BRASIL: "1",
  REGIAO: "2",
  UF: "3",
  MUNICIPIO: "6",
  REGIAO_METROPOLITANA: "7",
  MESORREGIAO: "8",
  MICRORREGIAO: "9",
  DISTRITO: "10",
  SUBDISTRITO: "11",
  RM_RIDE: "13",
  RIDE: "14",
  AGLOMERACAO_URBANA: "15",
  REGIAO_IMEDIATA: "17",
  REGIAO_INTERMEDIARIA: "18",
  MACRORREGIAO_SAUDE: "105",
  REGIAO_SAUDE: "106",
  AGLOMERADO_SUBNORMAL: "114",
  AMAZONIA_LEGAL: "127",
  SEMIARIDO: "128",
} as const;

/**
 * Territorial level names (for display)
 */
export const TERRITORIAL_LEVEL_NAMES: Record<string, string> = {
  "1": "Brasil",
  "2": "Grande Região",
  "3": "Unidade da Federação",
  "6": "Município",
  "7": "Região Metropolitana",
  "8": "Mesorregião",
  "9": "Microrregião",
  "10": "Distrito",
  "11": "Subdistrito",
  "13": "Região Metropolitana/RIDE",
  "14": "RIDE",
  "15": "Aglomeração Urbana",
  "17": "Região Geográfica Imediata",
  "18": "Região Geográfica Intermediária",
  "105": "Macrorregião de Saúde",
  "106": "Região de Saúde",
  "114": "Aglomerado Subnormal",
  "127": "Amazônia Legal",
  "128": "Semiárido",
};

// ============================================================================
// Biome Codes
// ============================================================================

export const BIOME_CODES: Record<string, number> = {
  AMAZONIA: 1,
  CERRADO: 2,
  MATA_ATLANTICA: 3,
  CAATINGA: 4,
  PAMPA: 5,
  PANTANAL: 6,
};

export const BIOME_NAMES: Record<number, string> = {
  1: "Amazônia",
  2: "Cerrado",
  3: "Mata Atlântica",
  4: "Caatinga",
  5: "Pampa",
  6: "Pantanal",
};

// ============================================================================
// Common SIDRA Tables
// ============================================================================

/**
 * Commonly used SIDRA table codes with descriptions
 */
export const SIDRA_TABLES = {
  // Population
  POPULACAO_ESTIMATIVA: "6579",
  POPULACAO_CENSO_2022: "9514",
  POPULACAO_CENSOS_HISTORICO: "200",
  // Economy
  PIB_CORRENTE: "6706",
  PIB_PER_CAPITA: "5938",
  AREA_TERRITORIAL: "1705",
  DENSIDADE_DEMOGRAFICA: "1712",
  // Labor
  TAXA_DESOCUPACAO: "4714",
  RENDIMENTO_MEDIO: "6381",
  // Prices
  IPCA_MENSAL: "1737",
  IPCA_ACUMULADO: "1736",
  // Census themes
  ALFABETIZACAO: "4312",
  DOMICILIOS: "4311",
} as const;

// ============================================================================
// Validation Patterns
// ============================================================================

/**
 * Regex patterns for validation
 */
export const VALIDATION_PATTERNS = {
  IBGE_CODE_MUNICIPIO: /^\d{7}$/,
  IBGE_CODE_UF: /^\d{2}$/,
  IBGE_CODE_REGIAO: /^\d{1}$/,
  IBGE_CODE_DISTRITO: /^\d{9}$/,
  DATE_BR: /^\d{2}\/\d{2}\/\d{4}$/,
  DATE_IBGE: /^\d{2}-\d{2}-\d{4}$/,
  DATE_ISO: /^\d{4}-\d{2}-\d{2}$/,
  CNAE_CODE: /^\d{4}-?\d?\/?\d{0,2}$/,
} as const;

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULTS = {
  PAGINATION: {
    PAGE: 1,
    PAGE_SIZE: 20,
    MAX_PAGE_SIZE: 100,
  },
  CACHE_TTL: {
    STATIC: 60 * 24, // 24 hours
    MEDIUM: 60, // 1 hour
    SHORT: 15, // 15 minutes
    REALTIME: 1, // 1 minute
  },
  QUALITY: {
    MESH_QUALITY: "4",
    MESH_RESOLUTION: "0",
  },
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a string is a valid UF code
 */
export function isValidUf(uf: string): boolean {
  return uf.toUpperCase() in UF_CODES;
}

/**
 * Get UF code from abbreviation
 */
export function getUfCode(uf: string): number | undefined {
  return UF_CODES[uf.toUpperCase()];
}

/**
 * Get UF abbreviation from code
 */
export function getUfSigla(code: number): string | undefined {
  return UF_SIGLAS[code];
}

/**
 * Get region code from state abbreviation
 */
export function getRegionFromUf(uf: string): number | undefined {
  const ufUpper = uf.toUpperCase();
  for (const [regionCode, states] of Object.entries(STATES_BY_REGION)) {
    if (states.includes(ufUpper)) {
      return parseInt(regionCode);
    }
  }
  return undefined;
}

/**
 * Validate IBGE code by length
 */
export function validateIbgeCode(code: string): {
  valid: boolean;
  type?: "regiao" | "uf" | "municipio" | "distrito";
  message?: string;
} {
  const cleaned = code.replace(/\D/g, "");

  if (cleaned.length === 1 && /^[1-5]$/.test(cleaned)) {
    return { valid: true, type: "regiao" };
  }
  if (cleaned.length === 2 && VALIDATION_PATTERNS.IBGE_CODE_UF.test(cleaned)) {
    return { valid: true, type: "uf" };
  }
  if (cleaned.length === 7 && VALIDATION_PATTERNS.IBGE_CODE_MUNICIPIO.test(cleaned)) {
    return { valid: true, type: "municipio" };
  }
  if (cleaned.length === 9 && VALIDATION_PATTERNS.IBGE_CODE_DISTRITO.test(cleaned)) {
    return { valid: true, type: "distrito" };
  }

  return {
    valid: false,
    message: `Código IBGE inválido: ${code}. Use 1 dígito (região), 2 dígitos (UF), 7 dígitos (município) ou 9 dígitos (distrito).`,
  };
}
