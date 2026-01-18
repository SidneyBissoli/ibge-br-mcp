// Export all tools
export { estadosTool, ibgeEstados, estadosSchema } from "./estados.js";
export { municipiosTool, ibgeMunicipios, municipiosSchema } from "./municipios.js";
export { localidadeTool, ibgeLocalidade, localidadeSchema } from "./localidade.js";
export { populacaoTool, ibgePopulacao, populacaoSchema } from "./populacao.js";
export { sidraTool, ibgeSidra, sidraSchema } from "./sidra.js";
export { nomesTool, ibgeNomes, nomesSchema } from "./nomes.js";
export { noticiasTool, ibgeNoticias, noticiasSchema } from "./noticias.js";

// SIDRA tools
export { sidraTabelasTool, ibgeSidraTabelas, sidraTabelasSchema } from "./sidra-tabelas.js";
export { sidraMetadadosTool, ibgeSidraMetadados, sidraMetadadosSchema } from "./sidra-metadados.js";
export { malhasTool, ibgeMalhas, malhasSchema } from "./malhas.js";
export { pesquisasTool, ibgePesquisas, pesquisasSchema } from "./pesquisas.js";
export { censoTool, ibgeCenso, censoSchema } from "./censo.js";

// Phase 1 tools (v1.4.0)
export { indicadoresTool, ibgeIndicadores, indicadoresSchema } from "./indicadores.js";
export { cnaeTool, ibgeCnae, cnaeSchema } from "./cnae.js";
export { geocodigoTool, ibgeGeocodigo, geocodigoSchema } from "./geocodigo.js";

// Phase 2 tools (v1.5.0)
export { calendarioTool, ibgeCalendario, calendarioSchema } from "./calendario.js";
export { compararTool, ibgeComparar, compararSchema } from "./comparar.js";

// Phase 3 tools (v1.6.0)
export { malhasTemaTool, ibgeMalhasTema, malhasTemaSchema } from "./malhas-tema.js";
export { vizinhosTool, ibgeVizinhos, vizinhosSchema } from "./vizinhos.js";
export { bcbTool, ibgeBcb, bcbSchema } from "./bcb.js";
export { datasaudeTool, ibgeDatasaude, datasaudeSchema } from "./datasaude.js";

// Phase 4 tools (v1.9.0)
export { paisesTool, ibgePaises, paisesSchema } from "./paises.js";
export { cidadesTool, ibgeCidades, cidadesSchema } from "./cidades.js";

// Tool definitions array for registration
export const tools = [
  {
    name: "ibge_estados",
    description: `Lista todos os estados brasileiros do IBGE.

Funcionalidades:
- Lista todos os 27 estados (26 estados + DF)
- Filtra por região (Norte, Nordeste, Sudeste, Sul, Centro-Oeste)
- Ordena por ID, nome ou sigla

Exemplo de uso:
- Listar todos os estados
- Listar estados do Nordeste
- Listar estados ordenados por sigla`,
  },
  {
    name: "ibge_municipios",
    description: `Lista municípios brasileiros do IBGE.

Funcionalidades:
- Lista municípios de um estado específico (usando a sigla da UF)
- Lista todos os municípios do Brasil (5.570 municípios)
- Busca por nome do município
- Retorna código IBGE de 7 dígitos

Exemplo de uso:
- Listar municípios de São Paulo: uf="SP"
- Buscar município por nome: busca="Campinas"
- Listar municípios de MG que contenham "Belo": uf="MG", busca="Belo"`,
  },
  {
    name: "ibge_localidade",
    description: `Retorna detalhes de uma localidade específica pelo código IBGE.

Funcionalidades:
- Busca informações de estados (código de 2 dígitos)
- Busca informações de municípios (código de 7 dígitos)
- Busca informações de distritos (código de 9 dígitos)
- Retorna hierarquia completa (região, mesorregião, microrregião)

Exemplo de uso:
- Detalhes de São Paulo (estado): codigo=35
- Detalhes de São Paulo (município): codigo=3550308
- Detalhes de um distrito: codigo=355030805`,
  },
  {
    name: "ibge_populacao",
    description: `Retorna a projeção da população brasileira em tempo real.

Funcionalidades:
- Estimativa da população atual do Brasil
- Taxa de nascimentos (tempo médio entre nascimentos)
- Taxa de óbitos (tempo médio entre óbitos)
- Incremento populacional diário

Fonte: IBGE - Projeção da População do Brasil

Nota: Para dados históricos ou por município, use a ferramenta ibge_sidra com as tabelas:
- 6579: Estimativas de população
- 9514: População do Censo 2022`,
  },
  {
    name: "ibge_sidra",
    description: `Consulta tabelas do SIDRA (Sistema IBGE de Recuperação Automática).

O SIDRA contém dados de pesquisas do IBGE como Censo, PNAD, PIB, etc.

Tabelas mais utilizadas:
- 6579: Estimativas de população (anual)
- 9514: População do Censo 2022
- 4714: Taxa de desocupação (PNAD Contínua)
- 6706: PIB a preços correntes

Níveis territoriais (todos suportados):
1=Brasil, 2=Grande Região, 3=UF, 6=Município, 7=RM, 8=Meso, 9=Micro,
10=Distrito, 13=RM/RIDE, 17=Região Imediata, 18=Região Intermediária,
105=Macrorregião de Saúde, 106=Região de Saúde, 127=Amazônia Legal, 128=Semiárido

Exemplos:
- Censo 2022 por município: tabela="9514", nivel_territorial="6"
- Dados por Região de Saúde: nivel_territorial="106"`,
  },
  {
    name: "ibge_nomes",
    description: `Consulta frequência e ranking de nomes no Brasil (IBGE).

Funcionalidades:
1. **Frequência de nomes** (tipo='frequencia'):
   - Busca a frequência de nascimentos por década
   - Aceita múltiplos nomes separados por vírgula
   - Filtra por sexo e localidade

2. **Ranking de nomes** (tipo='ranking'):
   - Lista os nomes mais populares
   - Filtra por década, sexo e localidade

Décadas disponíveis: 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010

Exemplos de uso:
- Frequência de "Maria": tipo="frequencia", nomes="Maria"
- Comparar nomes: tipo="frequencia", nomes="João,José,Pedro"
- Ranking anos 2000: tipo="ranking", decada=2000
- Nomes femininos mais populares: tipo="ranking", sexo="F"
- Nomes populares em SP: tipo="ranking", localidade="35"`,
  },
  {
    name: "ibge_noticias",
    description: `Busca notícias e releases do IBGE.

Funcionalidades:
- Lista as últimas notícias e releases do IBGE
- Busca por termo específico
- Filtra por período (data inicial e final)
- Filtra por tipo (release ou notícia)
- Filtra notícias em destaque
- Suporta paginação

Exemplos de uso:
- Últimas 10 notícias: (sem parâmetros)
- Buscar sobre censo: busca="censo"
- Notícias de 2024: de="01-01-2024", ate="12-31-2024"
- Apenas releases: tipo="release"
- Apenas destaques: destaque=true
- Segunda página: pagina=2`,
  },
  {
    name: "ibge_sidra_tabelas",
    description: `Lista e busca tabelas disponíveis no SIDRA (Sistema IBGE de Recuperação Automática).

Funcionalidades:
- Lista todas as tabelas (agregados) do SIDRA
- Busca por termo no nome da tabela
- Filtra por pesquisa (Censo, PNAD, PIB, etc.)
- Mostra o código e nome de cada tabela

Exemplos de uso:
- Listar tabelas: (sem parâmetros)
- Buscar tabelas de população: busca="população"
- Tabelas do Censo: pesquisa="censo"`,
  },
  {
    name: "ibge_sidra_metadados",
    description: `Retorna os metadados de uma tabela SIDRA específica.

Funcionalidades:
- Informações gerais (nome, pesquisa, assunto, periodicidade)
- Níveis territoriais disponíveis (Brasil, UF, município, etc.)
- Lista de variáveis com unidades
- Classificações e categorias de cada variável
- Períodos disponíveis

Exemplos de uso:
- Metadados da tabela de população: tabela="6579"
- Metadados do Censo 2022: tabela="9514"`,
  },
  {
    name: "ibge_malhas",
    description: `Obtém malhas geográficas (mapas) do IBGE em formato GeoJSON, TopoJSON ou SVG.

Funcionalidades:
- Malhas do Brasil, regiões, estados, municípios
- Diferentes níveis de resolução (divisões internas)
- Diferentes níveis de qualidade do traçado
- Formatos: GeoJSON, TopoJSON, SVG

Exemplos de uso:
- Brasil com estados: localidade="BR", resolucao="2"
- São Paulo com municípios: localidade="SP", resolucao="5"
- Município específico: localidade="3550308"`,
  },
  {
    name: "ibge_pesquisas",
    description: `Lista as pesquisas disponíveis no IBGE e suas tabelas.

Funcionalidades:
- Lista todas as pesquisas do IBGE (Censos, PNAD, PIB, etc.)
- Busca por nome ou código da pesquisa
- Mostra detalhes e tabelas de uma pesquisa específica
- Categoriza pesquisas por tema

Exemplos de uso:
- Listar todas as pesquisas: (sem parâmetros)
- Buscar pesquisas de população: busca="população"
- Detalhes da PNAD: detalhes="pnad"`,
  },
  {
    name: "ibge_censo",
    description: `Consulta dados dos Censos Demográficos do IBGE (1970-2022).

Ferramenta simplificada para acessar dados censitários.

Anos: 1970, 1980, 1991, 2000, 2010, 2022

Temas: populacao, alfabetizacao, domicilios, idade_sexo, religiao,
cor_raca, rendimento, migracao, educacao, trabalho

Exemplos:
- População 2022: ano="2022", tema="populacao"
- Série histórica: ano="todos", tema="populacao"
- Listar tabelas: tema="listar"`,
  },
  {
    name: "ibge_indicadores",
    description: `Consulta indicadores econômicos e sociais do IBGE.

Indicadores disponíveis:
- pib, pib_variacao, pib_per_capita: Produto Interno Bruto
- ipca, ipca_acumulado, inpc: Índices de preços
- desemprego, ocupacao, rendimento, informalidade: Trabalho
- populacao, densidade: Demografia
- industria, comercio, servicos: Atividade econômica
- agricultura, pecuaria: Agropecuária

Exemplos:
- PIB: indicador="pib"
- IPCA 12 meses: indicador="ipca", periodos="last 12"
- Listar indicadores: indicador="listar"`,
  },
  {
    name: "ibge_cnae",
    description: `Consulta a CNAE (Classificação Nacional de Atividades Econômicas).

Estrutura hierárquica:
- Seção (A-U): 21 categorias
- Divisão (2 dígitos): 87 divisões
- Grupo (3 dígitos): 285 grupos
- Classe (4-5 dígitos): 673 classes
- Subclasse (7 dígitos): 1.332 subclasses

Exemplos:
- Buscar: busca="software"
- Código: codigo="6201-5/01"
- Listar divisões: nivel="divisoes"`,
  },
  {
    name: "ibge_geocodigo",
    description: `Decodifica códigos IBGE ou busca códigos pelo nome.

Estrutura dos códigos:
- 1 dígito: Região (1-5)
- 2 dígitos: UF (11-53)
- 7 dígitos: Município
- 9 dígitos: Distrito

Exemplos:
- Decodificar: codigo="3550308"
- Buscar: nome="São Paulo"
- Buscar em UF: nome="Campinas", uf="SP"`,
  },
  {
    name: "ibge_calendario",
    description: `Consulta o calendário de divulgações do IBGE.

Funcionalidades:
- Lista próximas divulgações de pesquisas
- Filtra por produto (IPCA, PNAD, PIB, etc.)
- Filtra por período
- Diferencia divulgações e coletas

Exemplos:
- Próximas divulgações: (sem parâmetros)
- Divulgações do IPCA: produto="IPCA"
- Calendário 2024: de="01-01-2024", ate="12-31-2024"`,
  },
  {
    name: "ibge_comparar",
    description: `Compara dados entre localidades (municípios ou UFs).

Indicadores: populacao, pib, area, densidade, alfabetizacao, domicilios

Funcionalidades:
- Compara até 10 localidades
- Calcula estatísticas (maior, menor, média)
- Gera ranking ordenado

Exemplos:
- Comparar capitais: localidades="3550308,3304557"
- Ranking por área: formato="ranking"
- Listar indicadores: indicador="listar"`,
  },
  {
    name: "ibge_malhas_tema",
    description: `Obtém malhas geográficas temáticas do IBGE.

Temas disponíveis:
- biomas: Biomas brasileiros (Amazônia, Cerrado, Mata Atlântica, etc.)
- amazonia_legal: Área da Amazônia Legal
- semiarido: Região do semiárido
- costeiro: Zona costeira
- fronteira: Faixa de fronteira
- metropolitana: Regiões metropolitanas
- ride: Regiões Integradas de Desenvolvimento

Exemplos:
- Todos os biomas: tema="biomas"
- Bioma Amazônia: tema="biomas", codigo="1"
- Listar temas: tema="listar"`,
  },
  {
    name: "ibge_vizinhos",
    description: `Busca municípios próximos/vizinhos de um município.

Funcionalidades:
- Busca por código IBGE ou nome do município
- Retorna municípios da mesma mesorregião
- Opcionalmente inclui dados populacionais

Exemplos:
- Por código: municipio="3550308"
- Por nome: municipio="Campinas", uf="SP"
- Com população: municipio="3550308", incluir_dados=true`,
  },
  {
    name: "bcb",
    description: `Consulta dados do Banco Central do Brasil.

Indicadores disponíveis:
- selic: Taxa SELIC
- ipca/ipca_acum: Inflação IPCA
- igpm/inpc: Outros índices de preços
- dolar_compra/dolar_venda/euro: Câmbio
- desemprego: Taxa de desemprego
- cdi/tr: Outras taxas

Também aceita códigos do Sistema SGS do BCB.

Exemplos:
- SELIC últimos 12 meses: indicador="selic", ultimos=12
- IPCA de 2023: indicador="ipca", dataInicio="01/01/2023", dataFim="31/12/2023"
- Listar indicadores: indicador="listar"`,
  },
  {
    name: "datasaude",
    description: `Consulta indicadores de saúde via IBGE/DataSUS.

Indicadores disponíveis:
- mortalidade_infantil: Taxa de mortalidade infantil
- esperanca_vida: Esperança de vida ao nascer
- nascidos_vivos/obitos: Estatísticas vitais
- fecundidade: Taxa de fecundidade
- saneamento_agua/saneamento_esgoto: Saneamento básico
- plano_saude: Cobertura de planos de saúde

Níveis territoriais: 1=Brasil, 2=Região, 3=UF, 6=Município

Exemplos:
- Mortalidade infantil: indicador="mortalidade_infantil"
- Esperança de vida por UF: indicador="esperanca_vida", nivel_territorial="3"
- Listar indicadores: indicador="listar"`,
  },
  {
    name: "ibge_paises",
    description: `Consulta dados de países e territórios internacionais via IBGE.

Funcionalidades:
- Lista todos os países (seguindo metodologia M49 da ONU)
- Detalhes de um país específico (área, línguas, moeda, localização)
- Busca países por nome
- Filtra por região/continente

Regiões disponíveis: americas, europa, africa, asia, oceania

Códigos de países: Use ISO-ALPHA-2 (ex: BR, US, AR, PT, JP)

Exemplos:
- Listar todos: tipo="listar"
- Detalhes do Brasil: tipo="detalhes", pais="BR"
- Buscar: tipo="buscar", busca="Argentina"
- Países da América: tipo="listar", regiao="americas"`,
  },
  {
    name: "ibge_cidades",
    description: `Consulta indicadores municipais do IBGE (similar ao portal Cidades@).

Funcionalidades:
- Panorama geral de um município (população, IDH, PIB, etc.)
- Consulta indicadores específicos
- Histórico de indicadores ao longo dos anos
- Lista pesquisas e indicadores disponíveis

Indicadores disponíveis: populacao, area, densidade, pib_per_capita, idh,
escolarizacao, mortalidade, salario_medio, receitas, despesas

Exemplos:
- Panorama de São Paulo: tipo="panorama", municipio="3550308"
- Histórico de população: tipo="historico", municipio="3550308", indicador="populacao"
- Ver pesquisas: tipo="pesquisas"
- Detalhes de pesquisa: tipo="pesquisas", pesquisa="33"`,
  },
];
