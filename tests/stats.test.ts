import { describe, it, expect } from "vitest";
import { estatisticasSidra, valorSidra, TOP_N_DEFAULT } from "../src/stats.js";
import type { SidraRecords } from "../src/structured.js";

/** Builds a labeled SIDRA result (post-`sidraRecords`) from row objects. */
function registros(colunas: string[], ...rows: Record<string, string>[]): SidraRecords {
  return { colunas, registros: rows, totalRegistros: rows.length };
}

describe("valorSidra", () => {
  it("parses plain integers and dot-decimal rates", () => {
    expect(valorSidra("44411238")).toBe(44411238);
    expect(valorSidra("76.4")).toBe(76.4);
    expect(valorSidra("-3.2")).toBe(-3.2);
  });

  it("returns null for every SIDRA absence marker and non-numeric input", () => {
    for (const marcador of ["-", "..", "...", "X", "", "  ", "abc"]) {
      expect(valorSidra(marcador)).toBeNull();
    }
    expect(valorSidra(undefined)).toBeNull();
  });
});

describe("estatisticasSidra — distribution mode", () => {
  const dados = registros(
    ["Unidade da Federação", "Ano", "Valor"],
    { "Unidade da Federação": "SP", Ano: "2022", Valor: "5" },
    { "Unidade da Federação": "RJ", Ano: "2022", Valor: "1" },
    { "Unidade da Federação": "MG", Ano: "2022", Valor: "3" },
    { "Unidade da Federação": "BA", Ano: "2022", Valor: "2" },
    { "Unidade da Federação": "PR", Ano: "2022", Valor: "4" }
  );

  it("computes the full distribution with pt-BR keys and labeled percentiles", () => {
    const r = estatisticasSidra(dados, { topN: 2 });
    if (!r.ok) throw new Error(r.erro);

    const d = r.bloco.distribuicao as Record<string, unknown>;
    expect(d.n).toBe(5);
    expect(d.soma).toBe(15);
    expect(d.minimo).toBe(1);
    expect(d.maximo).toBe(5);
    expect(d.media).toBe(3);
    expect(d.mediana).toBe(3);
    // Population std-dev of 1..5 = sqrt(2) ≈ 1.41 (display-rounded to 2 places)
    expect(d.desvioPadrao).toBe(1.41);

    const percentis = d.percentis as Array<Record<string, unknown>>;
    expect(percentis.map((p) => p.percentil)).toEqual([25, 50, 75, 90, 95, 99]);
    // Type-7 interpolation: p25 of 1..5 = 2, p75 = 4
    expect(percentis[0].valor).toBe(2);
    expect(percentis[2].valor).toBe(4);
    const mediana = percentis[1];
    expect(mediana.rotulo).toContain("mediana");
    expect(String(mediana.rotulo)).not.toContain("p50");
  });

  it("ranks top/bottom identified by the VARYING columns only (constants are context)", () => {
    const r = estatisticasSidra(dados, { topN: 2 });
    if (!r.ok) throw new Error(r.erro);

    const top = r.bloco.top as Array<Record<string, unknown>>;
    const bottom = r.bloco.bottom as Array<Record<string, unknown>>;
    expect(top).toHaveLength(2);
    // "Ano" is constant ("2022" everywhere) → dropped from the identity.
    expect(top[0]).toEqual({ "Unidade da Federação": "SP", valor: 5 });
    expect(top[0]).not.toHaveProperty("Valor");
    expect(bottom[0]).toEqual({ "Unidade da Federação": "RJ", valor: 1 });
  });

  it("keeps all non-value columns when every column is constant (single record)", () => {
    const um = registros(["UF", "Ano", "Valor"], { UF: "SP", Ano: "2022", Valor: "7" });
    const r = estatisticasSidra(um, { topN: 1 });
    if (!r.ok) throw new Error(r.erro);
    expect((r.bloco.top as Array<Record<string, unknown>>)[0]).toEqual({
      UF: "SP",
      Ano: "2022",
      valor: 7,
    });
  });

  it("excludes absence markers from n and reports them in registrosSemValor", () => {
    const comMarcadores = registros(
      ["UF", "Valor"],
      { UF: "SP", Valor: "10" },
      { UF: "RJ", Valor: "-" },
      { UF: "MG", Valor: "..." },
      { UF: "BA", Valor: "X" },
      { UF: "PR", Valor: ".." }
    );
    const r = estatisticasSidra(comMarcadores, { topN: TOP_N_DEFAULT });
    if (!r.ok) throw new Error(r.erro);

    expect(r.bloco.registrosConsiderados).toBe(1);
    expect(r.bloco.registrosSemValor).toBe(4);
    expect((r.bloco.distribuicao as Record<string, unknown>).n).toBe(1);
  });

  it("fails pedagogically when every record carries an absence marker", () => {
    const soMarcadores = registros(["UF", "Valor"], { UF: "SP", Valor: "-" });
    const r = estatisticasSidra(soMarcadores, { topN: TOP_N_DEFAULT });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("marcador de ausência");
  });

  it("fails pedagogically when there is no 'Valor' column, listing the available ones", () => {
    const semValor = registros(["Nome", "Sigla"], { Nome: "São Paulo", Sigla: "SP" });
    const r = estatisticasSidra(semValor, { topN: TOP_N_DEFAULT });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain('coluna "Valor"');
    expect(r.erro).toContain("Nome, Sigla");
  });
});

describe("estatisticasSidra — grouped mode", () => {
  const dados = registros(
    ["Unidade da Federação", "Ano", "Valor"],
    { "Unidade da Federação": "SP", Ano: "2021", Valor: "10" },
    { "Unidade da Federação": "SP", Ano: "2022", Valor: "20" },
    { "Unidade da Federação": "RJ", Ano: "2021", Valor: "5" },
    { "Unidade da Federação": "RJ", Ano: "2022", Valor: "6" }
  );

  it("groups by an accent/case-insensitive column label, ranked by descending sum", () => {
    const r = estatisticasSidra(dados, { agruparPor: "unidade da federacao", topN: 5 });
    if (!r.ok) throw new Error(r.erro);

    expect(r.bloco.agrupadoPor).toBe("Unidade da Federação");
    expect(r.bloco.totalGrupos).toBe(2);
    const grupos = r.bloco.grupos as Array<Record<string, unknown>>;
    expect(grupos[0].grupo).toBe("SP"); // sum 30 > sum 11
    expect(grupos[0].soma).toBe(30);
    expect(grupos[1].grupo).toBe("RJ");
    expect(grupos[1].n).toBe(2);
  });

  it("fails pedagogically when the grouping column does not exist", () => {
    const r = estatisticasSidra(dados, { agruparPor: "Municipio", topN: 5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain('"Municipio"');
    expect(r.erro).toContain("Unidade da Federação");
  });
});

describe("estatisticasSidra — multi-variable queries", () => {
  const misto = registros(
    ["Variável", "UF", "Valor"],
    { Variável: "População", UF: "SP", Valor: "100" },
    { Variável: "População", UF: "RJ", Valor: "50" },
    { Variável: "Área", UF: "SP", Valor: "7" },
    { Variável: "Área", UF: "RJ", Valor: "3" }
  );

  it("auto-groups by 'Variável' when the query mixes variables and no agruparPor is given", () => {
    const r = estatisticasSidra(misto, { topN: TOP_N_DEFAULT });
    if (!r.ok) throw new Error(r.erro);

    expect(r.bloco.agrupadoPor).toBe("Variável");
    expect(r.bloco.aviso).toContain("2 variáveis");
    const grupos = r.bloco.grupos as Array<Record<string, unknown>>;
    expect(grupos.map((g) => g.grupo)).toEqual(["População", "Área"]);
  });

  it("warns about mixed units when agruparPor targets another column", () => {
    const r = estatisticasSidra(misto, { agruparPor: "UF", topN: TOP_N_DEFAULT });
    if (!r.ok) throw new Error(r.erro);

    expect(r.bloco.agrupadoPor).toBe("UF");
    expect(r.bloco.aviso).toContain("mistura");
  });
});

describe("estatisticasSidra — Markdown channel", () => {
  it("renders the distribution, percentiles and rankings in pt-BR", () => {
    const dados = registros(
      ["UF", "Valor"],
      { UF: "SP", Valor: "44411238" },
      { UF: "RJ", Valor: "16055174" }
    );
    const r = estatisticasSidra(dados, { topN: 2 });
    if (!r.ok) throw new Error(r.erro);

    expect(r.markdown).toContain('### Estatísticas (coluna "Valor")');
    expect(r.markdown).toContain("Mediana");
    expect(r.markdown).toContain("44.411.238");
    expect(r.markdown).toContain("Top (maiores valores)");
    expect(r.markdown).toContain("Bottom (menores valores)");
  });

  it("renders the grouped table with one row per group", () => {
    const dados = registros(
      ["UF", "Valor"],
      { UF: "SP", Valor: "10" },
      { UF: "RJ", Valor: "4" }
    );
    const r = estatisticasSidra(dados, { agruparPor: "UF", topN: 5 });
    if (!r.ok) throw new Error(r.erro);

    expect(r.markdown).toContain('### Estatísticas por "UF"');
    expect(r.markdown).toContain("ordenados por soma decrescente");
    expect(r.markdown).toContain("| SP");
    expect(r.markdown).toContain("| RJ");
  });
});
