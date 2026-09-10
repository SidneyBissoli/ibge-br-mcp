import { describe, it, expect } from "vitest";
import { withAnalytics, tagRequest } from "../src/analytics.js";
import { classifyError, paramNames } from "../../src/call-shape.js";

/**
 * A FORMA da chamada (blobs 7 e 8). Ligada aqui depois de provar no senado, e
 * pelo mesmo motivo: `ibge_sidra` falha em 47 de 122 chamadas e a
 * telemetria dizia QUE falhou, não por quê. O caso que importa mais é o
 * último: nenhum blob pode carregar valor de parâmetro.
 */
interface Ponto {
  indexes?: string[];
  blobs?: string[];
  doubles?: number[];
}

function fake() {
  const points: Ponto[] = [];
  return {
    points,
    dataset: { writeDataPoint: (p: Ponto) => points.push(p) } as unknown as AnalyticsEngineDataset,
  };
}

const tag = tagRequest(new Request("https://example.com/mcp"));

describe("withAnalytics grava a forma da chamada", () => {
  it("êxito: nomes dos parâmetros, classe vazia", async () => {
    const a = fake();
    const rec = withAnalytics(() => {}, a.dataset, tag);
    rec("tool_call", "ibge_sidra", { params: "tabela", classe: "" });
    await Promise.resolve(); // deixa o microtask descarregar
    expect(a.points[0]?.blobs?.[6]).toBe("");
    expect(a.points[0]?.blobs?.[7]).toBe("tabela");
  });

  it("erro: a classe vem do par tool_error, os parâmetros do tool_call", async () => {
    const a = fake();
    const rec = withAnalytics(() => {}, a.dataset, tag);
    rec("tool_call", "ibge_indicadores", { params: "indicador,localidade", classe: "" });
    rec("tool_error", "ibge_indicadores", { params: "indicador,localidade", classe: "nao_encontrado" });
    await Promise.resolve();
    expect(a.points).toHaveLength(1);
    expect(a.points[0]?.blobs?.[1]).toBe("error");
    expect(a.points[0]?.blobs?.[6]).toBe("nao_encontrado");
    expect(a.points[0]?.blobs?.[7]).toBe("indicador,localidade");
  });

  it("chamador antigo, sem forma, continua funcionando", async () => {
    const a = fake();
    const rec = withAnalytics(() => {}, a.dataset, tag);
    rec("tool_call", "ibge_sidra");
    await Promise.resolve();
    expect(a.points[0]?.blobs?.[6]).toBe("");
    expect(a.points[0]?.blobs?.[7]).toBe("");
  });

  it("NENHUM blob carrega valor de parâmetro", async () => {
    const a = fake();
    const rec = withAnalytics(() => {}, a.dataset, tag);
    const args = { busca: "um-termo-qualquer", periodo: "2026-01" };
    rec("tool_call", "ibge_sidra", {
      params: paramNames([args]),
      classe: classifyError("Resource not found"),
    });
    await Promise.resolve();
    const blobs = (a.points[0]?.blobs ?? []).join("|");
    expect(blobs).not.toContain("um-termo-qualquer");
    expect(blobs).not.toContain("2026-01");
    expect(blobs).toContain("busca,periodo");
  });
});
