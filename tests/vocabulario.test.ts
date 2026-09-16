/**
 * O vocabulário da pergunta contra o da fonte.
 *
 * Os casos são os MEDIDOS nos 9.336 agregados da API v3 em 2026-09-16:
 * "populacao" (sem acento), "renda", "desemprego", "inflação", "cidade",
 * "moradia", "natalidade", "gênero", "universidade", "luz" e "mortes"
 * devolviam ZERO, ou quase, com a tabela existindo sob a grafia do IBGE.
 * As linhas de fixture abaixo são pares código/nome REAIS, lidos de
 * /api/v3/agregados, para o teste não provar uma tabela contra si mesma — e o
 * primeiro caso confere cada código contra a lista versionada
 * (tests/fixtures/agregados-ids.txt), porque código montado por padrão é
 * hipótese, não fato.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ibgeSidraTabelas } from "../src/tools/sidra-tabelas.js";
import { entradasSidra } from "../src/tools/deep-research.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";
import {
  casaBusca,
  expandirBusca,
  expandirTermo,
  normalizar,
  notasDeVocabulario,
  palavrasPerguntadas,
  termosDaBusca,
} from "../src/vocabulario.js";

interface Linha {
  id: string;
  nome: string;
  pesquisa: string;
  pesquisaNome: string;
}

const linha = (id: string, nome: string, pesquisa: string, pesquisaNome: string): Linha => ({
  id,
  nome,
  pesquisa,
  pesquisaNome,
});

// Pares código/nome REAIS, lidos da API de Agregados em 2026-09-16. O teste
// `códigos do catálogo` abaixo impede que esta fixture derive para ficção.
const AGREGADOS: Linha[] = [
  linha("6579", "População residente estimada", "XF", "Estimativas de População"),
  linha(
    "7109",
    "População residente, por sexo e grupo de idade",
    "B5",
    "Pesquisa Nacional por Amostra de Domicílios Contínua anual"
  ),
  linha(
    "1169",
    "Taxa de desocupação na semana de referência das pessoas de 10 anos ou mais de idade, segundo os meses do ano",
    "IU",
    "Indicadores de Desenvolvimento Sustentável"
  ),
  linha(
    "1172",
    "Rendimento médio mensal real das pessoas de 10 anos ou mais de idade, com rendimento, por sexo",
    "IU",
    "Indicadores de Desenvolvimento Sustentável"
  ),
  linha(
    "1419",
    "IPCA - Variação mensal, acumulada no ano, acumulada em 12 meses e peso mensal, para o índice geral, grupos, subgrupos, itens e subitens de produtos e serviços (de janeiro/2012 até dezembro/2019)",
    "IA",
    "Índice Nacional de Preços ao Consumidor Amplo"
  ),
  linha(
    "1134",
    "Domicílios particulares permanentes, por situação do domicílio, espécie de unidade doméstica, existência de compartilhamento da responsabilidade pelo domicílio com a pessoa responsável, o sexo, a cor ou raça e os grupos de idade da pessoa responsável pelo domicílio",
    "CD",
    "Censo Demográfico"
  ),
  linha(
    "1615",
    "Pessoas ocupadas na semana de referência, por local de exercício do trabalho principal - Resultados Gerais da Amostra",
    "CD",
    "Censo Demográfico"
  ),
  linha(
    "10199",
    "Pessoas de 25 anos ou mais de idade, por nível de instrução, sexo e religião",
    "CD",
    "Censo Demográfico"
  ),
  linha(
    "4192",
    "Pessoas cujo plano de saúde (médico ou odontológico) era pago pelo titular ou outro morador do domicílio, por sexo e valor da mensalidade do plano de saúde principal",
    "XN",
    "Pesquisa Nacional de Saúde"
  ),
  linha(
    "7146",
    "Estudantes do ensino superior, por cor ou raça e tipo de ensino superior",
    "B5",
    "Pesquisa Nacional por Amostra de Domicílios Contínua anual"
  ),
  linha(
    "1425",
    "População residente em domicílios particulares ocupados, nos municípios com presença identificada de aglomerados subnormais, por cor ou raça, segundo o tipo de setor e a situação do domicílio",
    "CD",
    "Censo Demográfico"
  ),
  linha(
    "4165",
    "Pessoas de 18 anos ou mais de idade fumantes de tabaco que procuraram tratamento com profissional de saúde para tentar parar de fumar nos últimos 12 meses, por grupo de idade e situação do domicílio",
    "XN",
    "Pesquisa Nacional de Saúde"
  ),
  linha(
    "10301",
    "Índice de Gini da distribuição do rendimento domiciliar per capita mensal dos moradores em domicílios particulares permanentes ocupados, exclusive os cuja condição no domicílio era pensionista, empregado(a) doméstico(a) ou parente do(a) empregado(a) doméstico(a)",
    "CD",
    "Censo Demográfico"
  ),
  linha(
    "10443",
    "Indicador 1.1.1 - Proporção da população abaixo da linha de pobreza internacional, por sexo, e cor ou raça",
    "C2",
    "Objetivos de Desenvolvimento Sustentável"
  ),
  linha(
    "10453",
    "Dados gerais das unidades locais industriais de empresas industriais com 1 ou mais pessoas ocupadas, segundo as divisões de atividades (CNAE 2.0) (série nova)",
    "PK",
    "Pesquisa Industrial Anual - Empresa"
  ),
  linha(
    "2612",
    "Nascidos vivos, ocorridos no ano, por mês do nascimento, sexo, local de nascimento, número de nascidos por parto, idade da mãe na ocasião do parto e lugar de residência da mãe",
    "RC",
    "Pesquisa Estatísticas do Registro Civil"
  ),
  linha(
    "2654",
    "Óbitos, ocorridos no ano, por mês de ocorrência, natureza do óbito, sexo, idade, local de ocorrência e lugar de residência do falecido",
    "RC",
    "Pesquisa Estatísticas do Registro Civil"
  ),
  linha("1174", "Esperança de vida ao nascer", "IU", "Indicadores de Desenvolvimento Sustentável"),
  linha(
    "158",
    "Número médio de cômodos servindo de dormitório por domicílio",
    "CD",
    "Censo Demográfico"
  ),
  linha(
    "1395",
    "Domicílios particulares permanentes, por situação do domicílio e existência de banheiro ou sanitário e número de banheiros de uso exclusivo do domicílio, segundo o tipo do domicílio, a forma de abastecimento de água, o destino do lixo e a existência de energia elétrica",
    "CD",
    "Censo Demográfico"
  ),
];

/** A semântica de ibge_sidra_tabelas, em memória: nome normalizado, OR no termo, AND entre termos. */
function busca(q: string) {
  const expandidos = expandirBusca(q);
  const achados = AGREGADOS.filter(
    (a) => casaBusca(normalizar(a.nome), expandidos) || casaBusca(a.id, expandidos)
  );
  return {
    ids: achados.map((a) => a.id),
    total: achados.length,
    notas: notasDeVocabulario(expandidos),
  };
}

describe("a fixture é o catálogo, não uma invenção", () => {
  it("todo código da fixture existe na lista versionada da API de Agregados", () => {
    const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
    const ids = new Set(
      readFileSync(join(raiz, "tests/fixtures/agregados-ids.txt"), "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
    );
    for (const a of AGREGADOS) expect(ids, `código ausente do catálogo: ${a.id}`).toContain(a.id);
  });
});

describe("normalização e expansão de termo", () => {
  it("acento e caixa não distinguem: populacao ≡ População", () => {
    expect(normalizar("População")).toBe("populacao");
    expect(normalizar("  Força de  Trabalho ")).toBe("forca de trabalho");
  });

  it("sinônimo medido: renda → rendimento; desemprego → desocupa", () => {
    expect(expandirTermo("renda")).toContain("rendimento");
    expect(expandirTermo("desemprego")).toContain("desocupa");
  });

  it("o próprio termo vem primeiro — expandir nunca perde o que já casava", () => {
    expect(expandirTermo("rendimento")[0]).toBe("rendimento");
    expect(expandirTermo("Cidades")).toEqual(["cidades", "cidade", "municipio"]);
  });

  it("plural do português: municípios → municipio, óbitos → obito, informações → informacao", () => {
    expect(expandirTermo("municípios")).toContain("municipio");
    expect(expandirTermo("óbitos")).toContain("obito");
    expect(expandirTermo("informações")).toContain("informacao");
    expect(expandirTermo("imóveis")).toContain("imovel");
  });

  it("stopword não entra no AND, mas busca só de stopword continua valendo", () => {
    expect(termosDaBusca("grupo de idade")).toEqual(["grupo", "idade"]);
    expect(termosDaBusca("de")).toEqual(["de"]);
  });
});

describe("busca com o vocabulário do usuário", () => {
  it("populacao, sem acento, acha População (o defeito mais caro)", () => {
    const r = busca("populacao residente");
    expect(r.ids).toContain("6579");
    expect(r.ids).toContain("7109");
    expect(r.notas).toEqual([]);
  });

  it("desemprego acha a taxa de desocupação", () => {
    expect(busca("desemprego").ids).toContain("1169");
    expect(busca("desempregados").ids).toContain("1169");
  });

  it("renda acha rendimento", () => {
    expect(busca("renda mensal sexo").ids).toContain("1172");
  });

  it("inflação acha o IPCA", () => {
    expect(busca("inflação mensal").ids).toContain("1419");
  });

  it("moradia e casa acham domicílio", () => {
    expect(busca("moradia").ids).toContain("1134");
    expect(busca("casa energia elétrica").ids).toContain("1395");
  });

  it("cidade acha município", () => {
    expect(busca("cidades favela").ids).toEqual([]);
    expect(busca("cidades aglomerados").ids).toContain("1425");
  });

  it("natalidade e mortes acham nascidos vivos e óbitos", () => {
    expect(busca("natalidade").ids).toContain("2612");
    expect(busca("mortes").ids).toContain("2654");
  });

  it("gênero acha sexo; negros acha cor ou raça", () => {
    expect(busca("gênero idade").ids).toContain("7109");
    expect(busca("negros ensino").ids).toContain("7146");
  });

  it("universidade e faculdade acham ensino superior", () => {
    expect(busca("universidade").ids).toContain("7146");
    expect(busca("faculdade").ids).toContain("7146");
  });

  it("emprego acha pessoas ocupadas", () => {
    expect(busca("emprego trabalho principal").ids).toContain("1615");
  });

  it("fábrica acha indústria; convênio acha plano de saúde; tabagismo acha fumantes", () => {
    expect(busca("fábricas").ids).toContain("10453");
    expect(busca("convênio").ids).toContain("4192");
    expect(busca("tabagismo").ids).toContain("4165");
  });

  it("desigualdade acha Gini; miséria acha pobreza; luz acha energia elétrica", () => {
    expect(busca("desigualdade").ids).toContain("10301");
    expect(busca("miséria").ids).toContain("10443");
    expect(busca("luz").ids).toContain("1395");
  });

  it("expectativa de vida acha esperança de vida; quarto acha dormitório", () => {
    expect(busca("expectativa de vida").ids).toContain("1174");
    expect(busca("quartos").ids).toContain("158");
  });

  it("AND entre palavras, não frase contígua: 'idade sexo' acha 'por sexo e grupo de idade'", () => {
    expect(busca("idade sexo").ids).toContain("7109");
  });

  it("o código também casa: busca '6579' acha a tabela 6579", () => {
    expect(busca("6579").ids).toEqual(["6579"]);
  });

  it("termo sem correspondência nenhuma segue devolvendo zero — expandir não inventa dado", () => {
    expect(busca("turismo").total).toBe(0);
    expect(busca("aposentadoria").total).toBe(0);
    expect(busca("criptomoeda").total).toBe(0);
  });
});

describe("a tradução é dita, não é silenciosa", () => {
  it("a nota nomeia o termo e a palavra do IBGE", () => {
    const notas = busca("renda").notas;
    expect(notas).toHaveLength(1);
    expect(notas[0]).toContain('"renda"');
    expect(notas[0]).toContain("rendimento");
  });

  it("termo que já é o do IBGE não gera nota, nem o mero acento ou plural", () => {
    expect(busca("rendimento").notas).toEqual([]);
    expect(busca("populacao").notas).toEqual([]);
    expect(busca("municípios").notas).toEqual([]);
  });
});

describe("a ponta inversa, para o índice de search (Deep Research)", () => {
  it("um agregado de rendimento é encontrável por renda", () => {
    expect(
      palavrasPerguntadas("Rendimento médio mensal real das pessoas de 10 anos ou mais de idade")
    ).toContain("renda");
  });

  it("um agregado de domicílios por sexo é encontrável por moradia, casa e gênero", () => {
    const k = palavrasPerguntadas(
      "Domicílios particulares permanentes, por sexo da pessoa responsável"
    );
    expect(k).toEqual(expect.arrayContaining(["moradia", "casa", "genero"]));
  });

  it("nome sem palavra da tabela não ganha keyword", () => {
    expect(palavrasPerguntadas("Área dos estabelecimentos agropecuários")).toEqual([]);
  });

  it("entradasSidra carrega as palavras perguntadas nas keywords", () => {
    const [entrada] = entradasSidra([
      {
        id: "IU",
        nome: "Indicadores",
        agregados: [{ id: "1169", nome: "Taxa de desocupação na semana de referência" }],
      },
    ]);
    expect(entrada?.keywords).toEqual(expect.arrayContaining(["desemprego", "desempregado"]));
  });
});

describe("ibge_sidra_tabelas com a busca expandida (fetch mockado)", () => {
  const mockFetch = vi.fn();
  const pesquisas = [
    {
      id: "XF",
      nome: "Estimativas de População",
      agregados: [{ id: "6579", nome: "População residente estimada" }],
    },
    {
      id: "IU",
      nome: "Indicadores de Desenvolvimento Sustentável",
      agregados: [
        {
          id: "1169",
          nome: "Taxa de desocupação na semana de referência das pessoas de 10 anos ou mais de idade, segundo os meses do ano",
        },
      ],
    },
  ];

  beforeEach(() => {
    global.fetch = mockFetch;
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("'populacao' sem acento acha a tabela e não gera nota", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(pesquisas));
    const r = await ibgeSidraTabelas({ busca: "populacao", limite: 20 });
    expect(r.isError).toBeFalsy();
    expect(r.structured).toMatchObject({ total: 1, tabelas: [{ codigo: "6579" }] });
    expect((r.structured as { notas_vocabulario?: string[] }).notas_vocabulario).toBeUndefined();
  });

  it("'desemprego' acha desocupação e a resposta DIZ que traduziu", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(pesquisas));
    const r = await ibgeSidraTabelas({ busca: "desemprego", limite: 20 });
    expect(r.structured).toMatchObject({ total: 1, tabelas: [{ codigo: "1169" }] });
    const notas = (r.structured as { notas_vocabulario?: string[] }).notas_vocabulario;
    expect(notas).toHaveLength(1);
    expect(notas?.[0]).toContain("desocupa");
    expect(r.markdown).toContain("**Vocabulário:**");
  });

  it("'pesquisa' também ignora acento: 'populacao' acha 'Estimativas de População'", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(pesquisas));
    const r = await ibgeSidraTabelas({ pesquisa: "populacao", limite: 20 });
    expect(r.structured).toMatchObject({ total: 1, tabelas: [{ codigo: "6579" }] });
  });

  it("zero resultado vem com a saída: menos palavras e o vocabulário do IBGE", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(pesquisas));
    const r = await ibgeSidraTabelas({ busca: "turismo", limite: 20 });
    expect(r.isError).toBe(true);
    expect(r.markdown).toContain("Nenhuma tabela encontrada");
    expect(r.markdown).toContain("rendimento (não renda)");
  });
});
