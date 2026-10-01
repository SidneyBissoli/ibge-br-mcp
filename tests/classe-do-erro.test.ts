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
    expect(
      comClasse(new TypeError("Cannot read properties of undefined (reading 'x')"))[CLASSE_DO_ERRO]
    ).toBe("defeito");
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

/**
 * Onda 2 (30/09/2026): todo resultado de erro sai com a classe DECLARADA, e os
 * pontos onde a classe estava errada — não só ausente — foram consertados.
 * Cada caso abaixo falha no código anterior: ou a classe vinha da frase (e a
 * frase dizia outra coisa), ou o erro da origem era engolido e virava "não
 * encontrado".
 */
function porUrl(fn: (url: string) => Response | Promise<Response>) {
  global.fetch = vi.fn(async (input: unknown) =>
    fn(typeof input === "string" ? input : String((input as { url?: string }).url ?? input))
  ) as unknown as typeof fetch;
}

const indisponivel = () => new Response("", { status: 503, statusText: "Service Unavailable" });

const MUNICIPIO_SP = {
  id: 3550308,
  nome: "São Paulo",
  microrregiao: {
    id: 35061,
    nome: "São Paulo",
    mesorregiao: {
      id: 3515,
      nome: "Metropolitana de São Paulo",
      UF: {
        id: 35,
        sigla: "SP",
        nome: "São Paulo",
        regiao: { id: 3, sigla: "SE", nome: "Sudeste" },
      },
    },
  },
};

describe("D2 ibge_geocodigo — o `catch` local não engole a queda da origem", () => {
  it("município com a origem fora do ar é `fonte`, não 'Município não encontrado'", async () => {
    porUrl(indisponivel);
    const { result, classes } = await chamar("ibge_geocodigo", { codigo: "3550308" });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).not.toContain("Município não encontrado");
    expect(classes).toEqual(["fonte"]);
  });

  it("distrito com a origem fora do ar é `fonte`", async () => {
    porUrl(indisponivel);
    const { classes } = await chamar("ibge_geocodigo", { codigo: "355030805" });
    expect(classes).toEqual(["fonte"]);
  });

  it("bug de formatação nosso é `defeito`, não 'não encontrado'", async () => {
    // Município sem `microrregiao`: o formatador estoura com TypeError.
    porUrl(() => mockResponse({ id: 3550308, nome: "São Paulo", microrregiao: null }));
    const { classes } = await chamar("ibge_geocodigo", { codigo: "3550308" });
    expect(classes).toEqual(["defeito"]);
  });

  it("ausência respondida (`[]` em 200) continua `nao_encontrado`", async () => {
    porUrl(() => mockResponse([]));
    const { result, classes } = await chamar("ibge_geocodigo", { codigo: "3599999" });
    expect(JSON.stringify(result.content)).toContain("Município não encontrado");
    expect(classes).toEqual(["nao_encontrado"]);
  });
});

describe("D3 ibge_vizinhos — os helpers não engolem a falha da origem", () => {
  it("lookup do município com a origem fora do ar é `fonte`", async () => {
    porUrl(indisponivel);
    const { classes } = await chamar("ibge_vizinhos", { municipio: "3550308" });
    expect(classes).toEqual(["fonte"]);
  });

  it("lista do estado (busca por nome) com a origem fora do ar é `fonte`", async () => {
    porUrl(indisponivel);
    const { classes } = await chamar("ibge_vizinhos", { municipio: "Campinas", uf: "SP" });
    expect(classes).toEqual(["fonte"]);
  });

  it("malha fora do ar é `fonte`, não 'Não foi possível determinar os vizinhos'", async () => {
    porUrl((url) => {
      if (url.includes("/malhas/")) return indisponivel();
      if (url.includes("/estados/35/municipios"))
        return mockResponse([MUNICIPIO_SP, { ...MUNICIPIO_SP, id: 3509502, nome: "Campinas" }]);
      return mockResponse(MUNICIPIO_SP);
    });
    const { result, classes } = await chamar("ibge_vizinhos", { municipio: "3550308" });
    expect(JSON.stringify(result.content)).not.toContain("Não foi possível determinar");
    expect(classes).toEqual(["fonte"]);
  });

  it("município ausente (`[]` em 200) continua `nao_encontrado`", async () => {
    porUrl(() => mockResponse([]));
    const { classes } = await chamar("ibge_vizinhos", { municipio: "3599999" });
    expect(classes).toEqual(["nao_encontrado"]);
  });
});

describe("recusas da CHAMADA são `contrato`, mesmo quando a frase diz outra coisa", () => {
  it("D4 ibge_paises tipo=buscar sem `busca` ('Nenhum dado encontrado')", async () => {
    porUrl(() => mockResponse([]));
    const { classes } = await chamar("ibge_paises", { tipo: "buscar" });
    expect(classes).toEqual(["contrato"]);
  });

  it("D5 ibge_comparar com 11 localidades ('Máximo de 10')", async () => {
    porUrl(() => mockResponse([]));
    const localidades = Array.from({ length: 11 }, (_, i) => String(3550308 + i)).join(",");
    const { classes } = await chamar("ibge_comparar", { localidades });
    expect(classes).toEqual(["contrato"]);
  });

  it("D6 ibge_malhas_tema com `codigo` num recorte sem código por feição", async () => {
    porUrl(() => mockResponse({ features: [] }));
    const { classes } = await chamar("ibge_malhas_tema", { tema: "amazonia_legal", codigo: "1" });
    expect(classes).toEqual(["contrato"]);
  });

  it("D8 ibge_datasaude com indicador fora do catálogo ('não encontrado')", async () => {
    porUrl(() => mockResponse([]));
    const { classes } = await chamar("ibge_datasaude", { indicador: "xyz" });
    expect(classes).toEqual(["contrato"]);
  });

  it("D8 ibge_indicadores com indicador fora do catálogo ('não encontrado')", async () => {
    porUrl(() => mockResponse([]));
    const { classes } = await chamar("ibge_indicadores", { indicador: "xyz" });
    expect(classes).toEqual(["contrato"]);
  });

  it("D9 ibge_censo com tema sem tabela para o ano ('não disponíveis')", async () => {
    porUrl(() => mockResponse([]));
    const { classes } = await chamar("ibge_censo", { tema: "religiao", ano: "1970" });
    expect(classes).toEqual(["contrato"]);
  });
});

describe("D7 estatísticas — a classe vem de estatisticasSidra, não da frase", () => {
  const popByUf = [
    { D1N: "Unidade da Federação", D2N: "Ano", V: "Valor" },
    { D1N: "São Paulo", D2N: "2022", V: "44411238" },
    { D1N: "Rio de Janeiro", D2N: "2022", V: "16055174" },
  ];

  it("`agruparPor` que não existe é `contrato` ('não encontrada no resultado')", async () => {
    porUrl(() => mockResponse(popByUf));
    const { classes } = await chamar("ibge_sidra", {
      tabela: "6579",
      nivel_territorial: "3",
      estatisticas: true,
      agruparPor: "Municipio",
    });
    expect(classes).toEqual(["contrato"]);
  });

  it("`agruparPor` ambíguo é `contrato`", async () => {
    porUrl(() =>
      mockResponse([
        { D1N: "Grupo de idade", D2N: "Grupo de cor", V: "Valor" },
        { D1N: "0 a 4 anos", D2N: "Branca", V: "10" },
        { D1N: "5 a 9 anos", D2N: "Parda", V: "20" },
      ])
    );
    const { classes } = await chamar("ibge_sidra", {
      tabela: "6579",
      nivel_territorial: "1",
      estatisticas: true,
      agruparPor: "Grupo",
    });
    expect(classes).toEqual(["contrato"]);
  });

  it("consulta sem coluna 'Valor' é `defeito` (suposição nossa sobre a forma do SIDRA)", async () => {
    porUrl(() =>
      mockResponse([
        { D1N: "Unidade da Federação", V: "Quantidade" },
        { D1N: "São Paulo", V: "1" },
      ])
    );
    const { classes } = await chamar("ibge_sidra", {
      tabela: "6579",
      nivel_territorial: "3",
      estatisticas: true,
    });
    expect(classes).toEqual(["defeito"]);
  });
});

describe("D11 ibge_malhas_tema — camada vazia", () => {
  it("SEM `codigo`, camada vazia é `fonte` (o recorte não pode ser vazio)", async () => {
    porUrl(() => mockResponse({ features: [], numberMatched: 0 }));
    const { classes } = await chamar("ibge_malhas_tema", { tema: "amazonia_legal" });
    expect(classes).toEqual(["fonte"]);
  });

  it("COM `codigo`, vazio é `nao_encontrado` (já era; continua)", async () => {
    porUrl(() => mockResponse({ features: [], numberMatched: 0 }));
    const { classes } = await chamar("ibge_malhas_tema", { tema: "biomas", codigo: "9" });
    expect(classes).toEqual(["nao_encontrado"]);
  });
});
