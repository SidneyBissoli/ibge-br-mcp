import { describe, it, expect } from "vitest";
import {
  formatError,
  parseHttpError,
  ValidationErrors,
  timeoutError,
  networkError,
  IBGE_ERROR_CODES,
} from "../src/errors.js";

describe("IBGE_ERROR_CODES", () => {
  it("should have definitions for common HTTP errors", () => {
    expect(IBGE_ERROR_CODES[400]).toBeDefined();
    expect(IBGE_ERROR_CODES[404]).toBeDefined();
    expect(IBGE_ERROR_CODES[500]).toBeDefined();
    expect(IBGE_ERROR_CODES[502]).toBeDefined();
    expect(IBGE_ERROR_CODES[503]).toBeDefined();
  });

  it("should have message and suggestion for each error", () => {
    Object.values(IBGE_ERROR_CODES).forEach((errorInfo) => {
      expect(errorInfo.message).toBeTruthy();
      expect(errorInfo.suggestion).toBeTruthy();
    });
  });
});

describe("formatError", () => {
  it("should format error with tool name", () => {
    const result = formatError({
      message: "Test error",
      tool: "ibge_test",
    });

    expect(result).toContain("## Erro: ibge_test");
    expect(result).toContain("Test error");
  });

  it("should include HTTP code when provided", () => {
    const result = formatError({
      code: 404,
      message: "Not found",
      tool: "ibge_test",
    });

    expect(result).toContain("**Código HTTP:** 404");
  });

  it("should use IBGE error message for known codes", () => {
    const result = formatError({
      code: 404,
      message: "Custom message",
      tool: "ibge_test",
    });

    expect(result).toContain(IBGE_ERROR_CODES[404].message);
  });

  it("should include parameters when provided", () => {
    const result = formatError({
      message: "Error",
      tool: "ibge_test",
      params: {
        codigo: "123",
        uf: "SP",
      },
    });

    expect(result).toContain("### Parâmetros utilizados");
    expect(result).toContain("**codigo:** 123");
    expect(result).toContain("**uf:** SP");
  });

  it("should not include undefined parameters", () => {
    const result = formatError({
      message: "Error",
      tool: "ibge_test",
      params: {
        defined: "value",
        undefined: undefined,
      },
    });

    expect(result).toContain("**defined:** value");
    expect(result).not.toContain("**undefined:**");
  });

  it("should include custom suggestion", () => {
    const result = formatError({
      message: "Error",
      tool: "ibge_test",
      suggestion: "Try this instead",
    });

    expect(result).toContain("### Sugestão");
    expect(result).toContain("Try this instead");
  });

  it("should include related tools", () => {
    const result = formatError({
      message: "Error",
      tool: "ibge_test",
      relatedTools: ["ibge_municipios", "ibge_estados"],
    });

    expect(result).toContain("### Ferramentas relacionadas");
    expect(result).toContain("`ibge_municipios`");
    expect(result).toContain("`ibge_estados`");
  });
});

describe("parseHttpError", () => {
  it("should extract HTTP code from error message", () => {
    const error = new Error("HTTP 404: Not Found");
    const result = parseHttpError(error, "ibge_test");

    expect(result).toContain("**Código HTTP:** 404");
  });

  it("should handle errors without HTTP code", () => {
    const error = new Error("Network failed");
    const result = parseHttpError(error, "ibge_test");

    expect(result).toContain("## Erro: ibge_test");
    expect(result).toContain("Network failed");
    expect(result).not.toContain("**Código HTTP:**");
  });

  it("should include params and related tools", () => {
    const error = new Error("HTTP 500: Internal Server Error");
    const result = parseHttpError(
      error,
      "ibge_sidra",
      { tabela: "6579" },
      ["ibge_sidra_metadados"]
    );

    expect(result).toContain("**tabela:** 6579");
    expect(result).toContain("`ibge_sidra_metadados`");
  });
});

describe("ValidationErrors", () => {
  describe("invalidCode", () => {
    it("should format invalid code error", () => {
      const result = ValidationErrors.invalidCode(
        "abc123",
        "ibge_localidade",
        "7 dígitos para município"
      );

      expect(result).toContain("Código inválido");
      expect(result).toContain("abc123");
      expect(result).toContain("7 dígitos para município");
    });
  });

  describe("notFound", () => {
    it("should format not found error", () => {
      const result = ValidationErrors.notFound(
        "Município com código 1234567",
        "ibge_localidade"
      );

      expect(result).toContain("não encontrado");
      expect(result).toContain("Município com código 1234567");
    });

    it("should suggest search tool when provided", () => {
      const result = ValidationErrors.notFound(
        "Município",
        "ibge_localidade",
        "ibge_municipios"
      );

      expect(result).toContain("ibge_municipios");
    });
  });

  describe("emptyResult", () => {
    it("should format empty result error", () => {
      const result = ValidationErrors.emptyResult("ibge_sidra");

      expect(result).toContain("Nenhum dado encontrado");
    });

    it("should include custom suggestion", () => {
      const result = ValidationErrors.emptyResult(
        "ibge_sidra",
        "Verifique os parâmetros"
      );

      expect(result).toContain("Verifique os parâmetros");
    });
  });

  describe("invalidPeriod", () => {
    it("should format invalid period error", () => {
      const result = ValidationErrors.invalidPeriod("invalid", "ibge_sidra");

      expect(result).toContain("Período inválido");
      expect(result).toContain("invalid");
    });

    it("should include valid periods when provided", () => {
      const result = ValidationErrors.invalidPeriod(
        "invalid",
        "ibge_sidra",
        "2020, 2021, 2022"
      );

      expect(result).toContain("2020, 2021, 2022");
    });
  });

  describe("invalidTerritory", () => {
    it("should format invalid territory error", () => {
      const result = ValidationErrors.invalidTerritory("99", "ibge_sidra");

      expect(result).toContain("Nível territorial inválido");
      expect(result).toContain("99");
      expect(result).toContain("1 (Brasil)");
    });
  });
});

describe("timeoutError", () => {
  it("should format timeout error", () => {
    const result = timeoutError("ibge_sidra", 30000);

    expect(result).toContain("## Erro: ibge_sidra");
    expect(result).toContain("Tempo de resposta excedido");
    expect(result).toContain("30 segundos");
  });
});

describe("networkError", () => {
  it("should format network error", () => {
    const result = networkError("ibge_populacao");

    expect(result).toContain("## Erro: ibge_populacao");
    expect(result).toContain("Erro de conexão");
    expect(result).toContain("API do IBGE");
  });
});
