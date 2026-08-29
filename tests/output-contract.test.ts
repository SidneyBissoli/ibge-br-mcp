/**
 * Contrato de saída: o `structuredContent` obedece ao `outputSchema` anunciado.
 *
 * Por que este arquivo existe. O SDK v2 exige `structuredContent` em todo
 * sucesso de ferramenta com `outputSchema`, mas NÃO valida o conteúdo contra o
 * schema. A spec do MCP exige a conformidade, e cliente que valida — o MCP
 * Inspector valida — rejeita a resposta INTEIRA quando ela não vale.
 *
 * Aqui os schemas nascem do zod, então o defeito não aparece no caminho feliz:
 * ele aparece onde a fonte OMITE um campo. Campo ausente vira `undefined`, e
 * `JSON.stringify` apaga a chave — o que, num campo obrigatório do schema, é
 * "missing required property" do lado do cliente. Por isso os casos vêm em
 * pares: o payload cheio e o payload MAGRO, com os campos opcionais da fonte
 * ausentes.
 *
 * O teste roda o servidor de verdade pelo transporte em memória e valida com o
 * MESMO validador que o servidor aplica na entrada (`CfWorkerJsonSchemaValidator`,
 * que já vem no SDK), contra o schema que o `tools/list` publica — a visão
 * exata do cliente. A rede nunca é tocada.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import { createServer } from "../src/server.js";
import { cache } from "../src/cache.js";
import { mockResponse, sidraResponse } from "./helpers.js";

const validador = new CfWorkerJsonSchemaValidator();
const mockFetch = vi.fn();

// ---------------------------------------------------------------------------
// Payloads upstream — cheios e magros
// ---------------------------------------------------------------------------

const estadoSP = {
  id: 35,
  sigla: "SP",
  nome: "São Paulo",
  regiao: { id: 3, sigla: "SE", nome: "Sudeste" },
};

const municipioSP = {
  id: 3550308,
  nome: "São Paulo",
  microrregiao: {
    id: 35061,
    nome: "São Paulo",
    mesorregiao: {
      id: 3515,
      nome: "Metropolitana de São Paulo",
      UF: { id: 35, sigla: "SP", nome: "São Paulo", regiao: { id: 3, sigla: "SE", nome: "Sudeste" } },
    },
  },
  "regiao-imediata": {
    id: 350001,
    nome: "São Paulo",
    "regiao-intermediaria": { id: 3501, nome: "São Paulo" },
  },
};

/** Município SEM as hierarquias opcionais — o que a fonte devolve para distritos e casos antigos. */
const municipioMagro = { id: 3550308, nome: "São Paulo" };

const sidraPop = sidraResponse(
  { D1N: "Unidade da Federação", D2N: "Ano", V: "Valor" },
  { D1N: "São Paulo", D2N: "2022", V: "44411238" },
  { D1N: "Rio de Janeiro", D2N: "2022", V: "16055174" }
);

/** SIDRA sem linha de dado: consulta válida cujo recorte não tem valor publicado. */
const sidraVazio = sidraResponse({ D1N: "Unidade da Federação", D2N: "Ano", V: "Valor" });

const sidraComparar = sidraResponse(
  { D1C: "Código do Município", D1N: "Município", V: "Valor" },
  { D1C: "3550308", D1N: "São Paulo", V: "12300000" },
  { D1C: "3304557", D1N: "Rio de Janeiro", V: "6700000" }
);


const rankingNomes = [
  {
    localidade: "BR",
    sexo: null,
    res: [
      { nome: "MARIA", frequencia: 11734129, ranking: 1 },
      { nome: "JOSE", frequencia: 5754529, ranking: 2 },
    ],
  },
];

const noticiasPayload = {
  count: 1,
  page: 1,
  totalPages: 1,
  nextPage: 0,
  previousPage: 0,
  showingFrom: 1,
  showingTo: 1,
  items: [
    {
      id: 1,
      tipo: "Notícia",
      titulo: "PIB cresce no trimestre",
      introducao: "O PIB cresceu.",
      data_publicacao: "2024-03-15 10:00:00",
      produto_id: 9282,
      produtos: "PIB",
      editorias: "economicas",
      imagens: "",
      produtos_relacionados: "",
      destaque: true,
      link: "https://agenciadenoticias.ibge.gov.br/x",
    },
  ],
};

/**
 * Notícia na forma MAGRA que a fonte realmente publica: todas as chaves
 * presentes, mas `produtos`/`produtos_relacionados` vazios (18 de 30 itens da
 * consulta ao vivo em 11/08/2026 estão assim) e `introducao` vazia. A API v3
 * de notícias nunca OMITE chave — verificado contra a origem.
 */
const noticiasMagro = {
  count: 1,
  page: 1,
  totalPages: 1,
  items: [
    {
      id: 2,
      tipo: "Release",
      titulo: "Nota antiga",
      introducao: "",
      data_publicacao: "2015-01-05 09:00:00",
      produto_id: 0,
      produtos: "",
      editorias: "",
      imagens: "",
      produtos_relacionados: "",
      destaque: false,
      link: "/agencia-noticias/x",
    },
  ],
};

const agregadosPesquisas = [
  { id: "33", nome: "Estimativas de população", agregados: [{ id: "6579", nome: "População residente estimada" }] },
  { id: "10", nome: "PIB dos Municípios", agregados: [{ id: "5938", nome: "Produto Interno Bruto a preços correntes" }] },
];

const metadadosSidra = {
  id: "6579",
  nome: "Estimativas de população residente",
  URL: "https://sidra.ibge.gov.br/tabela/6579",
  pesquisa: "Estimativas de população",
  assunto: "População residente estimada",
  periodicidade: { frequencia: "anual", inicio: 2001, fim: 2021 },
  nivelTerritorial: { Administrativo: ["N1", "N3", "N6"], Especial: [], IBGE: [] },
  variaveis: [{ id: 9324, nome: "População residente estimada", unidade: "Pessoas" }],
};

/** Metadados sem `URL`, sem `assunto` e com variável sem `unidade`. */
const metadadosMagro = {
  id: "6579",
  nome: "Estimativas de população residente",
  pesquisa: "Estimativas de população",
  periodicidade: { frequencia: "anual", inicio: 2001, fim: 2021 },
  nivelTerritorial: { Administrativo: ["N1"], Especial: [], IBGE: [] },
  variaveis: [{ id: 9324, nome: "População residente estimada" }],
};

const periodosSidra = [{ id: "2021", literals: ["2021"], modificacao: "2022-01-01" }];

const featureUnica = {
  type: "Feature",
  geometry: { type: "MultiPolygon", coordinates: [] },
  properties: { codarea: "35", nome: "São Paulo" },
};

/** Malha sem `properties` — a fonte devolve isso quando o formato pedido não os carrega. */
const featureSemProperties = { type: "Feature", geometry: { type: "MultiPolygon", coordinates: [] } };

const featureCollectionBiomas = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "MultiPolygon", coordinates: [] }, properties: { codarea: "1", nome: "Amazônia" } },
  ],
};

const secaoCnae = { id: "J", descricao: "Informação e comunicação", observacoes: ["nota 1"] };
/** Seção CNAE sem `observacoes` — a maioria das seções não tem nota. */
const secaoCnaeMagra = { id: "K", descricao: "Atividades financeiras" };

const calendarioPayload = {
  count: 1,
  page: 1,
  totalPages: 1,
  items: [
    {
      id: 4228,
      titulo: "Índice de Preços ao Produtor",
      descricao: "",
      data_divulgacao: "31/03/2026 12:00:00",
      tipo_id: 1,
      tipo: "Divulgação de Indicadores",
      produto_id: 9282,
      nome_produto: "IPP",
      link: "",
    },
  ],
};

/** Item de calendário sem `nome_produto`, `link` e `descricao`. */
const calendarioMagro = {
  count: 1,
  page: 1,
  totalPages: 1,
  items: [
    { id: 4229, titulo: "Pesquisa futura", data_divulgacao: "30/04/2026 09:00:00", tipo_id: 1, tipo: "Divulgação de Indicadores" },
  ],
};

function munVizinho(id: number, nome: string, sigla = "SP") {
  return { id, nome, microrregiao: { mesorregiao: { UF: { sigla } } } };
}
const municipiosDoEstado = [
  munVizinho(3550308, "São Paulo"),
  munVizinho(3550100, "São Lourenço da Serra"),
  munVizinho(3550209, "São Pedro"),
];
const malhaVizinhos = { type: "Feature", geometry: { type: "MultiPolygon", coordinates: [] } };

function pesquisaResultado(res: Record<string, string | number | null>) {
  return [{ id: 1, res: [{ localidade: "3550308", res }] }];
}
const municipioLocalidadeCidades = {
  nome: "São Paulo",
  microrregiao: { mesorregiao: { UF: { nome: "São Paulo", sigla: "SP" } } },
};

const paisBrasil = {
  id: { M49: 76, "ISO-3166-1-ALPHA-2": "BR", "ISO-3166-1-ALPHA-3": "BRA" },
  nome: { abreviado: "Brasil" },
  localizacao: { regiao: { id: { M49: 19 }, nome: "Américas" } },
};

/** País sem `localizacao` — a fonte omite para territórios sem região atribuída. */
const paisMagro = {
  id: { M49: 10, "ISO-3166-1-ALPHA-2": "AQ", "ISO-3166-1-ALPHA-3": "ATA" },
  nome: { abreviado: "Antártida" },
};

// ---------------------------------------------------------------------------
// Casos: nome da ferramenta, o que o caso cobre, mock e argumentos
// ---------------------------------------------------------------------------

interface Caso {
  nome: string;
  cobre: string;
  mock: () => void;
  args: Record<string, unknown>;
}

const um = (payload: unknown) => () => {
  mockFetch.mockResolvedValue(mockResponse(payload));
};

const CASOS: Caso[] = [
  { nome: "ibge_estados", cobre: "lista completa", mock: um([estadoSP]), args: {} },
  { nome: "ibge_estados", cobre: "lista vazia (filtro sem resultado)", mock: um([]), args: { regiao: "N" } },

  { nome: "ibge_municipios", cobre: "lista de municípios", mock: um([{ id: 3550308, nome: "São Paulo" }]), args: { uf: "SP" } },
  { nome: "ibge_municipios", cobre: "busca que filtra para um item", mock: um([{ id: 1200401, nome: "Rio Branco" }]), args: { uf: "AC", busca: "rio" } },

  { nome: "ibge_localidade", cobre: "hierarquia completa", mock: um(municipioSP), args: { codigo: 3550308 } },
  { nome: "ibge_localidade", cobre: "município sem as hierarquias opcionais", mock: um(municipioMagro), args: { codigo: 3550308 } },


  { nome: "ibge_sidra", cobre: "série com valores", mock: um(sidraPop), args: { tabela: "6579", nivel_territorial: "3" } },
  { nome: "ibge_sidra", cobre: "recorte sem linha de dado", mock: um(sidraVazio), args: { tabela: "6579", nivel_territorial: "3" } },

  { nome: "ibge_nomes", cobre: "ranking", mock: um(rankingNomes), args: { tipo: "ranking" } },

  { nome: "ibge_noticias", cobre: "item completo", mock: um(noticiasPayload), args: {} },
  { nome: "ibge_noticias", cobre: "item com produtos/editorias vazios (forma real magra)", mock: um(noticiasMagro), args: {} },

  { nome: "ibge_sidra_tabelas", cobre: "catálogo", mock: um(agregadosPesquisas), args: {} },

  {
    nome: "ibge_sidra_metadados",
    cobre: "metadados + períodos",
    mock: () => {
      mockFetch.mockResolvedValueOnce(mockResponse(metadadosSidra)).mockResolvedValueOnce(mockResponse(periodosSidra));
    },
    args: { tabela: "6579" },
  },
  {
    nome: "ibge_sidra_metadados",
    cobre: "metadados sem URL/assunto e variável sem unidade",
    mock: () => {
      mockFetch.mockResolvedValueOnce(mockResponse(metadadosMagro)).mockResolvedValueOnce(mockResponse([]));
    },
    args: { tabela: "6579" },
  },

  { nome: "ibge_malhas", cobre: "feature com properties", mock: um(featureUnica), args: { localidade: "SP" } },
  { nome: "ibge_malhas", cobre: "feature sem properties", mock: um(featureSemProperties), args: { localidade: "SP" } },

  { nome: "ibge_pesquisas", cobre: "catálogo de pesquisas", mock: um(agregadosPesquisas), args: {} },

  { nome: "ibge_censo", cobre: "série do censo", mock: um(sidraPop), args: {} },
  { nome: "ibge_censo", cobre: "recorte sem linha de dado", mock: um(sidraVazio), args: {} },

  { nome: "ibge_indicadores", cobre: "indicador conjuntural", mock: um(sidraPop), args: { indicador: "desemprego" } },

  { nome: "ibge_cnae", cobre: "seção com observações", mock: um(secaoCnae), args: { codigo: "J" } },
  { nome: "ibge_cnae", cobre: "seção sem observações", mock: um(secaoCnaeMagra), args: { codigo: "K" } },

  { nome: "ibge_geocodigo", cobre: "município com hierarquia", mock: um(municipioSP), args: { codigo: "3550308" } },

  { nome: "ibge_calendario", cobre: "item completo", mock: um(calendarioPayload), args: { tipo: "todos" } },
  { nome: "ibge_calendario", cobre: "item sem produto/link/descrição", mock: um(calendarioMagro), args: { tipo: "todos" } },

  {
    nome: "ibge_comparar",
    cobre: "duas localidades",
    mock: () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(sidraComparar))
        .mockResolvedValueOnce(mockResponse({ nome: "São Paulo" }))
        .mockResolvedValueOnce(mockResponse({ nome: "Rio de Janeiro" }));
    },
    args: { localidades: "3550308,3304557" },
  },

  { nome: "ibge_malhas_tema", cobre: "coleção de features", mock: um(featureCollectionBiomas), args: { tema: "biomas" } },

  {
    nome: "ibge_vizinhos",
    cobre: "vizinhos por prefixo",
    mock: () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(munVizinho(3550308, "São Paulo")))
        .mockResolvedValueOnce(mockResponse(municipiosDoEstado))
        .mockResolvedValueOnce(mockResponse(malhaVizinhos));
    },
    args: { municipio: "3550308" },
  },

  { nome: "ibge_datasaude", cobre: "indicador de saúde", mock: um(sidraPop), args: { indicador: "esperanca_vida" } },

  { nome: "ibge_paises", cobre: "país completo", mock: um([paisBrasil]), args: {} },
  { nome: "ibge_paises", cobre: "país sem localizacao", mock: um([paisMagro]), args: {} },

  {
    nome: "ibge_cidades",
    cobre: "panorama com indicadores",
    mock: () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(municipioLocalidadeCidades))
        .mockResolvedValueOnce(mockResponse(pesquisaResultado({ "2022": "11451999" })));
      mockFetch.mockResolvedValue(mockResponse(pesquisaResultado({})));
    },
    args: { municipio: "3550308" },
  },
  {
    nome: "ibge_cidades",
    cobre: "panorama sem nenhum indicador publicado",
    mock: () => {
      mockFetch.mockResolvedValueOnce(mockResponse(municipioLocalidadeCidades));
      mockFetch.mockResolvedValue(mockResponse(pesquisaResultado({})));
    },
    args: { municipio: "3550308" },
  },
];

// ---------------------------------------------------------------------------

let client: Client;
let schemas: Map<string, unknown>;

beforeAll(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "output-contract", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  schemas = new Map(tools.map((t) => [t.name, t.outputSchema]));
});

afterAll(async () => {
  await client.close();
});

beforeEach(() => {
  cache.clear();
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("structuredContent obedece ao outputSchema anunciado", () => {
  it.each(CASOS.map((c) => [c.nome, c.cobre, c] as const))("%s — %s", async (nome, _cobre, caso) => {
    const schema = schemas.get(nome);
    expect(schema, `ferramenta ${nome} sem outputSchema em tools/list`).toBeDefined();

    caso.mock();
    const resultado = await client.callTool({ name: nome, arguments: caso.args });

    const texto = (resultado.content as Array<{ text?: string }> | undefined)?.[0]?.text;
    expect(resultado.isError, `${nome} devolveu erro: ${texto}`).toBeFalsy();
    expect(resultado.structuredContent, `${nome} sem structuredContent`).toBeDefined();

    // Valida o que o CLIENTE vê: o `structuredContent` atravessa o transporte
    // como JSON, e `JSON.stringify` apaga chave cujo valor é `undefined` — num
    // campo obrigatório isso vira "missing required property" do outro lado.
    // O transporte em memória não serializa, então a serialização é feita aqui.
    const noFio = JSON.parse(JSON.stringify(resultado.structuredContent)) as unknown;
    const veredicto = validador.getValidator(schema as never)(noFio);
    expect(veredicto.valid, `${nome}: ${veredicto.errorMessage}`).toBe(true);
  });

  /**
   * Um teste que não pode falhar não vale nada. Este pega uma saída REAL e a
   * valida contra um schema deliberadamente desonesto — a mentira exata que
   * este arquivo existe para pegar.
   */
  it("reprova um schema desonesto (prova de que o portão pode falhar)", async () => {
    mockFetch.mockResolvedValue(mockResponse([estadoSP]));
    const resultado = await client.callTool({ name: "ibge_estados", arguments: {} });

    const honesto = schemas.get("ibge_estados") as Record<string, unknown>;
    expect(validador.getValidator(honesto as never)(resultado.structuredContent).valid).toBe(true);

    const desonesto = JSON.parse(JSON.stringify(honesto)) as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    desonesto.properties.total = { type: "string" };

    const veredicto = validador.getValidator(desonesto as never)(resultado.structuredContent);
    expect(veredicto.valid).toBe(false);
    expect(veredicto.errorMessage).toContain("total");
  });

  it("toda ferramenta anunciada declara outputSchema e tem ao menos um caso", async () => {
    const { tools } = await client.listTools();
    const cobertas = new Set(CASOS.map((c) => c.nome));
    const semCaso = tools.map((t) => t.name).filter((n) => !cobertas.has(n));
    expect(semCaso, `ferramentas sem caso de contrato: ${semCaso.join(", ")}`).toEqual([]);
    for (const t of tools) {
      expect(t.outputSchema, `${t.name} sem outputSchema`).toBeDefined();
    }
  });
});
