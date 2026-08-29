/**
 * Portão de release da proveniência (contrato v1.0): TODAS as 21 ferramentas
 * devem anexar o bloco `provenance` no caminho de SUCESSO. Cada caso chama a
 * ferramenta UMA vez no seu caminho principal de dados, com `global.fetch`
 * mockado (nunca a rede), e verifica o bloco canônico:
 *   - isError falsy;
 *   - provenance definido;
 *   - source.agency === "IBGE";
 *   - citation no padrão "Fonte: IBGE — ..., extraído em DD/MM/AAAA.";
 *   - license.name não nulo.
 * Os payloads mockados são reaproveitados dos testes por ferramenta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ibgeEstados,
  estadosSchema,
  ibgeMunicipios,
  municipiosSchema,
  ibgeLocalidade,
  localidadeSchema,
  ibgeSidra,
  sidraSchema,
  ibgeNomes,
  nomesSchema,
  ibgeNoticias,
  noticiasSchema,
  ibgeSidraTabelas,
  sidraTabelasSchema,
  ibgeSidraMetadados,
  sidraMetadadosSchema,
  ibgeMalhas,
  malhasSchema,
  ibgePesquisas,
  pesquisasSchema,
  ibgeCenso,
  censoSchema,
  ibgeIndicadores,
  indicadoresSchema,
  ibgeCnae,
  cnaeSchema,
  ibgeGeocodigo,
  geocodigoSchema,
  ibgeCalendario,
  calendarioSchema,
  ibgeComparar,
  compararSchema,
  ibgeMalhasTema,
  malhasTemaSchema,
  ibgeVizinhos,
  vizinhosSchema,
  ibgeDatasaude,
  datasaudeSchema,
  ibgePaises,
  paisesSchema,
  ibgeCidades,
  cidadesSchema,
} from "../src/tools/index.js";
import { cache } from "../src/cache.js";
import type { StructuredToolResult } from "../src/structured.js";
import { mockResponse, sidraResponse } from "./helpers.js";

const mockFetch = vi.fn();

const CITACAO_PADRAO = /^Fonte: IBGE — .+, extraído em \d{2}\/\d{2}\/\d{4}\.$/;

// ---------------------------------------------------------------------------
// Payloads upstream mínimos (mesmas formas dos testes por ferramenta)
// ---------------------------------------------------------------------------

const estadoSP = {
  id: 35,
  sigla: "SP",
  nome: "São Paulo",
  regiao: { id: 3, sigla: "SE", nome: "Sudeste" },
};

// /municipios/{id} com hierarquia completa (usado por localidade e geocodigo)
const municipioSP = {
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
  "regiao-imediata": {
    id: 350001,
    nome: "São Paulo",
    "regiao-intermediaria": { id: 3501, nome: "São Paulo" },
  },
};

const sidraPop = sidraResponse(
  { D1N: "Unidade da Federação", D2N: "Ano", V: "Valor" },
  { D1N: "São Paulo", D2N: "2022", V: "44411238" },
  { D1N: "Rio de Janeiro", D2N: "2022", V: "16055174" }
);

// SIDRA para ibge_comparar (com coluna de código de município)
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

const agregadosPesquisas = [
  {
    id: "33",
    nome: "Estimativas de população",
    agregados: [{ id: "6579", nome: "População residente estimada" }],
  },
  {
    id: "10",
    nome: "PIB dos Municípios",
    agregados: [{ id: "5938", nome: "Produto Interno Bruto a preços correntes" }],
  },
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

const periodosSidra = [{ id: "2021", literals: ["2021"], modificacao: "2022-01-01" }];

const featureUnica = {
  type: "Feature",
  geometry: { type: "MultiPolygon", coordinates: [] },
  properties: { codarea: "35", nome: "São Paulo" },
};

const featureCollectionBiomas = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [] },
      properties: { codarea: "1", nome: "Amazônia" },
    },
  ],
};

const secaoCnae = { id: "J", descricao: "Informação e comunicação", observacoes: ["nota 1"] };

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

// Municípios do estado para ibge_vizinhos (mesmo prefixo 3550 = vizinhos)
function munVizinho(id: number, nome: string, sigla = "SP") {
  return { id, nome, microrregiao: { mesorregiao: { UF: { sigla } } } };
}
const municipiosDoEstado = [
  munVizinho(3550308, "São Paulo"),
  munVizinho(3550100, "São Lourenço da Serra"),
  munVizinho(3550209, "São Pedro"),
];
const malhaVizinhos = { type: "Feature", geometry: { type: "MultiPolygon", coordinates: [] } };

// PesquisaResultado[] para ibge_cidades (mapa ano->valor de uma localidade)
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

// ---------------------------------------------------------------------------
// Casos: uma chamada por ferramenta, no caminho principal de dados
// ---------------------------------------------------------------------------

interface Caso {
  nome: string;
  /** Configura o mockFetch para o caminho de sucesso da ferramenta. */
  mock: () => void;
  /** Executa a ferramenta com entrada mínima validada pelo schema (defaults aplicados). */
  executar: () => Promise<StructuredToolResult>;
}

const casos: Caso[] = [
  {
    nome: "ibge_estados",
    mock: () => mockFetch.mockResolvedValue(mockResponse([estadoSP])),
    executar: () => ibgeEstados(estadosSchema.parse({})),
  },
  {
    nome: "ibge_municipios",
    mock: () => mockFetch.mockResolvedValue(mockResponse([{ id: 3550308, nome: "São Paulo" }])),
    executar: () => ibgeMunicipios(municipiosSchema.parse({ uf: "SP" })),
  },
  {
    nome: "ibge_localidade",
    mock: () => mockFetch.mockResolvedValue(mockResponse(municipioSP)),
    executar: () => ibgeLocalidade(localidadeSchema.parse({ codigo: 3550308 })),
  },
  {
    nome: "ibge_sidra",
    mock: () => mockFetch.mockResolvedValue(mockResponse(sidraPop)),
    executar: () => ibgeSidra(sidraSchema.parse({ tabela: "6579", nivel_territorial: "3" })),
  },
  {
    nome: "ibge_nomes",
    mock: () => mockFetch.mockResolvedValue(mockResponse(rankingNomes)),
    executar: () => ibgeNomes(nomesSchema.parse({ tipo: "ranking" })),
  },
  {
    nome: "ibge_noticias",
    mock: () => mockFetch.mockResolvedValue(mockResponse(noticiasPayload)),
    executar: () => ibgeNoticias(noticiasSchema.parse({})),
  },
  {
    nome: "ibge_sidra_tabelas",
    mock: () => mockFetch.mockResolvedValue(mockResponse(agregadosPesquisas)),
    executar: () => ibgeSidraTabelas(sidraTabelasSchema.parse({})),
  },
  {
    nome: "ibge_sidra_metadados",
    mock: () => {
      // 1º fetch: /metadados; 2º fetch: /periodos (incluir_periodos default true)
      mockFetch
        .mockResolvedValueOnce(mockResponse(metadadosSidra))
        .mockResolvedValueOnce(mockResponse(periodosSidra));
    },
    executar: () => ibgeSidraMetadados(sidraMetadadosSchema.parse({ tabela: "6579" })),
  },
  {
    nome: "ibge_malhas",
    mock: () => mockFetch.mockResolvedValue(mockResponse(featureUnica)),
    executar: () => ibgeMalhas(malhasSchema.parse({ localidade: "SP" })),
  },
  {
    nome: "ibge_pesquisas",
    mock: () => mockFetch.mockResolvedValue(mockResponse(agregadosPesquisas)),
    executar: () => ibgePesquisas(pesquisasSchema.parse({})),
  },
  {
    nome: "ibge_censo",
    mock: () => mockFetch.mockResolvedValue(mockResponse(sidraPop)),
    executar: () => ibgeCenso(censoSchema.parse({})),
  },
  {
    nome: "ibge_indicadores",
    mock: () => mockFetch.mockResolvedValue(mockResponse(sidraPop)),
    executar: () => ibgeIndicadores(indicadoresSchema.parse({ indicador: "desemprego" })),
  },
  {
    nome: "ibge_cnae",
    mock: () => mockFetch.mockResolvedValue(mockResponse(secaoCnae)),
    executar: () => ibgeCnae(cnaeSchema.parse({ codigo: "J" })),
  },
  {
    nome: "ibge_geocodigo",
    mock: () => mockFetch.mockResolvedValue(mockResponse(municipioSP)),
    executar: () => ibgeGeocodigo(geocodigoSchema.parse({ codigo: "3550308" })),
  },
  {
    nome: "ibge_calendario",
    mock: () => mockFetch.mockResolvedValue(mockResponse(calendarioPayload)),
    executar: () => ibgeCalendario(calendarioSchema.parse({ tipo: "todos" })),
  },
  {
    nome: "ibge_comparar",
    mock: () => {
      // 1º fetch: SIDRA; 2º e 3º: nomes das localidades
      mockFetch
        .mockResolvedValueOnce(mockResponse(sidraComparar))
        .mockResolvedValueOnce(mockResponse({ nome: "São Paulo" }))
        .mockResolvedValueOnce(mockResponse({ nome: "Rio de Janeiro" }));
    },
    executar: () => ibgeComparar(compararSchema.parse({ localidades: "3550308,3304557" })),
  },
  {
    nome: "ibge_malhas_tema",
    mock: () => mockFetch.mockResolvedValue(mockResponse(featureCollectionBiomas)),
    executar: () => ibgeMalhasTema(malhasTemaSchema.parse({ tema: "biomas" })),
  },
  {
    nome: "ibge_vizinhos",
    mock: () => {
      // 1º fetch: /municipios/{id}; 2º: /estados/35/municipios; 3º: malha
      mockFetch
        .mockResolvedValueOnce(mockResponse(munVizinho(3550308, "São Paulo")))
        .mockResolvedValueOnce(mockResponse(municipiosDoEstado))
        .mockResolvedValueOnce(mockResponse(malhaVizinhos));
    },
    executar: () => ibgeVizinhos(vizinhosSchema.parse({ municipio: "3550308" })),
  },
  {
    nome: "ibge_datasaude",
    mock: () => mockFetch.mockResolvedValue(mockResponse(sidraPop)),
    executar: () => ibgeDatasaude(datasaudeSchema.parse({ indicador: "esperanca_vida" })),
  },
  {
    nome: "ibge_paises",
    mock: () => mockFetch.mockResolvedValue(mockResponse([paisBrasil])),
    executar: () => ibgePaises(paisesSchema.parse({})),
  },
  {
    nome: "ibge_cidades",
    mock: () => {
      // 1º fetch: localidade; depois indicadores do panorama
      mockFetch
        .mockResolvedValueOnce(mockResponse(municipioLocalidadeCidades))
        .mockResolvedValueOnce(mockResponse(pesquisaResultado({ "2022": "11451999" })));
      mockFetch.mockResolvedValue(mockResponse(pesquisaResultado({})));
    },
    executar: () => ibgeCidades(cidadesSchema.parse({ municipio: "3550308" })),
  },
];

// ---------------------------------------------------------------------------
// Portão de release: as 22 ferramentas emitem o bloco canônico
// ---------------------------------------------------------------------------

describe("proveniência — fiação nas 21 ferramentas (portão de release)", () => {
  beforeEach(() => {
    cache.clear();
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cobre exatamente as 21 ferramentas do servidor", () => {
    expect(casos).toHaveLength(21);
    expect(new Set(casos.map((c) => c.nome)).size).toBe(21);
  });

  for (const caso of casos) {
    it(`${caso.nome} anexa o bloco de proveniência no caminho de sucesso`, async () => {
      caso.mock();

      const result = await caso.executar();

      expect(result.isError).toBeFalsy();
      expect(result.provenance).toBeDefined();
      const p = result.provenance;
      expect(p?.source.agency).toBe("IBGE");
      expect(p?.citation).toMatch(CITACAO_PADRAO);
      expect(p?.license.name).not.toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// Caminho derivado (estatísticas D2) vs. caminho simples
// ---------------------------------------------------------------------------

describe("proveniência — caminho derivado (ibge_sidra com estatísticas D2)", () => {
  beforeEach(() => {
    cache.clear();
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("estatisticas=true marca derived=true e carrega a nota de derivação", async () => {
    mockFetch.mockResolvedValue(mockResponse(sidraPop));

    const result = await ibgeSidra(
      sidraSchema.parse({ tabela: "6579", nivel_territorial: "3", estatisticas: true })
    );

    expect(result.isError).toBeFalsy();
    expect(result.provenance?.derived).toBe(true);
    expect(result.provenance?.derivation_note).not.toBeNull();
  });

  it("o caminho simples (sem estatísticas) marca derived=false", async () => {
    mockFetch.mockResolvedValue(mockResponse(sidraPop));

    const result = await ibgeSidra(sidraSchema.parse({ tabela: "6579", nivel_territorial: "3" }));

    expect(result.isError).toBeFalsy();
    expect(result.provenance?.derived).toBe(false);
  });
});
