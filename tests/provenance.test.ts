/**
 * pt-BR provenance adapter (contract v1.0) — the canonical block every tool
 * attaches and the three emission channels wired in `toMcpResult`.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { cache, cachedFetch, cacheKey } from "../src/cache.js";
import {
  ATTRIBUTION_META_KEY,
  comProveniencia,
  extrairPeriodoSidra,
  IBGE_LICENSE,
  NOTA_DERIVACAO_ESTATISTICAS,
  PROVENANCE_META_KEY,
  provenienciaIbge,
} from "../src/provenance.js";
import { toMcpResult } from "../src/structured.js";
import { mockResponse } from "./helpers.js";
import { z } from "zod";

const URL_EXEMPLO = "https://servicodados.ibge.gov.br/api/v1/localidades/estados";

describe("provenienciaIbge", () => {
  beforeEach(() => {
    cache.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse([{ id: 35 }])));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a canonical v1.0 block with the normative license and IBGE source", () => {
    const p = provenienciaIbge({
      fonte: "LOCALIDADES",
      url: URL_EXEMPLO,
      pesquisa: "API de Localidades (estados)",
    });

    expect(p.contract_version).toBe("1.0");
    expect(p.source.name).toBe("IBGE — API de Localidades");
    expect(p.source.agency).toBe("IBGE");
    expect(p.source_url).toBe(URL_EXEMPLO);
    expect(p.license.id).toBe(null);
    expect(p.license.name).toBe(IBGE_LICENSE.name);
    expect(p.license.verified_at).toBe("2026-08-08");
    expect(p.derived).toBe(false);
    expect(p.derivation_note).toBe(null);
  });

  it("citation follows the fixed pattern: Fonte: IBGE — [pesquisa], [URL], extraído em [data]", () => {
    const p = provenienciaIbge({
      fonte: "LOCALIDADES",
      url: URL_EXEMPLO,
      pesquisa: "API de Localidades (estados)",
    });
    expect(p.citation).toMatch(
      new RegExp(
        `^Fonte: IBGE — API de Localidades \\(estados\\), ${URL_EXEMPLO.replace(/[/.]/g, "\\$&")}, extraído em \\d{2}/\\d{2}/\\d{4}\\.$`
      )
    );
  });

  it("timestamps are serialized in Brasília time (-03:00), no milliseconds", () => {
    const p = provenienciaIbge({ fonte: "SIDRA", url: URL_EXEMPLO, pesquisa: "SIDRA" });
    expect(p.retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/);
  });

  it("pulls the REAL fetch instant and served_from_cache from the cache layer", async () => {
    const key = cacheKey(URL_EXEMPLO);
    await cachedFetch(URL_EXEMPLO, key, 1);

    const primeiro = provenienciaIbge({
      fonte: "LOCALIDADES",
      url: URL_EXEMPLO,
      chaveCache: key,
      pesquisa: "API de Localidades (estados)",
    });
    expect(primeiro.served_from_cache).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await cachedFetch(URL_EXEMPLO, key, 1);
    const doCache = provenienciaIbge({
      fonte: "LOCALIDADES",
      url: URL_EXEMPLO,
      chaveCache: key,
      pesquisa: "API de Localidades (estados)",
    });
    // Cache hit keeps the ORIGINAL extraction instant (legally relevant date).
    expect(doCache.retrieved_at).toBe(primeiro.retrieved_at);
    expect(doCache.served_from_cache).toBe(true);
  });

  it("without a cache key, served_from_cache is null (server does not distinguish)", () => {
    const p = provenienciaIbge({ fonte: "CNAE", url: URL_EXEMPLO, pesquisa: "API CNAE" });
    expect(p.served_from_cache).toBe(null);
  });

  it("derived responses carry the derivation note (D2 statistics modes)", () => {
    const p = provenienciaIbge({
      fonte: "SIDRA",
      url: URL_EXEMPLO,
      pesquisa: "SIDRA, Tabela 6579",
      dataset: "6579",
      derivado: { nota: NOTA_DERIVACAO_ESTATISTICAS },
    });
    expect(p.derived).toBe(true);
    expect(p.derivation_note).toBe(NOTA_DERIVACAO_ESTATISTICAS);
    expect(p.dataset.id).toBe("6579");
  });
});

describe("extrairPeriodoSidra", () => {
  it("returns the single period value", () => {
    expect(extrairPeriodoSidra(["Ano", "Valor"], [{ Ano: "2022", Valor: "1" }])).toBe("2022");
  });

  it("returns a min–max range for multiple periods", () => {
    expect(
      extrairPeriodoSidra(
        ["Ano", "Valor"],
        [
          { Ano: "2020", Valor: "1" },
          { Ano: "2023", Valor: "2" },
          { Ano: "2021", Valor: "3" },
        ]
      )
    ).toBe("2020–2023");
  });

  it("prefers the readable label over the (Código) column", () => {
    expect(
      extrairPeriodoSidra(
        ["Trimestre (Código)", "Trimestre", "Valor"],
        [{ "Trimestre (Código)": "202301", Trimestre: "1º trimestre 2023", Valor: "1" }]
      )
    ).toBe("1º trimestre 2023");
  });

  it("returns null when the source exposes no period column", () => {
    expect(extrairPeriodoSidra(["Município", "Valor"], [{ Município: "X", Valor: "1" }])).toBe(
      null
    );
  });
});

describe("toMcpResult with provenance (three channels)", () => {
  const provenance = provenienciaIbge({
    fonte: "LOCALIDADES",
    url: URL_EXEMPLO,
    pesquisa: "API de Localidades (estados)",
  });

  it("emits footer, structuredContent block + attribution, and namespaced _meta", () => {
    const result = toMcpResult({
      markdown: "## Estados",
      structured: { total: 27 },
      provenance,
    });

    // Channel 3: compact footer as a second text block, fixed wording.
    expect(result.content).toHaveLength(2);
    const footer = (result.content[1] as { text: string }).text;
    expect(footer).toContain("Fonte: IBGE — API de Localidades");
    expect(footer).toContain(URL_EXEMPLO);
    expect(footer).toContain(
      "A referência completa desta informação pode ser solicitada nesta própria conversa."
    );

    // Channel 1: concise projection (6 keys) + attribution, visible to the model.
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.total).toBe(27);
    expect(Object.keys(sc.provenance as object)).toEqual([
      "source",
      "source_url",
      "data_vintage",
      "retrieved_at",
      "citation",
      "license",
    ]);
    expect(sc.attribution).toEqual([URL_EXEMPLO]);

    // Channel 2: namespaced _meta mirror.
    const meta = result._meta as Record<string, unknown>;
    expect(PROVENANCE_META_KEY).toBe("br.com.sidneybissoli.ibge/provenance");
    expect(ATTRIBUTION_META_KEY).toBe("br.com.sidneybissoli.ibge/attribution");
    expect(meta[PROVENANCE_META_KEY]).toEqual(sc.provenance);
    expect(meta[ATTRIBUTION_META_KEY]).toEqual([URL_EXEMPLO]);
  });

  it("error results never carry provenance channels", () => {
    const result = toMcpResult({ markdown: "erro", isError: true });
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result._meta).toBeUndefined();
  });
});

describe("comProveniencia (output schema extension)", () => {
  it("extends a tool output schema with required provenance + attribution", () => {
    const base = z.object({ total: z.number() });
    const estendido = comProveniencia(base);

    const bloco = provenienciaIbge({
      fonte: "LOCALIDADES",
      url: URL_EXEMPLO,
      pesquisa: "API de Localidades (estados)",
    });
    const { structuredContent } = toMcpResult({
      markdown: "x",
      structured: { total: 27 },
      provenance: bloco,
    });

    expect(() => estendido.parse(structuredContent)).not.toThrow();
    expect(() => estendido.parse({ total: 27 })).toThrow();
  });
});
