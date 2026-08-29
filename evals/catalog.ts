/**
 * Live tool catalog for the tool-selection eval (`@sbissoli/mcp-evals`).
 *
 * Option (b) of the adoption design (`ibge/docs/03` §4): a single group runs
 * the real `registerAll` from `src/server.ts` — zero touch on `src/` — and the
 * per-tool area is then reassigned from the cluster map below, so the
 * per-area accuracy report reflects the disambiguation clusters instead of
 * one monolithic "ibge" area.
 */

import { buildCatalog, type Catalog, type CatalogGroup } from "@sbissoli/mcp-evals";
import { registerAll } from "../src/server.js";

const GROUPS: CatalogGroup[] = [
  {
    area: "ibge",
    register: (server) => {
      // registerAll also wires resources/prompts; the capturing fake records
      // tools only, so those two registrations become no-ops here.
      const capturing = Object.assign(server, {
        registerResource: () => undefined,
        registerPrompt: () => undefined,
      });
      registerAll(capturing as never);
    },
  },
];

/**
 * Primary area per tool — a PARTITION of the 22 tools aligned with the
 * overlap clusters of the consolidation check (`ibge/docs/03` §4). Tools that
 * belong to more than one cluster are assigned to the one where confusion
 * would be most diagnostic; fixture ids carry the cluster tag for the
 * per-cluster analysis of the paid run.
 */
export const AREA_BY_TOOL: Record<string, string> = {
  // população (worst-case cluster: 6 overlapping tools; primary members here)
  ibge_censo: "populacao",
  ibge_cidades: "populacao",
  // econômico
  ibge_indicadores: "economico",
  ibge_comparar: "economico",
  // localidades
  ibge_estados: "localidades",
  ibge_municipios: "localidades",
  ibge_localidade: "localidades",
  ibge_geocodigo: "localidades",
  ibge_vizinhos: "localidades",
  // fluxo SIDRA
  ibge_sidra: "sidra",
  ibge_sidra_tabelas: "sidra",
  ibge_sidra_metadados: "sidra",
  ibge_pesquisas: "sidra",
  // malhas
  ibge_malhas: "malhas",
  ibge_malhas_tema: "malhas",
  // saúde
  ibge_datasaude: "saude",
  // referência (sem irmã)
  ibge_cnae: "referencia",
  ibge_nomes: "referencia",
  ibge_paises: "referencia",
  // divulgação (sem irmã)
  ibge_noticias: "divulgacao",
  ibge_calendario: "divulgacao",
};

const base = buildCatalog(GROUPS);

export const CATALOG: Catalog = {
  tools: base.tools.map((t) => ({ ...t, area: AREA_BY_TOOL[t.name] ?? t.area })),
  toolNames: base.toolNames,
  areaByName: new Map(base.tools.map((t) => [t.name, AREA_BY_TOOL[t.name] ?? t.area])),
};
