import { describe, it, expect } from "vitest";
import {
  formatNumber,
  formatPercent,
  formatCurrency,
  parseNumber,
  createMarkdownTable,
  createKeyValueTable,
  buildQueryString,
  decodeHtmlEntities,
  truncate,
  normalizeText,
  formatHeader,
} from "../src/utils/formatters.js";

describe("formatNumber", () => {
  it("should format numbers with Brazilian locale by default", () => {
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatNumber(1000)).toBe("1.000");
  });

  it("should return '-' for NaN, null, or undefined", () => {
    expect(formatNumber(NaN)).toBe("-");
    expect(formatNumber(null as unknown as number)).toBe("-");
    expect(formatNumber(undefined as unknown as number)).toBe("-");
  });

  it("should handle decimal places", () => {
    const result = formatNumber(1234.567, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    expect(result).toBe("1.234,57");
  });

  describe("compact formatting", () => {
    it("should format billions", () => {
      const result = formatNumber(1500000000, { compact: true });
      expect(result).toContain("bi");
    });

    it("should format millions", () => {
      const result = formatNumber(1500000, { compact: true });
      expect(result).toContain("mi");
    });

    it("should format thousands", () => {
      const result = formatNumber(1500, { compact: true });
      expect(result).toContain("mil");
    });

    it("should not compact small numbers", () => {
      const result = formatNumber(999, { compact: true });
      expect(result).not.toContain("mil");
      expect(result).not.toContain("mi");
    });
  });
});

describe("formatPercent", () => {
  it("should format percentages", () => {
    expect(formatPercent(12.345)).toBe("12,35%");
    expect(formatPercent(0.5)).toBe("0,50%");
  });

  it("should return '-' for NaN", () => {
    expect(formatPercent(NaN)).toBe("-");
  });

  it("should handle custom decimal places", () => {
    expect(formatPercent(12.345, { decimals: 1 })).toBe("12,3%");
    expect(formatPercent(12.345, { decimals: 0 })).toBe("12%");
  });

  it("should show sign when requested", () => {
    expect(formatPercent(5, { showSign: true })).toBe("+5,00%");
    expect(formatPercent(-5, { showSign: true })).toBe("-5,00%");
    expect(formatPercent(0, { showSign: true })).toBe("0,00%"); // 0 doesn't get +
  });
});

describe("formatCurrency", () => {
  it("should format currency with symbol by default", () => {
    expect(formatCurrency(1234.56)).toBe("R$ 1.234,56");
  });

  it("should return '-' for NaN", () => {
    expect(formatCurrency(NaN)).toBe("-");
  });

  it("should hide symbol when requested", () => {
    expect(formatCurrency(1234.56, { showSymbol: false })).toBe("1.234,56");
  });

  it("should handle custom decimal places", () => {
    expect(formatCurrency(1234, { decimals: 0 })).toBe("R$ 1.234");
  });
});

describe("parseNumber", () => {
  it("should return number if already a number", () => {
    expect(parseNumber(123)).toBe(123);
    expect(parseNumber(0)).toBe(0);
  });

  it("should parse Brazilian format", () => {
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("1.234.567,89")).toBe(1234567.89);
  });

  it("should return NaN for invalid values", () => {
    expect(parseNumber("-")).toBeNaN();
    expect(parseNumber("...")).toBeNaN();
    expect(parseNumber("")).toBeNaN();
  });
});

describe("createMarkdownTable", () => {
  it("should create a valid markdown table", () => {
    const headers = ["Name", "Value"];
    const rows = [
      ["A", "1"],
      ["B", "2"],
    ];
    const result = createMarkdownTable(headers, rows);

    expect(result).toContain("| Name | Value |");
    expect(result).toContain("|:---|:---|");
    expect(result).toContain("| A | 1 |");
    expect(result).toContain("| B | 2 |");
  });

  it("should return placeholder for empty data", () => {
    expect(createMarkdownTable([], [])).toBe("_Sem dados disponíveis._\n");
    expect(createMarkdownTable(["A"], [])).toBe("_Sem dados disponíveis._\n");
  });

  it("should handle column alignment", () => {
    const headers = ["Left", "Center", "Right"];
    const rows = [["a", "b", "c"]];
    const result = createMarkdownTable(headers, rows, {
      alignment: ["left", "center", "right"],
    });

    expect(result).toContain("|:---|:---:|---:|");
  });

  it("should limit rows when maxRows is set", () => {
    const headers = ["Value"];
    const rows = [["1"], ["2"], ["3"], ["4"], ["5"]];
    const result = createMarkdownTable(headers, rows, { maxRows: 3 });

    expect(result).toContain("| 1 |");
    expect(result).toContain("| 2 |");
    expect(result).toContain("| 3 |");
    expect(result).not.toContain("| 4 |");
    expect(result).toContain("Mostrando 3 de 5 registros");
  });

  it("should handle null and undefined values", () => {
    const headers = ["Value"];
    const rows = [[null], [undefined]];
    const result = createMarkdownTable(headers, rows as unknown as string[][]);

    expect(result).toContain("| - |");
  });
});

describe("createKeyValueTable", () => {
  it("should create a two-column table", () => {
    const data = {
      "**Name**": "Test",
      "**Value**": "123",
    };
    const result = createKeyValueTable(data);

    expect(result).toContain("| Campo | Valor |");
    expect(result).toContain("| **Name** | Test |");
    expect(result).toContain("| **Value** | 123 |");
  });

  it("should filter out undefined values", () => {
    const data = {
      "**Name**": "Test",
      "**Optional**": undefined,
    };
    const result = createKeyValueTable(data);

    expect(result).toContain("| **Name** | Test |");
    expect(result).not.toContain("**Optional**");
  });

  it("should use custom headers", () => {
    const result = createKeyValueTable(
      { key: "value" },
      { keyHeader: "Chave", valueHeader: "Dados" }
    );

    expect(result).toContain("| Chave | Dados |");
  });
});

describe("buildQueryString", () => {
  it("should build query string from object", () => {
    const params = { a: "1", b: "2" };
    const result = buildQueryString(params);
    expect(result).toBe("a=1&b=2");
  });

  it("should handle numbers and booleans", () => {
    const params = { num: 42, bool: true };
    const result = buildQueryString(params);
    expect(result).toBe("num=42&bool=true");
  });

  it("should filter out null and undefined", () => {
    const params = { a: "1", b: null, c: undefined, d: "2" };
    const result = buildQueryString(params);
    expect(result).toBe("a=1&d=2");
  });

  it("should filter out empty strings", () => {
    const params = { a: "1", b: "", c: "2" };
    const result = buildQueryString(params);
    expect(result).toBe("a=1&c=2");
  });

  it("should URL-encode special characters", () => {
    const params = { q: "hello world" };
    const result = buildQueryString(params);
    expect(result).toBe("q=hello+world");
  });
});

describe("decodeHtmlEntities", () => {
  it("should decode named entities", () => {
    expect(decodeHtmlEntities("&amp;")).toBe("&");
    expect(decodeHtmlEntities("&lt;")).toBe("<");
    expect(decodeHtmlEntities("&gt;")).toBe(">");
    expect(decodeHtmlEntities("&quot;")).toBe('"');
    // Note: &nbsp; alone becomes empty after trim(), test within context
    expect(decodeHtmlEntities("hello&nbsp;world")).toBe("hello world");
  });

  it("should decode numeric entities", () => {
    expect(decodeHtmlEntities("&#65;")).toBe("A");
    expect(decodeHtmlEntities("&#97;")).toBe("a");
  });

  it("should remove HTML tags", () => {
    expect(decodeHtmlEntities("<p>Hello</p>")).toBe("Hello");
    expect(decodeHtmlEntities("<strong>Bold</strong>")).toBe("Bold");
  });

  it("should handle empty or null input", () => {
    expect(decodeHtmlEntities("")).toBe("");
    expect(decodeHtmlEntities(null as unknown as string)).toBe("");
  });

  it("should handle complex strings", () => {
    const input = "<p>Hello &amp; World</p>";
    expect(decodeHtmlEntities(input)).toBe("Hello & World");
  });
});

describe("truncate", () => {
  it("should truncate long strings", () => {
    expect(truncate("Hello World", 8)).toBe("Hello...");
  });

  it("should not truncate short strings", () => {
    expect(truncate("Hello", 10)).toBe("Hello");
  });

  it("should handle exact length", () => {
    expect(truncate("Hello", 5)).toBe("Hello");
  });

  it("should handle empty or null input", () => {
    expect(truncate("", 10)).toBe("");
    expect(truncate(null as unknown as string, 10)).toBeFalsy();
  });
});

describe("normalizeText", () => {
  it("should convert to lowercase", () => {
    expect(normalizeText("HELLO")).toBe("hello");
  });

  it("should remove accents", () => {
    expect(normalizeText("São Paulo")).toBe("sao paulo");
    expect(normalizeText("Ação")).toBe("acao");
    expect(normalizeText("café")).toBe("cafe");
  });

  it("should trim whitespace", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });

  it("should handle combined transformations", () => {
    expect(normalizeText("  SÃO PAULO  ")).toBe("sao paulo");
  });
});

describe("formatHeader", () => {
  it("should create level 2 header by default", () => {
    expect(formatHeader("Title")).toBe("## Title\n\n");
  });

  it("should create headers of different levels", () => {
    expect(formatHeader("Title", 1)).toBe("# Title\n\n");
    expect(formatHeader("Title", 2)).toBe("## Title\n\n");
    expect(formatHeader("Title", 3)).toBe("### Title\n\n");
    expect(formatHeader("Title", 4)).toBe("#### Title\n\n");
  });
});
