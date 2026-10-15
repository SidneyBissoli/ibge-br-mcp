/**
 * Contract 1.3 on the wire since 5.8.2 (15/10/2026; accepted by the schema since
 * 5.8.0): the concise block carries `revision` always, `derived` +
 * `derivation_note` when the server computed, and still `field_sources` (1.2)
 * when a response merges sub-sources. The schema `tools/list` publishes did not
 * change to turn it on. Tested against the SERVED schema, the client's view,
 * not only against the zod object; the per-tool wire cases are in
 * `provenance-wiring.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/client/validators/cf-worker";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { ProvenanceContractError, renderConcise } from "@sbissoli/mcp-provenance";
import {
  FONTES_IBGE,
  IBGE_LICENSE,
  NOTA_DERIVACAO_ESTATISTICAS,
  NOTA_REVISAO_SIDRA,
  provenanceContext,
  provenienciaIbge,
} from "../src/provenance.js";
import { createServer, SERVER_INSTRUCTIONS } from "../src/server.js";

const URL_SIDRA = "https://apisidra.ibge.gov.br/values/t/6579/n1/all/v/all/p/last";

describe("contract version", () => {
  it("the server emits contract 1.3", () => {
    expect(provenanceContext.contractVersion).toBe("1.3");
    const p = provenienciaIbge({
      fonte: "LOCALIDADES",
      url: "https://x",
      pesquisa: "API de Localidades",
    });
    expect(p.contract_version).toBe("1.3");
  });
});

describe("revision — informed by the builder (owner's decision: `current` for every IBGE source)", () => {
  it("every source is `current`; only the SIDRA-backed ones carry a note", () => {
    for (const [chave, fonte] of Object.entries(FONTES_IBGE)) {
      expect(fonte.revision.status, chave).toBe("current");
      const esperado = chave === "SIDRA" || chave === "AGREGADOS" ? NOTA_REVISAO_SIDRA : null;
      expect(fonte.revision.note, chave).toBe(esperado);
    }
  });

  it("the canonical block carries it (SIDRA: with the note; Localidades: note null)", () => {
    const sidra = provenienciaIbge({
      fonte: "SIDRA",
      url: URL_SIDRA,
      pesquisa: "SIDRA, Tabela 6579",
    });
    expect(sidra.revision).toEqual({ status: "current", note: NOTA_REVISAO_SIDRA });
    const loc = provenienciaIbge({
      fonte: "LOCALIDADES",
      url: "https://x",
      pesquisa: "API de Localidades",
    });
    expect(loc.revision).toEqual({ status: "current", note: null });
  });

  it("reaches the wire under 1.3: the common case gains only `revision`", () => {
    const concise = renderConcise(
      provenienciaIbge({ fonte: "SIDRA", url: URL_SIDRA, pesquisa: "SIDRA, Tabela 6579" })
    );
    expect(Object.keys(concise)).toEqual([
      "source",
      "source_url",
      "data_vintage",
      "retrieved_at",
      "retrieval",
      "citation",
      "license",
      "revision",
    ]);
    expect(concise.revision).toEqual({ status: "current", note: NOTA_REVISAO_SIDRA });
  });

  it("a derived block carries derived + derivation_note; a raw one carries neither", () => {
    const derivado = renderConcise(
      provenienciaIbge({
        fonte: "SIDRA",
        url: URL_SIDRA,
        pesquisa: "SIDRA, Tabela 6579",
        derivado: { nota: NOTA_DERIVACAO_ESTATISTICAS },
      })
    );
    expect(derivado.derived).toBe(true);
    expect(derivado.derivation_note).toBe(NOTA_DERIVACAO_ESTATISTICAS);
    const bruto = renderConcise(
      provenienciaIbge({ fonte: "SIDRA", url: URL_SIDRA, pesquisa: "SIDRA, Tabela 6579" })
    );
    expect(bruto).not.toHaveProperty("derived");
    expect(bruto).not.toHaveProperty("derivation_note");
    expect(bruto).not.toHaveProperty("notices");
  });

  it("the note is the sentence the server instructions already publish, not a new claim", () => {
    const frase = NOTA_REVISAO_SIDRA.charAt(0).toLowerCase() + NOTA_REVISAO_SIDRA.slice(1);
    expect(SERVER_INSTRUCTIONS).toContain(frase);
  });
});

describe("field_sources (from 1.2, still emitted under 1.3)", () => {
  const base = {
    source: {
      name: FONTES_IBGE.SIDRA.name,
      agency: "IBGE",
      database: null,
      endpoint: FONTES_IBGE.SIDRA.endpoint,
    },
    source_url: URL_SIDRA,
    data_vintage: null,
    citation: "Fonte: IBGE — teste",
    license: IBGE_LICENSE,
  };
  const subFontes = [
    { fields: ["populacao"], source_url: URL_SIDRA, retrieved_at: "2026-10-08T09:00:00-03:00" },
    {
      fields: ["pib"],
      source_url: "https://apisidra.ibge.gov.br/values/t/5938",
      retrieved_at: "2026-10-08T10:00:00-03:00",
    },
  ];

  it("a merged response emits field_sources, with the top retrieved_at the OLDEST sub-source", () => {
    const p = provenanceContext.build({
      ...base,
      retrieved_at: "2026-10-08T09:00:00-03:00",
      field_sources: subFontes,
    });
    const concise = renderConcise(p);
    expect(concise.field_sources?.map((f) => f.fields)).toEqual([["populacao"], ["pib"]]);
    expect(concise.retrieved_at).toBe("2026-10-08T09:00:00-03:00");
  });

  it("a top retrieved_at newer than a sub-source is refused (it would fail the tool)", () => {
    expect(() =>
      provenanceContext.build({
        ...base,
        retrieved_at: "2026-10-08T10:00:00-03:00",
        field_sources: subFontes,
      })
    ).toThrow(ProvenanceContractError);
  });
});

describe("listed schema (tools/list) — the 1.3 keys are declared and optional", () => {
  type No = {
    description?: string;
    type?: string | string[];
    enum?: string[];
    properties?: Record<string, No>;
    required?: string[];
    minItems?: number;
    items?: No;
  };
  let client: Client;
  let provenances: Array<[string, No]>;

  beforeAll(async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    // Round trip through JSON: what the client reads off the wire.
    provenances = tools
      .filter((t) => (t.outputSchema as No | undefined)?.properties?.provenance)
      .map((t) => [
        t.name,
        JSON.parse(JSON.stringify((t.outputSchema as No).properties!.provenance)) as No,
      ]);
  });

  afterAll(async () => {
    await client.close();
  });

  const blocoCompleto13 = {
    source: "IBGE — SIDRA (Banco de Tabelas Estatísticas)",
    source_url: URL_SIDRA,
    data_vintage: "2025",
    retrieved_at: "2026-10-08T09:00:00-03:00",
    retrieval: { requests: 1, attempts: 1, anomalies: [], unstable: false },
    citation: "Fonte: IBGE — SIDRA, Tabela 6579",
    license: IBGE_LICENSE.name,
    field_sources: [
      {
        fields: ["populacao"],
        source_url: URL_SIDRA,
        dataset_id: "6579",
        data_vintage: "2025",
        retrieved_at: "2026-10-08T09:00:00-03:00",
        served_from_cache: false,
      },
    ],
    notices: ["Série com quebra metodológica em 2022"],
    derived: true,
    derivation_note: "Estatísticas computadas pelo servidor",
    revision: { status: "current", note: NOTA_REVISAO_SIDRA },
  };

  it("every tool publishes the four keys, described, none of them required", () => {
    expect(provenances.length).toBeGreaterThan(15);
    for (const [nome, no] of provenances) {
      for (const chave of ["notices", "derived", "derivation_note", "revision"]) {
        expect(no.properties?.[chave]?.description, `${nome}.${chave}`).toBeTruthy();
        expect(no.required ?? [], `${nome}.${chave}`).not.toContain(chave);
      }
      expect(no.required ?? []).not.toContain("field_sources");
      // The package's text reaches the children, and the arrays keep `.min(1)`.
      const revision = no.properties!.revision!;
      expect(revision.properties?.status?.enum).toEqual(["current", "provisional", "final"]);
      expect(revision.properties?.status?.description, `${nome}.revision.status`).toBeTruthy();
      expect(revision.properties?.note?.description, `${nome}.revision.note`).toBeTruthy();
      expect(no.properties!.notices!.minItems).toBe(1);
      expect(no.properties!.field_sources!.minItems).toBe(1);
      expect(no.properties!.field_sources!.items?.properties?.fields?.description).toBeTruthy();
    }
  });

  it("accepts a complete 1.3 block, a 1.1 block, and refuses an unknown revision status", () => {
    const validador = new CfWorkerJsonSchemaValidator();
    const {
      field_sources: _fs,
      notices: _n,
      derived: _d,
      derivation_note: _dn,
      revision: _r,
      ...bloco11
    } = blocoCompleto13;
    for (const [nome, no] of provenances) {
      const valida = validador.getValidator(no as never);
      const completo = valida(blocoCompleto13);
      expect(completo.valid, `${nome}: ${completo.errorMessage}`).toBe(true);
      expect(valida(bloco11).valid, nome).toBe(true);
      expect(
        valida({ ...blocoCompleto13, revision: { status: "bogus", note: null } }).valid,
        nome
      ).toBe(false);
      expect(valida({ ...blocoCompleto13, notices: [] }).valid, nome).toBe(false);
    }
  });
});
