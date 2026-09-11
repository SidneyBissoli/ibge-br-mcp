import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createServer } from "../src/server.js";

/**
 * End-to-end tests of the MCP protocol surface (roadmap 1.6): tool annotations,
 * reference-catalog resources, and analysis-template prompts. Drives the real
 * server through a linked in-memory transport and a client — no network.
 */
describe("MCP server protocol surface", () => {
  let client: Client;
  let instructions: string | undefined;

  beforeAll(async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    instructions = client.getInstructions();
  });

  afterAll(async () => {
    await client.close();
  });

  describe("tool annotations", () => {
    it("marks every tool read-only, idempotent, and open-world", async () => {
      const { tools } = await client.listTools();

      expect(tools.length).toBeGreaterThanOrEqual(21);
      for (const tool of tools) {
        expect(tool.annotations, `tool ${tool.name} missing annotations`).toBeDefined();
        expect(tool.annotations?.readOnlyHint, `tool ${tool.name}`).toBe(true);
        expect(tool.annotations?.destructiveHint, `tool ${tool.name}`).toBe(false);
        expect(tool.annotations?.idempotentHint, `tool ${tool.name}`).toBe(true);
        expect(tool.annotations?.openWorldHint, `tool ${tool.name}`).toBe(true);
      }
    });

    it("gives every tool a pt-BR display title", async () => {
      const { tools } = await client.listTools();

      for (const tool of tools) {
        expect(tool.title, `tool ${tool.name} missing title`).toBeTruthy();
        expect(tool.title, `tool ${tool.name} title should differ from name`).not.toBe(tool.name);
      }
    });
  });

  /**
   * Parâmetro que não existe tem de ser RECUSADO, nunca descartado em silêncio.
   *
   * Sem `.strict()`, o zod tira a chave desconhecida, aplica o default do
   * parâmetro que faltou e a ferramenta responde OUTRA pergunta com cara de
   * resposta. Medido em 11/09/2026:
   * `ibge_indicadores(indicador="populacao", periodo="2023")` — singular, que o
   * esquema não tem — devolveu a população de **2026**, com `p/last` na URL de
   * procedência e nenhum aviso. Um agente reporta isso como o número de 2023.
   * Singular/plural é o engano mais comum que existe, e esta é a guarda.
   *
   * `search`/`fetch` ficam de fora: o contrato é da OpenAI e quem os registra é
   * `@sbissoli/mcp-search`.
   */
  describe("esquema de entrada recusa parâmetro que não existe", () => {
    const DEEP_RESEARCH = ["search", "fetch"];

    it("toda tool publica additionalProperties: false", async () => {
      const { tools } = await client.listTools();
      const proprias = tools.filter((t) => !DEEP_RESEARCH.includes(t.name));

      expect(proprias.length).toBeGreaterThanOrEqual(21);
      for (const tool of proprias) {
        const schema = tool.inputSchema as { additionalProperties?: unknown };
        expect(schema.additionalProperties, `tool ${tool.name} aceita chave desconhecida`).toBe(
          false
        );
      }
    });

    it("a recusa NOMEIA a chave, para o modelo se corrigir sozinho", async () => {
      const result = await client.callTool({
        name: "ibge_indicadores",
        arguments: { indicador: "populacao", periodo: "2023" },
      });

      expect(result.isError).toBe(true);
      const texto = Array.isArray(result.content)
        ? result.content.map((c) => ("text" in c ? c.text : "")).join(" ")
        : "";
      expect(texto).toContain("periodo");
    });
  });

  describe("server instructions", () => {
    it("sends the disambiguation map + D2 guidance on the handshake", () => {
      expect(instructions).toBeTruthy();
      expect(instructions).toContain("estatisticas");
      expect(instructions).toContain("ibge_sidra");
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
