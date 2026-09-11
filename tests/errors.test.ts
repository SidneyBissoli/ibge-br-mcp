import { describe, it, expect } from "vitest";
import {
  formatError,
  parseHttpError,
  ValidationErrors,
  timeoutError,
  networkError,
  IBGE_ERROR_CODES,
} from "../src/errors.js";
import { TimeoutError, UpstreamError, motivoUpstream } from "../src/retry.js";

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

  it("should render a dedicated timeout message for a TimeoutError", () => {
    const result = parseHttpError(new TimeoutError(30000), "ibge_sidra", undefined, [
      "ibge_censo",
    ]);

    expect(result).toContain("Tempo de resposta excedido");
    expect(result).toContain("30 segundos");
    expect(result).toContain("`ibge_censo`");
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
    const result = networkError("ibge_censo");

    expect(result).toContain("## Erro: ibge_censo");
    expect(result).toContain("Erro de conexão");
    expect(result).toContain("API do IBGE");
  });
});

// A frase que a FONTE respondeu é a única coisa acionável num 400 do SIDRA, e
// até 11/09/2026 ela era descartada no `cachedFetch`: o chamador lia
// "Parâmetros inválidos. Verifique se os parâmetros estão no formato correto",
// que não diz QUAL parâmetro nem por quê, e só podia tentar outra combinação.
// Reproduzido ao vivo contra apisidra em 11/09/2026 — toda chamada malformada
// responde 400 com uma frase que resolve o caso sozinha.
describe("UpstreamError — o que a fonte respondeu chega a quem chamou", () => {
  const resposta = (corpo: string, tipo = "text/plain"): Response =>
    new Response(corpo, { status: 400, statusText: "Bad Request", headers: { "content-type": tipo } });

  it("carries the source sentence into the rendered error", async () => {
    const detalhe = await motivoUpstream(
      resposta("Parâmetro N3 (Nível territorial) incompatível com a tabela")
    );
    const out = parseHttpError(
      new UpstreamError(400, "Bad Request", detalhe),
      "ibge_sidra",
      { tabela: "1846", nivel_territorial: "3" },
      ["ibge_sidra_metadados"]
    );

    expect(out).toContain("**Código HTTP:** 400");
    expect(out).toContain("Parâmetros inválidos");
    expect(out).toContain("Resposta da fonte:");
    expect(out).toContain("Parâmetro N3 (Nível territorial) incompatível com a tabela");
  });

  // A `message` tem de continuar começando por "HTTP <código>": é por ela que
  // `parseHttpError` acha o código, e mudar a forma quebraria em silêncio.
  it("keeps the HTTP code readable from the message", () => {
    const e = new UpstreamError(404, "Not Found", "Tabela 99999: Tabela inválida");
    expect(e.message).toMatch(/^HTTP 404: Not Found/);
    expect(parseHttpError(e, "ibge_sidra")).toContain("**Código HTTP:** 404");
  });

  it("pulls the sentence out of a JSON error body", async () => {
    const detalhe = await motivoUpstream(
      resposta(JSON.stringify({ message: "Código de município inexistente" }), "application/json")
    );
    expect(detalhe).toBe("Código de município inexistente");
  });

  // Página de erro de borda não ensina nada e vem em quilobytes.
  it("drops an HTML error page instead of pasting it", async () => {
    expect(await motivoUpstream(resposta("<html><body>502 Bad Gateway</body></html>", "text/html"))).toBeUndefined();
  });

  it("drops an empty body, and the error renders without the line", async () => {
    expect(await motivoUpstream(resposta("   "))).toBeUndefined();
    expect(parseHttpError(new UpstreamError(500, "Server Error"), "ibge_estados")).not.toContain(
      "Resposta da fonte"
    );
  });

  // Este texto entra numa mensagem que o modelo lê inteira.
  it("truncates a very long body", async () => {
    const detalhe = await motivoUpstream(resposta("x".repeat(1000)));
    expect(detalhe).toHaveLength(300);
    expect(detalhe?.endsWith("...")).toBe(true);
  });

  it("collapses newlines so the reason stays one line", async () => {
    expect(await motivoUpstream(resposta("Parâmetro P\n  (Período)\tmal especificado"))).toBe(
      "Parâmetro P (Período) mal especificado"
    );
  });

  // Erro sem corpo legível (um Error comum, de outra camada) não pode derrubar
  // nem inventar linha: o caminho antigo tem de continuar inteiro.
  it("leaves a plain Error untouched", () => {
    const out = parseHttpError(new Error("HTTP 503: Service Unavailable"), "ibge_censo");
    expect(out).toContain("Serviço IBGE em manutenção");
    expect(out).not.toContain("Resposta da fonte");
  });
});
