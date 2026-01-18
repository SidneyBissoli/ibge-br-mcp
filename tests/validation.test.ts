import { describe, it, expect } from "vitest";
import {
  isValidIbgeCode,
  normalizeUf,
  isValidDateFormat,
  isValidPeriod,
  isValidTerritorialLevel,
  parseLocalidades,
  isValidCnaeCode,
  formatValidationError,
  UF_CODES,
  REGION_CODES,
  UF_SIGLAS,
} from "../src/validation.js";

describe("isValidIbgeCode", () => {
  describe("region codes (1 digit)", () => {
    it("should accept valid region codes", () => {
      expect(isValidIbgeCode("1")).toBe(true);
      expect(isValidIbgeCode("2")).toBe(true);
      expect(isValidIbgeCode("3")).toBe(true);
      expect(isValidIbgeCode("4")).toBe(true);
      expect(isValidIbgeCode("5")).toBe(true);
    });

    it("should reject invalid region codes", () => {
      expect(isValidIbgeCode("0")).toBe(false);
      expect(isValidIbgeCode("6")).toBe(false);
      expect(isValidIbgeCode("9")).toBe(false);
    });
  });

  describe("state codes (2 digits)", () => {
    it("should accept valid state codes", () => {
      expect(isValidIbgeCode("35")).toBe(true); // SP
      expect(isValidIbgeCode("33")).toBe(true); // RJ
      expect(isValidIbgeCode("31")).toBe(true); // MG
      expect(isValidIbgeCode("11")).toBe(true); // RO
      expect(isValidIbgeCode("53")).toBe(true); // DF
    });

    it("should reject invalid state codes", () => {
      expect(isValidIbgeCode("00")).toBe(false);
      expect(isValidIbgeCode("99")).toBe(false);
      expect(isValidIbgeCode("10")).toBe(false);
      expect(isValidIbgeCode("20")).toBe(false);
    });
  });

  describe("municipality codes (7 digits)", () => {
    it("should accept valid municipality codes", () => {
      expect(isValidIbgeCode("3550308")).toBe(true); // São Paulo
      expect(isValidIbgeCode("3304557")).toBe(true); // Rio de Janeiro
      expect(isValidIbgeCode("1100205")).toBe(true); // Porto Velho
    });

    it("should reject invalid municipality codes", () => {
      expect(isValidIbgeCode("0000000")).toBe(false);
      expect(isValidIbgeCode("9900000")).toBe(false);
      expect(isValidIbgeCode("1000000")).toBe(false);
    });
  });

  describe("district codes (9 digits)", () => {
    it("should accept valid district codes", () => {
      expect(isValidIbgeCode("355030805")).toBe(true);
      expect(isValidIbgeCode("330455701")).toBe(true);
    });

    it("should reject invalid district codes", () => {
      expect(isValidIbgeCode("000000000")).toBe(false);
      expect(isValidIbgeCode("990000000")).toBe(false);
    });
  });

  describe("invalid lengths", () => {
    it("should reject codes with invalid lengths", () => {
      expect(isValidIbgeCode("")).toBe(false);
      expect(isValidIbgeCode("123")).toBe(false);
      expect(isValidIbgeCode("12345")).toBe(false);
      expect(isValidIbgeCode("12345678")).toBe(false);
      expect(isValidIbgeCode("1234567890")).toBe(false);
    });
  });
});

describe("normalizeUf", () => {
  it("should convert state abbreviations to codes", () => {
    expect(normalizeUf("SP")).toBe(35);
    expect(normalizeUf("RJ")).toBe(33);
    expect(normalizeUf("MG")).toBe(31);
    expect(normalizeUf("DF")).toBe(53);
  });

  it("should handle lowercase abbreviations", () => {
    expect(normalizeUf("sp")).toBe(35);
    expect(normalizeUf("rj")).toBe(33);
  });

  it("should handle mixed case abbreviations", () => {
    expect(normalizeUf("Sp")).toBe(35);
    expect(normalizeUf("sP")).toBe(35);
  });

  it("should handle numeric codes as strings", () => {
    expect(normalizeUf("35")).toBe(35);
    expect(normalizeUf("33")).toBe(33);
  });

  it("should return null for invalid inputs", () => {
    expect(normalizeUf("XX")).toBe(null);
    expect(normalizeUf("99")).toBe(null);
    expect(normalizeUf("")).toBe(null);
    expect(normalizeUf("invalid")).toBe(null);
  });

  it("should handle whitespace", () => {
    expect(normalizeUf(" SP ")).toBe(35);
    expect(normalizeUf("  RJ")).toBe(33);
  });
});

describe("isValidDateFormat", () => {
  it("should accept valid MM-DD-YYYY dates", () => {
    expect(isValidDateFormat("01-15-2024")).toBe(true);
    expect(isValidDateFormat("12-31-2023")).toBe(true);
    expect(isValidDateFormat("06-01-2000")).toBe(true);
  });

  it("should reject invalid month values", () => {
    expect(isValidDateFormat("00-15-2024")).toBe(false);
    expect(isValidDateFormat("13-15-2024")).toBe(false);
    expect(isValidDateFormat("99-15-2024")).toBe(false);
  });

  it("should reject invalid day values", () => {
    expect(isValidDateFormat("01-00-2024")).toBe(false);
    expect(isValidDateFormat("01-32-2024")).toBe(false);
    expect(isValidDateFormat("01-99-2024")).toBe(false);
  });

  it("should reject invalid year values", () => {
    expect(isValidDateFormat("01-15-1969")).toBe(false);
    expect(isValidDateFormat("01-15-2101")).toBe(false);
  });

  it("should reject invalid formats", () => {
    expect(isValidDateFormat("2024-01-15")).toBe(false);
    expect(isValidDateFormat("15/01/2024")).toBe(false);
    expect(isValidDateFormat("01/15/2024")).toBe(false);
    expect(isValidDateFormat("invalid")).toBe(false);
  });
});

describe("isValidPeriod", () => {
  describe("special values", () => {
    it("should accept 'last', 'all', 'first'", () => {
      expect(isValidPeriod("last")).toBe(true);
      expect(isValidPeriod("all")).toBe(true);
      expect(isValidPeriod("first")).toBe(true);
      expect(isValidPeriod("LAST")).toBe(true);
      expect(isValidPeriod("ALL")).toBe(true);
    });
  });

  describe("'last N' format", () => {
    it("should accept 'last N' format", () => {
      expect(isValidPeriod("last 5")).toBe(true);
      expect(isValidPeriod("last 10")).toBe(true);
      expect(isValidPeriod("LAST 3")).toBe(true);
    });
  });

  describe("year format (YYYY)", () => {
    it("should accept valid years", () => {
      expect(isValidPeriod("2020")).toBe(true);
      expect(isValidPeriod("2024")).toBe(true);
      expect(isValidPeriod("1970")).toBe(true);
      expect(isValidPeriod("2100")).toBe(true);
    });

    it("should reject invalid years", () => {
      expect(isValidPeriod("1969")).toBe(false);
      expect(isValidPeriod("2101")).toBe(false);
      expect(isValidPeriod("0000")).toBe(false);
    });
  });

  describe("year range (YYYY-YYYY)", () => {
    it("should accept valid year ranges", () => {
      expect(isValidPeriod("2020-2024")).toBe(true);
      expect(isValidPeriod("1970-2100")).toBe(true);
      expect(isValidPeriod("2000-2000")).toBe(true);
    });

    it("should reject invalid year ranges", () => {
      expect(isValidPeriod("2024-2020")).toBe(false); // end before start
      expect(isValidPeriod("1969-2020")).toBe(false); // invalid start
      expect(isValidPeriod("2020-2101")).toBe(false); // invalid end
    });
  });

  describe("month format (YYYYMM)", () => {
    it("should accept valid months", () => {
      expect(isValidPeriod("202401")).toBe(true);
      expect(isValidPeriod("202012")).toBe(true);
      expect(isValidPeriod("197001")).toBe(true);
    });

    it("should reject invalid months", () => {
      expect(isValidPeriod("202400")).toBe(false); // month 00
      expect(isValidPeriod("202413")).toBe(false); // month 13
    });
  });

  describe("quarter format (YYYYQ#)", () => {
    it("should accept valid quarters", () => {
      expect(isValidPeriod("202001")).toBe(true); // Q1
      expect(isValidPeriod("202002")).toBe(true); // Q2
      expect(isValidPeriod("202003")).toBe(true); // Q3
      expect(isValidPeriod("202004")).toBe(true); // Q4
    });
  });

  describe("multiple periods", () => {
    it("should accept comma-separated periods", () => {
      expect(isValidPeriod("2020,2021,2022")).toBe(true);
      expect(isValidPeriod("last,2020")).toBe(true);
    });

    it("should reject if any period is invalid", () => {
      expect(isValidPeriod("2020,invalid")).toBe(false);
      expect(isValidPeriod("2020,1969")).toBe(false);
    });
  });
});

describe("isValidTerritorialLevel", () => {
  it("should accept valid territorial levels", () => {
    expect(isValidTerritorialLevel("1")).toBe(true); // Brasil
    expect(isValidTerritorialLevel("2")).toBe(true); // Região
    expect(isValidTerritorialLevel("3")).toBe(true); // UF
    expect(isValidTerritorialLevel("6")).toBe(true); // Município
    expect(isValidTerritorialLevel("106")).toBe(true); // Região de Saúde
  });

  it("should reject invalid territorial levels", () => {
    expect(isValidTerritorialLevel("0")).toBe(false);
    expect(isValidTerritorialLevel("4")).toBe(false);
    expect(isValidTerritorialLevel("5")).toBe(false);
    expect(isValidTerritorialLevel("12")).toBe(false);
    expect(isValidTerritorialLevel("100")).toBe(false);
    expect(isValidTerritorialLevel("invalid")).toBe(false);
  });
});

describe("parseLocalidades", () => {
  it("should handle 'all' value", () => {
    const result = parseLocalidades("all");
    expect(result.valid).toEqual(["all"]);
    expect(result.invalid).toEqual([]);
  });

  it("should parse valid codes", () => {
    const result = parseLocalidades("35,33");
    expect(result.valid).toEqual(["35", "33"]);
    expect(result.invalid).toEqual([]);
  });

  it("should separate valid and invalid codes", () => {
    const result = parseLocalidades("35,99,33");
    expect(result.valid).toEqual(["35", "33"]);
    expect(result.invalid).toEqual(["99"]);
  });

  it("should handle whitespace", () => {
    const result = parseLocalidades("35 , 33 , 31");
    expect(result.valid).toEqual(["35", "33", "31"]);
    expect(result.invalid).toEqual([]);
  });
});

describe("isValidCnaeCode", () => {
  describe("section codes (A-U)", () => {
    it("should accept valid section codes", () => {
      expect(isValidCnaeCode("A")).toBe(true);
      expect(isValidCnaeCode("J")).toBe(true);
      expect(isValidCnaeCode("U")).toBe(true);
      expect(isValidCnaeCode("a")).toBe(true); // lowercase
    });

    it("should reject invalid section codes", () => {
      expect(isValidCnaeCode("V")).toBe(false);
      expect(isValidCnaeCode("Z")).toBe(false);
    });
  });

  describe("division codes (2 digits)", () => {
    it("should accept valid division codes", () => {
      expect(isValidCnaeCode("01")).toBe(true);
      expect(isValidCnaeCode("62")).toBe(true);
      expect(isValidCnaeCode("99")).toBe(true);
    });
  });

  describe("group codes (3 digits)", () => {
    it("should accept valid group codes", () => {
      expect(isValidCnaeCode("620")).toBe(true);
      expect(isValidCnaeCode("011")).toBe(true);
    });
  });

  describe("class codes (4-5 digits)", () => {
    it("should accept valid class codes", () => {
      expect(isValidCnaeCode("6201")).toBe(true);
      expect(isValidCnaeCode("62015")).toBe(true);
    });
  });

  describe("subclass codes (7 digits)", () => {
    it("should accept valid subclass codes", () => {
      expect(isValidCnaeCode("6201501")).toBe(true);
    });

    it("should handle formatted codes", () => {
      expect(isValidCnaeCode("6201-5/01")).toBe(true);
      expect(isValidCnaeCode("62.01-5/01")).toBe(true);
    });
  });

  describe("invalid codes", () => {
    it("should reject invalid codes", () => {
      expect(isValidCnaeCode("")).toBe(false);
      expect(isValidCnaeCode("1")).toBe(false); // too short
      expect(isValidCnaeCode("123456")).toBe(false); // 6 digits
      expect(isValidCnaeCode("12345678")).toBe(false); // 8 digits
    });
  });
});

describe("formatValidationError", () => {
  it("should format validation error message", () => {
    const result = formatValidationError("codigo", "invalid", "Código válido");
    expect(result).toContain('Valor inválido para "codigo"');
    expect(result).toContain('"invalid"');
    expect(result).toContain("Formato esperado: Código válido");
  });
});

describe("constants", () => {
  it("UF_CODES should contain all 27 states", () => {
    expect(UF_CODES.size).toBe(27);
  });

  it("REGION_CODES should contain 5 regions", () => {
    expect(REGION_CODES.size).toBe(5);
  });

  it("UF_SIGLAS should map all 27 state abbreviations", () => {
    expect(Object.keys(UF_SIGLAS).length).toBe(27);
  });
});
