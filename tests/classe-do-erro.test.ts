/**
 * A classe do erro sai do TIPO da falha, não da frase.
 *
 * Medido em 30/09/2026, rodando `classifyError` sobre o texto que
 * `parseHttpError` monta: rede ("fetch failed") e abort caíam em `outro`; 403 e
 * corpo HTML em 200 também; e o 429 caía em `contrato` ("Too Many Requests"
 * casa "too many") — classe que o painel EXCLUI da taxa de erro. O tipo da
 * falha existia em retry.ts e morria no `catch` de cada tool.
 *
 * O teste atravessa o caminho INTEIRO — `fetch` dublado, tool, `catch`,
 * `toMcpResult`, hook `record` — porque a perda acontecia no meio dele. Os
 * casos que já estavam certos (400 → contrato, 404 → nao_encontrado, 5xx →
 * fonte) entram também: o conserto não pode mudá-los.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { registerAll } from "../src/server.js";
import { cache } from "../src/cache.js";
import { classifyThrown, CLASSE_DO_ERRO } from "../src/call-shape.js";
import { comClasse } from "../src/errors.js";
import { TimeoutError } from "../src/retry.js";
import { mockResponse } from "./helpers.js";

async function chamar(tool: string, args: Record<string, unknown>) {
  const classes: string[] = [];
  const server = new McpServer({ name: "classe-do-erro", version: "0.0.0" });
  registerAll(server, (kind, _name, forma) => {
    if (kind === "tool_error" && forma) classes.push(forma.classe);
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "classe-do-erro", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);

  const pendente = client.callTool({ name: tool, arguments: args });
  // As esperas entre tentativas (2 s, 4 s, 8 s...) correm no relógio falso.
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(20_000);
  const result = await pendente;
  return { result, classes };
}

beforeEach(() => {
  vi.useFakeTimers();
  cache.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function responder(fn: () => Promise<Response>) {
  global.fetch = vi.fn(fn) as unknown as typeof fetch;
}

describe("falha da origem é `fonte`", () => {
  it("rede — o TypeError do fetch não é bug nosso nem `outro`", async () => {
    responder(async () => {
      throw new TypeError("fetch failed");
    });
    const { result, classes } = await chamar("ibge_estados", {});
    expect(result.isError).toBe(true);
    // A mensagem ao chamador é a de sempre.
    expect(JSON.stringify(result.content)).toContain("fetch failed");
    expect(classes).toEqual(["fonte"]);
  });

  it("429 — pela frase ('Too Many Requests') caía em `contrato`", async () => {
    responder(async () => new Response("", { status: 429, statusText: "Too Many Requests" }));
    const { classes } = await chamar("ibge_estados", {});
    expect(classes).toEqual(["fonte"]);
  });

  it("403", async () => {
    responder(async () => new Response("", { status: 403, statusText: "Forbidden" }));
    const { classes } = await chamar("ibge_estados", {});
    expect(classes).toEqual(["fonte"]);
  });

  it("corpo HTML em 200 (página de erro da borda)", async () => {
    responder(
      async () =>
        new Response("<html><body>erro</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
    );
    const { classes } = await chamar("ibge_estados", {});
    expect(classes).toEqual(["fonte"]);
  });

  it("503 (já era `fonte`, continua)", async () => {
    responder(async () => new Response("", { status: 503, statusText: "Service Unavailable" }));
    const { classes } = await chamar("ibge_estados", {});
    expect(classes).toEqual(["fonte"]);
  });

  it("timeout (já era `fonte` pela frase; agora pelo tipo)", () => {
    expect(classifyThrown(new TimeoutError(30_000))).toBe("fonte");
  });
});

describe("o que já estava certo não muda", () => {
  it("400 é recusa da chamada — o SIDRA diz qual parâmetro no corpo", async () => {
    responder(
      async () =>
        new Response("Parâmetro N3 incompatível", { status: 400, statusText: "Bad Request" })
    );
    const { classes } = await chamar("ibge_estados", {});
    expect(classes).toEqual(["contrato"]);
  });

  it("404 é ausência respondida", async () => {
    responder(async () => new Response("", { status: 404, statusText: "Not Found" }));
    const { classes } = await chamar("ibge_estados", {});
    expect(classes).toEqual(["nao_encontrado"]);
  });

  it("`[]` com 200 para identificador único é ausência respondida", async () => {
    responder(async () => mockResponse([]));
    // Subclasse inexistente: medido em 22/09/2026, a API responde 200 [].
    const { classes } = await chamar("ibge_cnae", { codigo: "4721101" });
    expect(classes).toEqual(["nao_encontrado"]);
  });
});

describe("bug nosso no `catch` da tool é `defeito` (varredura de 30/09/2026)", () => {
  it("TypeError do nosso código", () => {
    expect(comClasse(new TypeError("Cannot read properties of undefined (reading 'x')"))[CLASSE_DO_ERRO]).toBe(
      "defeito",
    );
  });

  it("a falha de rede crua da undici NÃO é bug nosso — fica para o tipo de retry.ts ou a frase", () => {
    expect(comClasse(new TypeError("fetch failed"))[CLASSE_DO_ERRO]).toBeUndefined();
  });

  it("Error comum sem classe continua sem classe (a frase decide)", () => {
    expect(comClasse(new Error("algo"))[CLASSE_DO_ERRO]).toBeUndefined();
  });
});

describe("search/fetch pelo tipo (mcp-search 0.8.0)", () => {
  it("id desconhecido é nao_encontrado mesmo ecoando uma palavra de `contrato`", async () => {
    responder(async () => new Response("[]", { status: 200 }));
    const { result, classes } = await chamar("fetch", { id: "invalid" });
    expect(result.isError).toBe(true);
    expect(classes).toEqual(["nao_encontrado"]);
  });
});

describe("a classe viaja FORA do fio", () => {
  it("o resultado serializado não ganha chave nenhuma", async () => {
    responder(async () => new Response("", { status: 429, statusText: "Too Many Requests" }));
    const { result } = await chamar("ibge_estados", {});
    expect(Object.keys(result).sort()).toEqual(["content", "isError"]);
  });
});
