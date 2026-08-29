/**
 * Tool-selection fixtures — 40 realistic pt-BR queries in the persona of the
 * server's target user (Brazilian journalist/researcher/analyst asking for
 * IBGE data), designed for the CONSOLIDATION CHECK (`ibge/docs/03` §4): each
 * overlap cluster is deliberately exercised with queries whose right answer
 * discriminates between the sibling tools, plus controls with no sibling.
 *
 * Fixture id prefix = cluster: `pop-` (população, the 6-tool worst case),
 * `eco-` (econômico), `loc-` (localidades), `sidra-` (fluxo SIDRA),
 * `malha-` (malhas), `ctrl-` (controls without siblings).
 *
 * `expectedTools` = the acceptable FIRST tool call(s); more than one entry
 * only where two tools are genuinely defensible first steps.
 *
 * Decision rule (registered in `ibge/roadmap.md`): top-1 ≥90% → confirm
 * "disambiguate without merging"; systematic confusion inside one cluster →
 * propose surgical merge of THAT cluster to the decision-maker — never a
 * universal search+get.
 */

import type { EvalFixture } from "@sbissoli/mcp-evals";

export const FIXTURES: EvalFixture[] = [
  // ── população (5 tools em sobreposição — o pior caso mapeado) ────────────
  {
    id: "pop-01",
    query: "Qual é a população do Brasil neste momento?",
    expectedTools: ["ibge_indicadores"],
    note: "A estimativa nacional mais recente é ibge_indicadores (indicador='populacao'). Era de ibge_populacao até 28/08/2026, quando a ferramenta foi aposentada — o IBGE retirou a API de projeções em tempo real.",
  },
  {
    id: "pop-02",
    query: "Qual a população atual de Campinas? Aproveita e me diz o IDH.",
    expectedTools: ["ibge_cidades"],
    note: "Panorama de UM município (população + IDH) é ibge_cidades; indicadores dá a série, censo é histórico.",
  },
  {
    id: "pop-03",
    query: "Quantos habitantes o Brasil tinha no Censo de 1991?",
    expectedTools: ["ibge_censo"],
    note: "Dado censitário histórico é ibge_censo (1970–2022); não é projeção nem série de estimativas.",
  },
  {
    id: "pop-04",
    query: "Compare a população de São Paulo, Rio de Janeiro e Belo Horizonte.",
    expectedTools: ["ibge_comparar"],
    note: "Comparar 2–10 localidades num indicador é exatamente o escopo de ibge_comparar.",
  },
  {
    id: "pop-05",
    query: "Como a estimativa de população do Brasil evoluiu de 2015 até hoje?",
    expectedTools: ["ibge_indicadores"],
    note: "Série temporal de estimativas é ibge_indicadores (indicador='populacao'); censo só cobre anos censitários.",
  },
  {
    id: "pop-06",
    query: "Consulte a tabela 6579 do SIDRA para o município 3550308.",
    expectedTools: ["ibge_sidra"],
    note: "O usuário já sabe a tabela SIDRA — vai direto ao motor de baixo nível ibge_sidra.",
  },
  {
    id: "pop-07",
    query: "Qual município brasileiro teve a maior população no Censo 2022?",
    expectedTools: ["ibge_censo", "ibge_sidra"],
    note: "Ranking censitário: ibge_censo com estatisticas=true é a rota guiada; ibge_sidra (tabela 9514) também resolve.",
  },
  {
    id: "pop-08",
    query: "Monte a pirâmide etária do Brasil no Censo 2010, por sexo e idade.",
    expectedTools: ["ibge_censo"],
    note: "Tema idade_sexo do censo é ibge_censo; não há irmã que sirva pirâmide etária diretamente.",
  },

  // ── econômico ────────────────────────────────────────────────────────────
  {
    id: "eco-01",
    query: "Qual foi o IPCA acumulado nos últimos 12 meses?",
    expectedTools: ["ibge_indicadores"],
    note: "Indicador macro pronto (ipca_acumulado) é ibge_indicadores; SIDRA exigiria saber a tabela.",
  },
  {
    id: "eco-02",
    query: "Qual estado tem a maior taxa de desemprego hoje? E qual a mediana entre os estados?",
    expectedTools: ["ibge_indicadores"],
    note: "Ranking/mediana de indicador por UF é ibge_indicadores com estatisticas=true (roteamento das instructions).",
  },
  {
    id: "eco-03",
    query: "Compare o PIB per capita de Curitiba e Florianópolis.",
    expectedTools: ["ibge_comparar"],
    note: "Duas localidades, um indicador — ibge_comparar, não a série macro de ibge_indicadores.",
  },
  {
    id: "eco-04",
    query: "Existe tabela do SIDRA com PIB dos municípios? Qual o código?",
    expectedTools: ["ibge_sidra_tabelas"],
    note: "Pergunta pelo código de tabela — passo 1 do fluxo SIDRA (busca), não uma consulta de dados.",
  },
  {
    id: "eco-05",
    query: "Me dá um panorama econômico de Sorocaba: PIB per capita e salário médio.",
    expectedTools: ["ibge_cidades"],
    note: "Painel de UM município (Cidades@) é ibge_cidades, mesmo sendo tema econômico.",
  },
  {
    id: "eco-06",
    query: "Qual a variação mais recente da produção industrial brasileira?",
    expectedTools: ["ibge_indicadores"],
    note: "Indicador conjuntural nomeado (industria) é ibge_indicadores.",
  },

  // ── localidades ──────────────────────────────────────────────────────────
  {
    id: "loc-01",
    query: "Liste todos os municípios do Acre.",
    expectedTools: ["ibge_municipios"],
    note: "Listar municípios de uma UF é ibge_municipios.",
  },
  {
    id: "loc-02",
    query: "Qual é o código IBGE de Niterói?",
    expectedTools: ["ibge_geocodigo", "ibge_municipios"],
    note: "Nome→código: ibge_geocodigo resolve em qualquer nível; a busca de ibge_municipios também chega lá.",
  },
  {
    id: "loc-03",
    query: "A que mesorregião e microrregião pertence o código 3106200?",
    expectedTools: ["ibge_localidade", "ibge_geocodigo"],
    note: "Hierarquia completa de um código conhecido: ibge_localidade (registro completo) ou ibge_geocodigo (decomposição).",
  },
  {
    id: "loc-04",
    query: "Quais municípios ficam perto de Ribeirão Preto?",
    expectedTools: ["ibge_vizinhos"],
    note: "Vizinhança/proximidade é exclusiva de ibge_vizinhos.",
  },
  {
    id: "loc-05",
    query: "Quais são os estados da região Nordeste?",
    expectedTools: ["ibge_estados"],
    note: "Lista de UFs por região é ibge_estados (filtro regiao='NE').",
  },
  {
    id: "loc-06",
    query: "O que significa cada parte do código 355030805?",
    expectedTools: ["ibge_geocodigo"],
    note: "Decompor a estrutura de um código é a função declarada de ibge_geocodigo.",
  },

  // ── fluxo SIDRA (tabelas → metadados → dados; pesquisas) ─────────────────
  {
    id: "sidra-01",
    query: "Quais tabelas do SIDRA trazem dados de rebanho bovino?",
    expectedTools: ["ibge_sidra_tabelas"],
    note: "Descobrir código de tabela por assunto é ibge_sidra_tabelas (passo 1 do fluxo).",
  },
  {
    id: "sidra-02",
    query: "Quais variáveis, níveis territoriais e períodos a tabela 1612 disponibiliza?",
    expectedTools: ["ibge_sidra_metadados"],
    note: "Estrutura de uma tabela conhecida é ibge_sidra_metadados (passo 2), antes de consultar dados.",
  },
  {
    id: "sidra-03",
    query: "Traga os dados da tabela 1612 para o Paraná.",
    expectedTools: ["ibge_sidra"],
    note: "Consulta de dados com tabela conhecida é ibge_sidra (passo 3).",
  },
  {
    id: "sidra-04",
    query: "Que pesquisas o IBGE realiza na área de agropecuária?",
    expectedTools: ["ibge_pesquisas"],
    note: "Inventário de pesquisas (não de tabelas nem de dados) é ibge_pesquisas.",
  },
  {
    id: "sidra-05",
    query: "Antes de consultar a tabela 4714, preciso confirmar em quais níveis territoriais ela existe.",
    expectedTools: ["ibge_sidra_metadados"],
    note: "Pergunta explícita por estrutura/níveis de tabela específica — metadados, não a consulta em si.",
  },
  {
    id: "sidra-06",
    query: "Quero dados de produção de leite por estado, mas não sei em qual tabela do SIDRA procurar.",
    expectedTools: ["ibge_sidra_tabelas"],
    note: "Sem código de tabela, o fluxo começa na busca de tabelas — não em ibge_sidra direto.",
  },

  // ── malhas ───────────────────────────────────────────────────────────────
  {
    id: "malha-01",
    query: "Preciso do mapa do Brasil com a divisão por estados em GeoJSON.",
    expectedTools: ["ibge_malhas"],
    note: "Malha administrativa (Brasil/UF/município) é ibge_malhas.",
  },
  {
    id: "malha-02",
    query: "Me dá a malha do bioma Cerrado.",
    expectedTools: ["ibge_malhas_tema"],
    note: "Recorte temático (biomas) é ibge_malhas_tema, não a malha administrativa.",
  },
  {
    id: "malha-03",
    query: "Contorno do município de Manaus em SVG, por favor.",
    expectedTools: ["ibge_malhas"],
    note: "Contorno administrativo de um município é ibge_malhas (formato svg).",
  },
  {
    id: "malha-04",
    query: "Qual o recorte geográfico oficial do semiárido brasileiro?",
    expectedTools: ["ibge_malhas_tema"],
    note: "Semiárido é um dos temas de ibge_malhas_tema.",
  },

  // ── controles sem irmã ───────────────────────────────────────────────────
  {
    id: "ctrl-01",
    query: "Qual o código CNAE para desenvolvimento de software sob encomenda?",
    expectedTools: ["ibge_cnae"],
    note: "Classificação de atividade econômica é exclusiva de ibge_cnae.",
  },
  {
    id: "ctrl-02",
    query: "Quantas pessoas se chamam Valentina no Brasil?",
    expectedTools: ["ibge_nomes"],
    note: "Frequência de nome próprio é exclusiva de ibge_nomes.",
  },
  {
    id: "ctrl-03",
    query: "Ranking dos nomes mais registrados na década de 1990.",
    expectedTools: ["ibge_nomes"],
    note: "Ranking de nomes por década é ibge_nomes (tipo='ranking').",
  },
  {
    id: "ctrl-04",
    query: "Qual a moeda e o idioma oficial da Argentina segundo o IBGE?",
    expectedTools: ["ibge_paises"],
    note: "Dados internacionais de país são exclusivos de ibge_paises.",
  },
  {
    id: "ctrl-05",
    query: "Saiu alguma notícia do IBGE sobre o Censo nesta semana?",
    expectedTools: ["ibge_noticias"],
    note: "Notícias já publicadas são ibge_noticias (calendário é para divulgações futuras).",
  },
  {
    id: "ctrl-06",
    query: "Quando será divulgado o próximo IPCA?",
    expectedTools: ["ibge_calendario"],
    note: "Divulgação futura/agendada é ibge_calendario (notícias cobrem o já publicado).",
  },
  {
    id: "ctrl-07",
    query: "Qual a taxa de mortalidade infantil por estado?",
    expectedTools: ["ibge_datasaude"],
    note: "Indicador de saúde nomeado é ibge_datasaude, não censo/indicadores.",
  },
  {
    id: "ctrl-08",
    query: "Qual a esperança de vida ao nascer no Brasil hoje?",
    expectedTools: ["ibge_datasaude"],
    note: "Esperança de vida é indicador de ibge_datasaude.",
  },
  {
    id: "ctrl-09",
    query: "Qual estado tinha a maior taxa de analfabetismo no Censo 2010?",
    expectedTools: ["ibge_censo"],
    note: "Tema censitário (alfabetização) com ranking — ibge_censo com estatisticas=true.",
  },
  {
    id: "ctrl-10",
    query: "Qual foi o rendimento médio do trabalhador brasileiro no último trimestre?",
    expectedTools: ["ibge_indicadores"],
    note: "Indicador de trabalho nomeado (rendimento) é ibge_indicadores.",
  },
  {
    id: "ctrl-11",
    query: "Área territorial e densidade demográfica de Palmas, Tocantins.",
    expectedTools: ["ibge_cidades"],
    note: "Painel de UM município (área, densidade) é ibge_cidades, não comparação nem SIDRA cru.",
  },
  {
    id: "ctrl-12",
    query: "Em quais divisões se organiza a seção J da CNAE?",
    expectedTools: ["ibge_cnae"],
    note: "Hierarquia da classificação CNAE é ibge_cnae (código='J').",
  },
];
