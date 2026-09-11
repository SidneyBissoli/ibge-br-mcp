import { describe, it, expect } from "vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { registerAll } from "../src/server.js";
import { mockResponse } from "./helpers.js";
import { readFileSync } from "node:fs";
import { classifyError, errorText, paramNames } from "../src/call-shape.js";

/**
 * A FORMA da chamada (blobs 7 e 8), ligada em 10/09/2026 porque o painel do
 * portfólio passou a medir erro por chamada e `ibge_sidra` falha em 39% delas —
 * e a telemetria dizia QUE falhou, não por quê.
 *
 * O teste que mais importa é a GUARDA: ela varre as mensagens da fábrica de
 * erros deste servidor (`src/errors.ts`, que é o lugar único onde elas nascem)
 * e reprova se alguma cair em `outro`. Quando passei o classificador por aqui,
 * quatro das treze não tinham classe — este repositório nomeia a falha de
 * infraestrutura em vez de usar as palavras genéricas ("Tempo de resposta
 * excedido", não "timeout"; "Serviço em manutenção"; "Erro de conexão"). Uma
 * lista de literais copiados aqui fossilizaria o dia da varredura; a guarda
 * continua verdadeira sozinha.
 */

const MENSAGEM = /\bmessage:\s*(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;

function mensagensDaFabrica(): string[] {
  const fonte = readFileSync(new URL("../src/errors.ts", import.meta.url), "utf8");
  const achadas = new Set<string>();
  for (const m of fonte.matchAll(MENSAGEM)) {
    const texto = (m[2] ?? "")
      .replace(/\$\{[^}]*\}/g, "X")
      .replace(/\s+/g, " ")
      .trim();
    if (texto.length > 8) achadas.add(texto);
  }
  return [...achadas];
}

describe("guarda: as mensagens deste servidor são classificáveis", () => {
  const mensagens = mensagensDaFabrica();

  it("a varredura encontra as mensagens (senão a guarda passaria vazia)", () => {
    expect(mensagens.length).toBeGreaterThan(8);
  });

  it("nenhuma mensagem da fábrica cai em `outro`", () => {
    const orfas = mensagens.filter((m) => classifyError(m) === "outro");
    expect(orfas, `sem classe:\n${orfas.map((m) => `  - ${m}`).join("\n")}`).toEqual([]);
  });
});

describe("classifyError separa a bifurcação do conserto", () => {
  it("valor que o esquema aceita mas a regra recusa é contrato", () => {
    expect(classifyError('Código inválido: "99"')).toBe("contrato");
    expect(classifyError('Data inválida: "31/02/2024"')).toBe("contrato");
    expect(classifyError("Parâmetros inválidos")).toBe("contrato");
  });

  it("chamou certo, mas não há dado, é nao_encontrado", () => {
    expect(classifyError("Município não encontrado")).toBe("nao_encontrado");
    expect(classifyError("Nenhum dado encontrado")).toBe("nao_encontrado");
    expect(classifyError("Nenhum evento encontrado para os critérios informados.")).toBe(
      "nao_encontrado"
    );
  });

  it("infraestrutura da fonte é fonte, com as palavras que ESTE servidor usa", () => {
    expect(classifyError("Tempo de resposta excedido")).toBe("fonte");
    expect(classifyError("Serviço IBGE em manutenção")).toBe("fonte");
    expect(classifyError("Erro de conexão")).toBe("fonte");
    expect(classifyError("Erro interno do servidor IBGE")).toBe("fonte");
  });

  it("`erro desconhecido` NÃO é contrato — é o caso sem classe", () => {
    // A ampliação do vocabulário lia o radical "desconhecid" e classificava
    // este erro genérico como contrato, que é o oposto do que ele é.
    expect(classifyError("Erro desconhecido ao consultar calendário do IBGE.")).toBe("outro");
  });

  it("um código com 5 no meio não vira erro 5xx", () => {
    expect(classifyError("Município 591234 não encontrado")).toBe("nao_encontrado");
  });
});

describe("paramNames nunca deixa passar valor", () => {
  it("devolve os NOMES, em ordem", () => {
    const s = paramNames([{ tabela: "6579", nivel: "N6", localidades: "3550308" }]);
    expect(s).toBe("localidades,nivel,tabela");
    expect(s).not.toContain("6579");
    expect(s).not.toContain("3550308");
  });

  it("aguenta chamada sem argumento, estranha ou com array", () => {
    expect(paramNames([])).toBe("");
    expect(paramNames([null])).toBe("");
    expect(paramNames(["texto"])).toBe("");
    expect(paramNames([["a", "b"]])).toBe("");
  });

  it("ignora parâmetro ausente e corta o que não cabe no blob", () => {
    expect(paramNames([{ tabela: "6579", extra: undefined }])).toBe("tabela");
    const muitos = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`parametro_numero_${i}`, 1])
    );
    expect(paramNames([muitos]).length).toBeLessThanOrEqual(200);
  });
});

describe("errorText lê o texto que o handler devolveu", () => {
  it("lê o texto do primeiro conteúdo", () => {
    expect(errorText({ content: [{ type: "text", text: "falhou" }], isError: true })).toBe(
      "falhou"
    );
  });

  it("lê o campo `error` do envelope, não o payload inteiro", () => {
    // O hint genérico de erro não recuperável termina em "pode estar
    // indisponível", e classificar o payload todo arrastava TODO erro não
    // recuperável para a classe `fonte`. Visto na produção do senado.
    const envelope = {
      isError: true,
      structuredContent: { error: "Município não encontrado", retryable: false },
      content: [{ type: "text", text: "" }],
    };
    expect(classifyError(errorText(envelope))).toBe("nao_encontrado");
  });

  it("não quebra sem conteúdo", () => {
    expect(errorText({})).toBe("");
    expect(errorText(null)).toBe("");
    expect(errorText({ content: [] })).toBe("");
  });
});

describe("a costura do search/fetch com o pacote", () => {
  /**
   * O que este teste guarda. Estas duas tools sao registradas pelo
   * `@sbissoli/mcp-search`, e ate a 0.4.0 o gancho de telemetria dele tinha
   * aridade 2: a forma da chamada nao tinha por onde entrar, e as linhas de
   * `fetch` chegaram na PRODUCAO com classe e parametros vazios. Nenhuma
   * bateria pegou — os dois lados estavam certos e so faltava o argumento na
   * costura. Este caso atravessa o servidor real, de ponta a ponta.
   */
  const fetchOriginal = global.fetch;

  beforeEach(() => {
    // O indice do acervo e montado na primeira chamada; so estes dois
    // endpoints bastam, e o resto responde 404 (id desconhecido e o caminho
    // que este teste exercita).
    global.fetch = vi.fn(async (url: string | URL) => {
      const alvo = String(url);
      if (/\/api\/v3\/agregados$/.test(alvo)) return mockResponse([]);
      if (/\/localidades\/municipios/.test(alvo)) return mockResponse([]);
      return mockResponse({ erro: alvo }, 404);
    }) as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it("o erro de `fetch` chega ao recorder classificado e com os nomes", async () => {
    const vistos: Array<[string, string, unknown]> = [];
    const server = new McpServer({ name: "call-shape-test", version: "0.0.0" });
    registerAll(server, ((kind: string, name?: string, forma?: unknown) => {
      vistos.push([kind, name ?? "", forma]);
    }) as never);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "call-shape-test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const r = await client.callTool({ name: "fetch", arguments: { id: "nao-existe-no-acervo" } });
      expect(r.isError).toBe(true);
    } finally {
      await client.close();
    }
    const doFetch = vistos.filter(([, nome]) => nome === "fetch");
    expect(doFetch).toEqual([
      ["tool_call", "fetch", { params: "id", classe: "" }],
      ["tool_error", "fetch", { params: "id", classe: "nao_encontrado" }],
    ]);
  });
});
