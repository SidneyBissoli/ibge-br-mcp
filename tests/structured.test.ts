import { describe, it, expect } from "vitest";
import {
  toMcpResult,
  selectSidraColumns,
  sidraRecords,
  colunaIdentificadora,
  formatarCelulaSidra,
} from "../src/structured.js";

describe("toMcpResult", () => {
  it("maps a success result to text content + structuredContent", () => {
    const r = toMcpResult({ markdown: "# ok", structured: { a: 1 } });

    expect(r.content).toEqual([{ type: "text", text: "# ok" }]);
    expect(r.structuredContent).toEqual({ a: 1 });
    expect(r.isError).toBeUndefined();
  });

  it("maps an error result to isError without structuredContent", () => {
    const r = toMcpResult({ markdown: "boom", isError: true, structured: { a: 1 } });

    expect(r.content).toEqual([{ type: "text", text: "boom" }]);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toBeUndefined();
  });

  it("omits structuredContent when there is no structured payload", () => {
    const r = toMcpResult({ markdown: "plain" });

    expect(r.content).toEqual([{ type: "text", text: "plain" }]);
    expect(r.structuredContent).toBeUndefined();
    expect(r.isError).toBeUndefined();
  });
});

describe("selectSidraColumns", () => {
  const data = [
    { D1N: "Unidade da Federação", D2N: "Ano", V: "Valor" },
    { D1N: "São Paulo", D2N: "2022", V: "44411238" },
    { D1N: "Rio de Janeiro", D2N: "2022", V: "16055174" },
  ];

  it("keeps only the columns whose label matches (accent/case-insensitive)", () => {
    const filtered = selectSidraColumns(data, "Valor,Ano");
    const { colunas, registros } = sidraRecords(filtered);

    expect(colunas).toEqual(["Ano", "Valor"]);
    expect(registros[0]).toEqual({ Ano: "2022", Valor: "44411238" });
    expect(registros[0]).not.toHaveProperty("Unidade da Federação");
  });

  it("matches without depending on accents or case", () => {
    const filtered = selectSidraColumns(data, "unidade da federacao");
    expect(sidraRecords(filtered).colunas).toEqual(["Unidade da Federação"]);
  });

  it("returns the data unchanged when campos is empty", () => {
    expect(selectSidraColumns(data, undefined)).toBe(data);
    expect(selectSidraColumns(data, "  ")).toBe(data);
  });

  it("returns the data unchanged when no column matches (never blanks out)", () => {
    expect(selectSidraColumns(data, "inexistente")).toBe(data);
  });
});

describe("formatarCelulaSidra", () => {
  it("formata quantidades com separador de milhar (4+ caracteres, como antes)", () => {
    expect(formatarCelulaSidra("Valor", "2415451")).toBe("2.415.451");
    expect(formatarCelulaSidra("Valor", "123")).toBe("123");
    expect(formatarCelulaSidra("Valor", "12.5")).toBe("12,5");
  });

  it("deixa códigos e períodos como estão — era o que virava '2.026' e '3.106.200'", () => {
    expect(formatarCelulaSidra("Ano", "2026")).toBe("2026");
    expect(formatarCelulaSidra("Ano (Código)", "2026")).toBe("2026");
    expect(formatarCelulaSidra("Município (Código)", "3106200")).toBe("3106200");
    expect(formatarCelulaSidra("Variável (Código)", "9324")).toBe("9324");
    expect(formatarCelulaSidra("Trimestre (Código)", "202401")).toBe("202401");
    expect(formatarCelulaSidra("Mês", "202601")).toBe("202601");
  });

  it("valor ausente vira '-' e texto passa intacto", () => {
    expect(formatarCelulaSidra("Valor", undefined)).toBe("-");
    expect(formatarCelulaSidra("Valor", "")).toBe("-");
    expect(formatarCelulaSidra("Município", "Belo Horizonte (MG)")).toBe("Belo Horizonte (MG)");
  });

  it("colunaIdentificadora reconhece só as gêmeas '(Código)' e a família de período", () => {
    expect(colunaIdentificadora("Unidade da Federação (Código)")).toBe(true);
    expect(colunaIdentificadora("Período")).toBe(true);
    expect(colunaIdentificadora("Semestre")).toBe(true);
    expect(colunaIdentificadora("Anomalia")).toBe(false);
    expect(colunaIdentificadora("Valor")).toBe(false);
    expect(colunaIdentificadora("Unidade da Federação")).toBe(false);
  });
});
