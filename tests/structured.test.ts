import { describe, it, expect } from "vitest";
import { toMcpResult, selectSidraColumns, sidraRecords } from "../src/structured.js";

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
