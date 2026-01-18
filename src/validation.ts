/**
 * Input validation helpers for IBGE MCP Server
 */

// Valid state codes
export const UF_CODES = new Set([
  11,
  12,
  13,
  14,
  15,
  16,
  17, // Norte
  21,
  22,
  23,
  24,
  25,
  26,
  27,
  28,
  29, // Nordeste
  31,
  32,
  33,
  35, // Sudeste
  41,
  42,
  43, // Sul
  50,
  51,
  52,
  53, // Centro-Oeste
]);

// Valid region codes
export const REGION_CODES = new Set([1, 2, 3, 4, 5]);

// State abbreviations to codes
export const UF_SIGLAS: Record<string, number> = {
  RO: 11,
  AC: 12,
  AM: 13,
  RR: 14,
  PA: 15,
  AP: 16,
  TO: 17,
  MA: 21,
  PI: 22,
  CE: 23,
  RN: 24,
  PB: 25,
  PE: 26,
  AL: 27,
  SE: 28,
  BA: 29,
  MG: 31,
  ES: 32,
  RJ: 33,
  SP: 35,
  PR: 41,
  SC: 42,
  RS: 43,
  MS: 50,
  MT: 51,
  GO: 52,
  DF: 53,
};

/**
 * Validates if a string is a valid IBGE code
 */
export function isValidIbgeCode(code: string): boolean {
  const normalized = code.replace(/\D/g, "");

  // Region (1 digit)
  if (normalized.length === 1) {
    return REGION_CODES.has(parseInt(normalized));
  }

  // State (2 digits)
  if (normalized.length === 2) {
    return UF_CODES.has(parseInt(normalized));
  }

  // Municipality (7 digits)
  if (normalized.length === 7) {
    const ufCode = parseInt(normalized.substring(0, 2));
    return UF_CODES.has(ufCode);
  }

  // District (9 digits)
  if (normalized.length === 9) {
    const ufCode = parseInt(normalized.substring(0, 2));
    return UF_CODES.has(ufCode);
  }

  return false;
}

/**
 * Normalizes a state input (code or abbreviation) to code
 */
export function normalizeUf(input: string): number | null {
  const upper = input.toUpperCase().trim();

  // Check if it's an abbreviation
  if (UF_SIGLAS[upper]) {
    return UF_SIGLAS[upper];
  }

  // Check if it's a valid code
  const code = parseInt(input);
  if (!isNaN(code) && UF_CODES.has(code)) {
    return code;
  }

  return null;
}

/**
 * Validates date format (MM-DD-YYYY)
 */
export function isValidDateFormat(date: string): boolean {
  const regex = /^\d{2}-\d{2}-\d{4}$/;
  if (!regex.test(date)) return false;

  const [month, day, year] = date.split("-").map(Number);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1970 || year > 2100) return false;

  return true;
}

/**
 * Validates period format for SIDRA
 */
export function isValidPeriod(period: string): boolean {
  // Special values
  if (["last", "all", "first"].includes(period.toLowerCase())) {
    return true;
  }

  // "last N" format
  if (/^last\s+\d+$/i.test(period)) {
    return true;
  }

  // Year format (YYYY)
  if (/^\d{4}$/.test(period)) {
    const year = parseInt(period);
    return year >= 1970 && year <= 2100;
  }

  // Year range (YYYY-YYYY)
  if (/^\d{4}-\d{4}$/.test(period)) {
    const [start, end] = period.split("-").map(Number);
    return start >= 1970 && end <= 2100 && start <= end;
  }

  // Month format (YYYYMM)
  if (/^\d{6}$/.test(period)) {
    const year = parseInt(period.substring(0, 4));
    const month = parseInt(period.substring(4, 6));
    return year >= 1970 && year <= 2100 && month >= 1 && month <= 12;
  }

  // Quarter format (YYYYQ#)
  if (/^\d{4}0[1-4]$/.test(period)) {
    const year = parseInt(period.substring(0, 4));
    return year >= 1970 && year <= 2100;
  }

  // Multiple periods separated by comma
  if (period.includes(",")) {
    return period.split(",").every((p) => isValidPeriod(p.trim()));
  }

  return false;
}

/**
 * Validates territorial level
 */
export function isValidTerritorialLevel(level: string): boolean {
  const validLevels = new Set([
    "1",
    "2",
    "3",
    "6",
    "7",
    "8",
    "9",
    "10",
    "11",
    "13",
    "14",
    "15",
    "17",
    "18",
    "105",
    "106",
    "114",
    "127",
    "128",
  ]);
  return validLevels.has(level);
}

/**
 * Parses and validates locality codes
 */
export function parseLocalidades(input: string): { valid: string[]; invalid: string[] } {
  if (input.toLowerCase() === "all") {
    return { valid: ["all"], invalid: [] };
  }

  const codes = input.split(",").map((c) => c.trim());
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const code of codes) {
    if (isValidIbgeCode(code)) {
      valid.push(code);
    } else {
      invalid.push(code);
    }
  }

  return { valid, invalid };
}

/**
 * Validates CNAE code format
 */
export function isValidCnaeCode(code: string): boolean {
  const normalized = code.replace(/[.\-/]/g, "").toUpperCase();

  // Section (1 letter A-U)
  if (/^[A-U]$/.test(normalized)) return true;

  // Division (2 digits)
  if (/^\d{2}$/.test(normalized)) return true;

  // Group (3 digits)
  if (/^\d{3}$/.test(normalized)) return true;

  // Class (4-5 digits)
  if (/^\d{4,5}$/.test(normalized)) return true;

  // Subclass (7 digits)
  if (/^\d{7}$/.test(normalized)) return true;

  return false;
}

/**
 * Formats validation error message
 */
export function formatValidationError(field: string, value: string, expected: string): string {
  return `Valor inválido para "${field}": "${value}"\n\n` + `Formato esperado: ${expected}`;
}
