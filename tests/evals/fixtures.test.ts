/**
 * Offline regression signal of the tool-selection eval: fixtures validated
 * against the LIVE catalog (extracted by running the real `registerAll`) plus
 * the project-specific invariants (exact tool count, `ibge_` prefix, cluster
 * partition complete). Renaming/removing a tool breaks this immediately —
 * no network, no model.
 */

import { describe, it, expect } from "vitest";
import { validateFixtures } from "@sbissoli/mcp-evals";
import { DEEP_RESEARCH_TOOLS } from "@sbissoli/mcp-search";
import { AREA_BY_TOOL, CATALOG } from "../../evals/catalog.js";
import { FIXTURES } from "../../evals/fixtures/queries.js";

describe("eval catalog (live, via registerAll)", () => {
  it("captures exactly the 23 tools (21 ibge_* + the 2 of the Deep Research contract)", () => {
    expect(CATALOG.tools).toHaveLength(23);
  });

  it("every tool carries the ibge_ prefix — except the two the ChatGPT contract names", () => {
    // `search` and `fetch` are the ONLY allowed exceptions: their names are
    // fixed by OpenAI (Deep Research contract, v4.3.0). Explicit allowlist from
    // the package, not a looser regex — a third unprefixed tool still fails.
    const excecoes = new Set<string>(DEEP_RESEARCH_TOOLS);
    for (const tool of CATALOG.tools) {
      if (excecoes.has(tool.name)) continue;
      expect(tool.name).toMatch(/^ibge_/);
    }
    for (const nome of DEEP_RESEARCH_TOOLS) {
      expect(CATALOG.toolNames, `${nome} missing from the catalog`).toContain(nome);
    }
  });

  it("the cluster partition covers every tool, with no stale entries", () => {
    const catalogNames = [...CATALOG.toolNames].sort();
    expect(Object.keys(AREA_BY_TOOL).sort()).toEqual(catalogNames);
  });

  it("every tool has a non-empty description (the model's only selection signal)", () => {
    for (const tool of CATALOG.tools) {
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });
});

describe("eval fixtures (consolidation check)", () => {
  it("fixtures are valid against the live catalog", () => {
    expect(
      validateFixtures(FIXTURES, CATALOG, { minFixtures: 30, maxFixtures: 50, minAreas: 8 })
    ).toEqual([]);
  });

  it("fixture ids carry the cluster tag of the consolidation check", () => {
    for (const f of FIXTURES) {
      expect(f.id).toMatch(/^(pop|eco|loc|sidra|malha|ctrl)-\d{2}$/);
    }
  });

  it("the six clusters of the check are all exercised", () => {
    const prefixes = new Set(FIXTURES.map((f) => f.id.split("-")[0]));
    expect([...prefixes].sort()).toEqual(["ctrl", "eco", "loc", "malha", "pop", "sidra"]);
  });

  it("the população cluster (worst case) exercises all 5 overlapping tools", () => {
    const popTools = new Set(
      FIXTURES.filter((f) => f.id.startsWith("pop-")).flatMap((f) => f.expectedTools)
    );
    for (const tool of [
      "ibge_cidades",
      "ibge_censo",
      "ibge_comparar",
      "ibge_indicadores",
      "ibge_sidra",
    ]) {
      expect(popTools.has(tool), `cluster população não exercita ${tool}`).toBe(true);
    }
  });
});
