#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  estadosSchema,
  ibgeEstados,
  municipiosSchema,
  ibgeMunicipios,
  localidadeSchema,
  ibgeLocalidade,
  populacaoSchema,
  ibgePopulacao,
  sidraSchema,
  ibgeSidra,
  nomesSchema,
  ibgeNomes,
  noticiasSchema,
  ibgeNoticias,
  sidraTabelasSchema,
  ibgeSidraTabelas,
  sidraMetadadosSchema,
  ibgeSidraMetadados,
  malhasSchema,
  ibgeMalhas,
  pesquisasSchema,
  ibgePesquisas,
  censoSchema,
  ibgeCenso,
  // Phase 1 tools (v1.4.0)
  indicadoresSchema,
  ibgeIndicadores,
  cnaeSchema,
  ibgeCnae,
  geocodigoSchema,
  ibgeGeocodigo,
  // Phase 2 tools (v1.5.0)
  calendarioSchema,
  ibgeCalendario,
  compararSchema,
  ibgeComparar,
  // Phase 3 tools (v1.6.0)
  malhasTemaSchema,
  ibgeMalhasTema,
  vizinhosSchema,
  ibgeVizinhos,
  bcbSchema,
  ibgeBcb,
  datasaudeSchema,
  ibgeDatasaude,
  // Phase 4 tools (v1.9.0)
  paisesSchema,
  ibgePaises,
  cidadesSchema,
  ibgeCidades,
} from "./tools/index.js";

// Server metadata
const SERVER_NAME = "ibge-br-mcp";
const SERVER_VERSION = "1.9.0";

/**
 * IBGE MCP Server
 *
 * Provides tools to access IBGE (Brazilian Institute of Geography and Statistics) APIs:
 * - Localities: States, Municipalities, Districts
 * - SIDRA: Aggregated research data (Census, PNAD, GDP, etc.)
 * - Names: Name frequency and rankings in Brazil
 * - News: IBGE news and press releases
 * - Population: Real-time population projection
 */
async function main() {
  // Create MCP server instance
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Register ibge_estados tool
  server.tool(
    "ibge_estados",
    `Lists all Brazilian states from IBGE.

Features:
- Lists all 27 states (26 states + Federal District)
- Filter by region (North, Northeast, Southeast, South, Central-West)
- Sort by ID, name, or abbreviation

Examples:
- List all states: (no parameters)
- Northeast states: regiao="NE"
- Sorted by abbreviation: ordenar="sigla"`,
    estadosSchema.shape,
    async (args) => {
      const result = await ibgeEstados(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_municipios tool
  server.tool(
    "ibge_municipios",
    `Lists Brazilian municipalities from IBGE.

Features:
- List municipalities by state (using state abbreviation)
- List all municipalities in Brazil (5,570 municipalities)
- Search by municipality name
- Returns 7-digit IBGE code

Examples:
- São Paulo municipalities: uf="SP"
- Search by name: busca="Campinas"
- MG municipalities containing "Belo": uf="MG", busca="Belo"`,
    municipiosSchema.shape,
    async (args) => {
      const result = await ibgeMunicipios(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_localidade tool
  server.tool(
    "ibge_localidade",
    `Returns details of a specific locality by IBGE code.

Features:
- State information (2-digit code)
- Municipality information (7-digit code)
- District information (9-digit code)
- Complete hierarchy (region, mesoregion, microregion)

Examples:
- São Paulo state: codigo=35
- São Paulo city: codigo=3550308
- District: codigo=355030805`,
    localidadeSchema.shape,
    async (args) => {
      const result = await ibgeLocalidade(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_populacao tool
  server.tool(
    "ibge_populacao",
    `Returns real-time Brazilian population projection.

Features:
- Current population estimate
- Birth rate (average time between births)
- Death rate (average time between deaths)
- Daily population increment

Source: IBGE - Brazilian Population Projection

Note: For historical data or by municipality, use ibge_sidra with tables:
- 6579: Population estimates
- 9514: Census 2022 population`,
    populacaoSchema.shape,
    async (args) => {
      const result = await ibgePopulacao(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_sidra tool
  server.tool(
    "ibge_sidra",
    `Queries SIDRA tables (IBGE's Automatic Recovery System).

SIDRA contains data from IBGE surveys like Census, PNAD, GDP, etc.

Common tables:
- 6579: Population estimates (annual)
- 9514: Census 2022 population
- 200: Census population (1970-2010)
- 4714: Unemployment rate (PNAD Contínua)
- 6381: Average income (PNAD Contínua)
- 6706: GDP at current prices
- 5938: GDP per capita

Territorial levels:
- 1: Brazil
- 2: Region (North, Northeast, etc.)
- 3: State (UF)
- 6: Municipality
- 7: Metropolitan Region

Examples:
- Brazil population 2023: tabela="6579", periodos="2023"
- Population by state: tabela="6579", nivel_territorial="3"
- Census 2022 by municipality: tabela="9514", nivel_territorial="6", localidades="3550308"`,
    sidraSchema.shape,
    async (args) => {
      const result = await ibgeSidra(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_nomes tool
  server.tool(
    "ibge_nomes",
    `Queries name frequency and rankings in Brazil (IBGE).

Features:
1. **Name frequency** (tipo='frequencia'):
   - Birth frequency by decade
   - Multiple names separated by comma
   - Filter by sex and locality

2. **Name ranking** (tipo='ranking'):
   - Most popular names
   - Filter by decade, sex, and locality

Available decades: 1930-2010

Examples:
- Frequency of "Maria": tipo="frequencia", nomes="Maria"
- Compare names: tipo="frequencia", nomes="João,José,Pedro"
- 2000s ranking: tipo="ranking", decada=2000
- Female names: tipo="ranking", sexo="F"`,
    nomesSchema.shape,
    async (args) => {
      const result = await ibgeNomes(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_noticias tool
  server.tool(
    "ibge_noticias",
    `Searches IBGE news and press releases.

Features:
- Latest news and releases
- Search by specific term
- Filter by period (start and end date)
- Filter by type (release or news)
- Filter featured news
- Pagination support

Examples:
- Latest 10 news: (no parameters)
- Search census: busca="censo"
- 2024 news: de="01-01-2024", ate="12-31-2024"
- Releases only: tipo="release"`,
    noticiasSchema.shape,
    async (args) => {
      const result = await ibgeNoticias(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_sidra_tabelas tool
  server.tool(
    "ibge_sidra_tabelas",
    `Lists and searches available SIDRA tables.

Features:
- List all SIDRA tables (aggregates)
- Search by table name
- Filter by survey (Census, PNAD, GDP, etc.)
- Shows code and name of each table

SIDRA contains data from various surveys:
- Demographic Census
- PNAD Contínua (employment, income)
- National Accounts (GDP)
- Industrial Survey
- Agricultural Survey

Examples:
- List tables: (no parameters)
- Search population tables: busca="população"
- Census tables: pesquisa="censo"`,
    sidraTabelasSchema.shape,
    async (args) => {
      const result = await ibgeSidraTabelas(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_sidra_metadados tool
  server.tool(
    "ibge_sidra_metadados",
    `Returns metadata for a specific SIDRA table.

Features:
- General info (name, survey, subject, periodicity)
- Available territorial levels
- Variable list with units
- Classifications and categories
- Available periods

Use this tool to understand table structure BEFORE querying data with ibge_sidra.

Examples:
- Population table metadata: tabela="6579"
- Census 2022 metadata: tabela="9514"
- PNAD unemployment: tabela="4714"`,
    sidraMetadadosSchema.shape,
    async (args) => {
      const result = await ibgeSidraMetadados(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_malhas tool
  server.tool(
    "ibge_malhas",
    `Gets geographic meshes (maps) from IBGE in GeoJSON, TopoJSON, or SVG format.

Features:
- Meshes for Brazil, regions, states, municipalities
- Different resolution levels (internal divisions)
- Different quality levels
- Formats: GeoJSON (data), TopoJSON (compact), SVG (image)

Locality types:
- "BR" or "1" = Entire Brazil
- State abbreviation (e.g., "SP", "RJ")
- State code (e.g., "35" for SP)
- Municipality code (7 digits)

Resolution (internal divisions):
- 0 = Outline only
- 2 = States
- 5 = Municipalities

Examples:
- Brazil with states: localidade="BR", resolucao="2"
- São Paulo with municipalities: localidade="SP", resolucao="5"
- SVG format: localidade="BR", formato="svg"`,
    malhasSchema.shape,
    async (args) => {
      const result = await ibgeMalhas(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_pesquisas tool
  server.tool(
    "ibge_pesquisas",
    `Lists available IBGE surveys and their tables.

Features:
- List all IBGE surveys (Census, PNAD, GDP, etc.)
- Search by name or code
- Show details and tables of a specific survey
- Categorize surveys by theme

Main surveys:
- **Census**: Demographic, Agricultural, MUNIC
- **PNAD Contínua**: Employment, income, education
- **National Accounts**: GDP, investments
- **Economic Surveys**: Industry, Commerce, Services
- **Price Indices**: IPCA, INPC

Examples:
- List all: (no parameters)
- Search population: busca="população"
- PNAD details: detalhes="pnad"`,
    pesquisasSchema.shape,
    async (args) => {
      const result = await ibgePesquisas(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_censo tool
  server.tool(
    "ibge_censo",
    `Queries IBGE Demographic Census data (1970-2022).

Simplified tool to access census data without knowing SIDRA table codes.

Available years: 1970, 1980, 1991, 2000, 2010, 2022

Available themes:
- populacao: Resident population
- alfabetizacao: Literacy rate
- domicilios: Housing characteristics
- idade_sexo: Age pyramid
- religiao: Religion distribution
- cor_raca: Race/color
- rendimento: Monthly income
- educacao: Education level
- trabalho: Employment

Examples:
- Population 2022: ano="2022", tema="populacao"
- Historical series: ano="todos", tema="populacao"
- Literacy 2010 by state: ano="2010", tema="alfabetizacao", nivel_territorial="3"
- List tables: tema="listar"`,
    censoSchema.shape,
    async (args) => {
      const result = await ibgeCenso(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_indicadores tool (Phase 1)
  server.tool(
    "ibge_indicadores",
    `Queries IBGE economic and social indicators.

Available indicators:

**Economic:**
- pib: GDP at current prices
- pib_variacao: GDP variation (%)
- pib_per_capita: GDP per capita
- industria: Industrial production
- comercio: Retail sales
- servicos: Services volume

**Prices:**
- ipca: Monthly IPCA
- ipca_acumulado: 12-month IPCA
- inpc: Monthly INPC

**Labor:**
- desemprego: Unemployment rate
- ocupacao: Employed people
- rendimento: Average income
- informalidade: Informality rate

**Population:**
- populacao: Population estimate
- densidade: Population density

Examples:
- GDP: indicador="pib"
- IPCA last 12 months: indicador="ipca", periodos="last 12"
- Unemployment by state: indicador="desemprego", nivel_territorial="3"
- List indicators: indicador="listar"`,
    indicadoresSchema.shape,
    async (args) => {
      const result = await ibgeIndicadores(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_cnae tool (Phase 1)
  server.tool(
    "ibge_cnae",
    `Queries CNAE (National Classification of Economic Activities) from IBGE.

CNAE is the official classification for economic activities in Brazil.

Hierarchical structure:
- Section (letter A-U): 21 main categories
- Division (2 digits): 87 divisions
- Group (3 digits): 285 groups
- Class (4-5 digits): 673 classes
- Subclass (7 digits): 1,332 subclasses

Features:
- Search by CNAE code
- Search by activity description
- List by hierarchical level
- Show complete hierarchy

Examples:
- Search software: busca="software"
- Specific code: codigo="6201-5/01"
- View section: codigo="J"
- List divisions: nivel="divisoes"`,
    cnaeSchema.shape,
    async (args) => {
      const result = await ibgeCnae(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_geocodigo tool (Phase 1)
  server.tool(
    "ibge_geocodigo",
    `Decodes IBGE codes or searches codes by locality name.

Features:
- Decode region, state, municipality, or district codes
- Search IBGE code by name
- Show complete geographic hierarchy
- Return related codes

Code structure:
- 1 digit: Region (1=North, 2=Northeast, 3=Southeast, 4=South, 5=Central-West)
- 2 digits: State (11-53)
- 7 digits: Municipality
- 9 digits: District

Examples:
- Decode municipality: codigo="3550308"
- Decode state: codigo="35"
- Search by name: nome="São Paulo"
- Municipality in state: nome="Campinas", uf="SP"`,
    geocodigoSchema.shape,
    async (args) => {
      const result = await ibgeGeocodigo(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_calendario tool (Phase 2)
  server.tool(
    "ibge_calendario",
    `Queries IBGE release and collection calendar.

Features:
- List upcoming survey releases
- Filter by product (IPCA, PNAD, GDP, etc.)
- Filter by period
- Distinguish releases from field collections

Event types:
- **Release**: Publication of survey results
- **Collection**: Field research period

Examples:
- Upcoming releases: (no parameters)
- IPCA releases: produto="IPCA"
- 2024 calendar: de="01-01-2024", ate="12-31-2024"
- Field collections: tipo="coleta"`,
    calendarioSchema.shape,
    async (args) => {
      const result = await ibgeCalendario(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_comparar tool (Phase 2)
  server.tool(
    "ibge_comparar",
    `Compares data between localities (municipalities or states).

Available indicators:
- populacao: Current population estimate
- populacao_censo: Census 2022 population
- pib: GDP per capita
- area: Territorial area (km²)
- densidade: Population density (inhab/km²)
- alfabetizacao: Literacy rate
- domicilios: Number of households

Features:
- Compare up to 10 localities at once
- Calculate statistics (max, min, average, variation)
- Generate ranked output
- Accept municipality codes (7 digits) or state codes (2 digits)

Examples:
- Compare capitals: localidades="3550308,3304557,4106902", indicador="populacao"
- Compare states: localidades="35,33,41", indicador="pib"
- Area ranking: localidades="3550308,3304557", formato="ranking"
- List indicators: indicador="listar"`,
    compararSchema.shape,
    async (args) => {
      const result = await ibgeComparar(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_malhas_tema tool (Phase 3)
  server.tool(
    "ibge_malhas_tema",
    `Gets thematic geographic meshes from IBGE.

Available themes:
- biomas: Brazilian biomes (Amazon, Cerrado, Atlantic Forest, Caatinga, Pampa, Pantanal)
- amazonia_legal: Legal Amazon area
- semiarido: Semi-arid region
- costeiro: Coastal zone
- fronteira: Border strip
- metropolitana: Metropolitan regions
- ride: Integrated Development Regions

Biome codes:
- 1: Amazon
- 2: Cerrado
- 3: Atlantic Forest
- 4: Caatinga
- 5: Pampa
- 6: Pantanal

Examples:
- All biomes: tema="biomas"
- Amazon biome: tema="biomas", codigo="1"
- Legal Amazon: tema="amazonia_legal"
- Metropolitan regions: tema="metropolitana"
- With municipalities: tema="biomas", resolucao="5"
- List themes: tema="listar"`,
    malhasTemaSchema.shape,
    async (args) => {
      const result = await ibgeMalhasTema(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_vizinhos tool (Phase 3)
  server.tool(
    "ibge_vizinhos",
    `Finds nearby/neighboring municipalities.

Features:
- Search by IBGE code (7 digits) or municipality name
- Returns municipalities in the same mesoregion (proximity approximation)
- Optionally includes population data

Note: Uses mesoregion as geographic proximity proxy.
For exact spatial neighborhood, mesh processing would be required.

Examples:
- By code: municipio="3550308"
- By name: municipio="Campinas", uf="SP"
- With population: municipio="3550308", incluir_dados=true`,
    vizinhosSchema.shape,
    async (args) => {
      const result = await ibgeVizinhos(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register bcb tool (Phase 3)
  server.tool(
    "bcb",
    `Queries Central Bank of Brazil (BCB) data.

Interest Rate Indicators:
- selic: Accumulated SELIC rate
- cdi: CDI rate
- tr: Reference Rate

Inflation Indicators:
- ipca: Monthly IPCA
- ipca_acum: 12-month accumulated IPCA
- igpm: IGP-M
- inpc: INPC

Exchange Rate Indicators:
- dolar_compra/dolar_venda: Commercial dollar
- euro: Euro

Macroeconomic Indicators:
- desemprego: Unemployment rate
- divida_pib: Public debt/GDP
- reservas: International reserves

Also accepts numeric codes from BCB's SGS System.

Examples:
- SELIC last 12 months: indicador="selic", ultimos=12
- IPCA for 2023: indicador="ipca", dataInicio="01/01/2023", dataFim="31/12/2023"
- Recent dollar: indicador="dolar_venda", ultimos=30
- List indicators: indicador="listar"`,
    bcbSchema.shape,
    async (args) => {
      const result = await ibgeBcb(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register datasaude tool (Phase 3)
  server.tool(
    "datasaude",
    `Queries Brazil health indicators via IBGE/DataSUS.

Mortality and Birth:
- mortalidade_infantil: Infant mortality rate
- nascidos_vivos: Live births by location
- obitos: Deaths by residence
- obitos_causas: Deaths by cause (ICD-10)

Demographic Indicators:
- esperanca_vida: Life expectancy at birth
- fecundidade: Fertility rate

Sanitation:
- saneamento_agua: Water supply
- saneamento_esgoto: Sewage system

Health Coverage:
- plano_saude: Health insurance coverage
- autoavaliacao_saude: Self-rated health status

Territorial levels: 1=Brazil, 2=Region, 3=State, 6=Municipality

Examples:
- Infant mortality: indicador="mortalidade_infantil"
- Life expectancy by state: indicador="esperanca_vida", nivel_territorial="3"
- Deaths in SP: indicador="obitos", nivel_territorial="3", localidade="35"
- List indicators: indicador="listar"`,
    datasaudeSchema.shape,
    async (args) => {
      const result = await ibgeDatasaude(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_paises tool (Phase 4)
  server.tool(
    "ibge_paises",
    `Queries international country data via IBGE.

Features:
- List all countries (following UN M49 methodology)
- Country details (area, languages, currency, location)
- Search countries by name
- Filter by region/continent

Available regions: americas, europa, africa, asia, oceania

Country codes: Use ISO-ALPHA-2 (e.g., BR, US, AR, PT, JP)

Examples:
- List all: tipo="listar"
- Brazil details: tipo="detalhes", pais="BR"
- Search: tipo="buscar", busca="Argentina"
- Americas countries: tipo="listar", regiao="americas"
- Available indicators: tipo="indicadores"`,
    paisesSchema.shape,
    async (args) => {
      const result = await ibgePaises(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_cidades tool (Phase 4)
  server.tool(
    "ibge_cidades",
    `Queries municipal indicators from IBGE (similar to Cidades@ portal).

Features:
- General overview of a municipality (population, HDI, GDP, etc.)
- Query specific indicators
- Historical indicator data over years
- List available surveys and indicators

Available indicators: populacao, area, densidade, pib_per_capita, idh,
escolarizacao, mortalidade, salario_medio, receitas, despesas

Examples:
- São Paulo overview: tipo="panorama", municipio="3550308"
- Population history: tipo="historico", municipio="3550308", indicador="populacao"
- View surveys: tipo="pesquisas"
- Available indicators: tipo="indicador"`,
    cidadesSchema.shape,
    async (args) => {
      const result = await ibgeCidades(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Create STDIO transport
  const transport = new StdioServerTransport();

  // Connect server to transport
  await server.connect(transport);

  // Log startup (to stderr to avoid interfering with STDIO protocol)
  console.error(`${SERVER_NAME} v${SERVER_VERSION} started`);
}

// Run the server
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
