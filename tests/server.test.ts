import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

/**
 * End-to-end tests of the MCP protocol surface (roadmap 1.6): tool annotations,
 * reference-catalog resources, and analysis-template prompts. Drives the real
 * server through a linked in-memory transport and a client — no network.
 */
describe("MCP server protocol surface", () => {
  let client: Client;

  beforeAll(async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
  });

  describe("tool annotations", () => {
    it("marks every tool read-only, idempotent, and open-world", async () => {
      const { tools } = await client.listTools();

      expect(tools.length).toBeGreaterThanOrEqual(22);
      for (const tool of tools) {
        expect(tool.annotations, `tool ${tool.name} missing annotations`).toBeDefined();
        expect(tool.annotations?.readOnlyHint, `tool ${tool.name}`).toBe(true);
        expect(tool.annotations?.destructiveHint, `tool ${tool.name}`).toBe(false);
        expect(tool.annotations?.idempotentHint, `tool ${tool.name}`).toBe(true);
        expect(tool.annotations?.openWorldHint, `tool ${tool.name}`).toBe(true);
      }
    });
  });

  describe("reference resources", () => {
    it("lists all catalog resources", async () => {
      const { resources } = await client.listResources();
      const uris = resources.map((r) => r.uri);

      expect(uris).toContain("ibge://catalogos/ufs");
      expect(uris).toContain("ibge://catalogos/regioes");
      expect(uris).toContain("ibge://catalogos/niveis-territoriais");
      expect(uris).toContain("ibge://catalogos/tabelas-sidra");
      expect(uris).toContain("ibge://catalogos/biomas");
    });

    it("reads the UF catalog as JSON with 27 states", async () => {
      const result = await client.readResource({ uri: "ibge://catalogos/ufs" });
      const content = result.contents[0];

      expect(content.mimeType).toBe("application/json");
      const ufs = JSON.parse(content.text as string);
      expect(ufs).toHaveLength(27);
      const sp = ufs.find((u: { sigla: string }) => u.sigla === "SP");
      expect(sp).toMatchObject({ sigla: "SP", codigo: 35, nome: "São Paulo", regiao_codigo: 3 });
    });

    it("reads the SIDRA tables catalog", async () => {
      const result = await client.readResource({ uri: "ibge://catalogos/tabelas-sidra" });
      const tabelas = JSON.parse(result.contents[0].text as string);

      const pop = tabelas.find((t: { codigo: string }) => t.codigo === "6579");
      expect(pop).toBeDefined();
      expect(pop.descricao).toBeTruthy();
    });
  });

  describe("analysis prompts", () => {
    it("lists all analysis-template prompts", async () => {
      const { prompts } = await client.listPrompts();
      const names = prompts.map((p) => p.name);

      expect(names).toContain("comparar-municipios");
      expect(names).toContain("perfil-demografico");
    });

    it("expands comparar-municipios with the provided arguments", async () => {
      const result = await client.getPrompt({
        name: "comparar-municipios",
        arguments: { localidades: "São Paulo, Rio de Janeiro", indicador: "pib" },
      });

      const text = result.messages[0].content.type === "text" ? result.messages[0].content.text : "";
      expect(text).toContain("São Paulo, Rio de Janeiro");
      expect(text).toContain("pib");
      expect(text).toContain("ibge_comparar");
    });

    it("defaults the indicator when omitted", async () => {
      const result = await client.getPrompt({
        name: "comparar-municipios",
        arguments: { localidades: "35,33" },
      });

      const text = result.messages[0].content.type === "text" ? result.messages[0].content.text : "";
      expect(text).toContain("populacao");
    });
  });
});
