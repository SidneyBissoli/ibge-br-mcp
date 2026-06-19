import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import { toMcpResult } from "./structured.js";

import {
  estadosSchema,
  ibgeEstados,
  municipiosSchema,
  ibgeMunicipios,
  localidadeSchema,
  ibgeLocalidade,
  populacaoSchema,
  populacaoOutputSchema,
  ibgePopulacao,
  sidraSchema,
  sidraOutputSchema,
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
  censoOutputSchema,
  ibgeCenso,
  // Phase 1 tools (v1.4.0)
  indicadoresSchema,
  indicadoresOutputSchema,
  ibgeIndicadores,
  cnaeSchema,
  ibgeCnae,
  geocodigoSchema,
  ibgeGeocodigo,
  // Phase 2 tools (v1.5.0)
  calendarioSchema,
  ibgeCalendario,
  compararSchema,
  compararOutputSchema,
  ibgeComparar,
  // Phase 3 tools (v1.6.0)
  malhasTemaSchema,
  ibgeMalhasTema,
  vizinhosSchema,
  ibgeVizinhos,
  datasaudeSchema,
  datasaudeOutputSchema,
  ibgeDatasaude,
  // Phase 4 tools (v1.9.0)
  paisesSchema,
  ibgePaises,
  cidadesSchema,
  cidadesOutputSchema,
  ibgeCidades,
} from "./tools/index.js";

import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

// Server metadata
export const SERVER_NAME = "ibge-br-mcp";
export const SERVER_VERSION = "2.0.0";

/**
 * Every tool here is a read-only query against a public REST API: it never
 * mutates state (`readOnlyHint`), repeating a call yields the same effect
 * (`idempotentHint`), and it reaches an external/open-world service
 * (`openWorldHint`). Clients can use these hints to auto-approve or badge the
 * tools as safe. Applied to all tool registrations below.
 */
const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/**
 * Builds and configures the IBGE MCP Server with all tools, resources, and
 * prompts registered. Side-effect-free: it does NOT connect a transport, so it
 * is safe to import and call from tests. `index.ts` wraps it with STDIO.
 *
 * Provides tools to access the IBGE (Brazilian Institute of Geography and
 * Statistics) APIs (health data is served via IBGE's SIDRA).
 */
export function createServer(): McpServer {
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
- Sorted by abbreviation: ordenar="sigla"

Use a different tool when:
- Municipalities of a state → ibge_municipios
- Details/hierarchy of one locality by code → ibge_localidade`,
    estadosSchema.shape,
    READ_ONLY,
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
- MG municipalities containing "Belo": uf="MG", busca="Belo"

Use a different tool when:
- Resolve/decode a code at any level (region, state, district), not just municipalities → ibge_geocodigo
- Full details/hierarchy of one locality by code → ibge_localidade
- Neighboring municipalities → ibge_vizinhos`,
    municipiosSchema.shape,
    READ_ONLY,
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
- District: codigo=355030805

This tool returns the full record of ONE locality you already have the code for.
Use a different tool when:
- You have a name and need the code → ibge_municipios (municipalities) or ibge_geocodigo (any level)
- You want to decompose/understand a code's structure → ibge_geocodigo`,
    localidadeSchema.shape,
    READ_ONLY,
    async (args) => {
      const result = await ibgeLocalidade(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_populacao tool
  server.registerTool(
    "ibge_populacao",
    {
      description: `Returns real-time Brazilian population projection.

Features:
- Current population estimate
- Birth rate (average time between births)
- Death rate (average time between deaths)
- Daily population increment

Source: IBGE - Brazilian Population Projection

This tool ONLY returns Brazil's real-time national projection.

Use a different tool when:
- Population of a specific municipality/state → ibge_cidades (panorama)
- Census or historical population → ibge_censo
- Comparing/ranking multiple localities → ibge_comparar
- Population time series → ibge_indicadores
- An arbitrary SIDRA table → ibge_sidra`,
      inputSchema: populacaoSchema.shape,
      outputSchema: populacaoOutputSchema.shape,
      annotations: READ_ONLY,
    },
    async (args) => {
      return toMcpResult(await ibgePopulacao(args));
    }
  );

  // Register ibge_sidra tool
  server.registerTool(
    "ibge_sidra",
    {
      description: `Queries SIDRA tables (IBGE's Automatic Recovery System).

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
- Census 2022 by municipality: tabela="9514", nivel_territorial="6", localidades="3550308"

ibge_sidra is the low-level engine. Prefer a friendlier wrapper when it fits:
- Census themes (1970–2022) → ibge_censo
- Economic/social time series → ibge_indicadores
- Rank/compare 2–10 localities → ibge_comparar
- One municipality's panel → ibge_cidades
Use ibge_sidra_tabelas and ibge_sidra_metadados to find a table code and its structure before querying.`,
      inputSchema: sidraSchema.shape,
      outputSchema: sidraOutputSchema.shape,
      annotations: READ_ONLY,
    },
    async (args) => {
      return toMcpResult(await ibgeSidra(args));
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
    READ_ONLY,
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
- 2024 news: de="01/01/2024", ate="31/12/2024"
- Releases only: tipo="release"

Use a different tool when:
- Scheduled/upcoming release dates (not published news) → ibge_calendario`,
    noticiasSchema.shape,
    READ_ONLY,
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
- Census tables: pesquisa="censo"

This is step 1 of the SIDRA workflow: find a table code → ibge_sidra_metadados (structure) → ibge_sidra (query).
For common data, a wrapper is usually easier: ibge_censo, ibge_indicadores, ibge_comparar, ibge_cidades.`,
    sidraTabelasSchema.shape,
    READ_ONLY,
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
- PNAD unemployment: tabela="4714"

Use this after finding a table code (ibge_sidra_tabelas) and before querying with ibge_sidra.`,
    sidraMetadadosSchema.shape,
    READ_ONLY,
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
- SVG format: localidade="BR", formato="svg"

Use a different tool when:
- Thematic meshes (biomes, Legal Amazon, semi-arid, metropolitan regions) → ibge_malhas_tema`,
    malhasSchema.shape,
    READ_ONLY,
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
- PNAD details: detalhes="pnad"

This lists surveys, not data. To find table codes use ibge_sidra_tabelas; to query data use ibge_sidra (or a wrapper: ibge_censo, ibge_indicadores, ibge_comparar, ibge_cidades).`,
    pesquisasSchema.shape,
    READ_ONLY,
    async (args) => {
      const result = await ibgePesquisas(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_censo tool
  server.registerTool(
    "ibge_censo",
    {
      description: `Queries IBGE Demographic Census data (1970-2022).

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
- List tables: tema="listar"

Use a different tool when:
- Current real-time Brazil population → ibge_populacao
- One municipality's current panel (estimate, HDI, GDP) → ibge_cidades
- Comparing/ranking localities → ibge_comparar
- An arbitrary SIDRA table → ibge_sidra`,
      inputSchema: censoSchema.shape,
      outputSchema: censoOutputSchema.shape,
      annotations: READ_ONLY,
    },
    async (args) => {
      return toMcpResult(await ibgeCenso(args));
    }
  );

  // Register ibge_indicadores tool (Phase 1)
  server.registerTool(
    "ibge_indicadores",
    {
      description: `Queries IBGE economic and social indicators.

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
- List indicators: indicador="listar"

Use a different tool when:
- Comparing/ranking localities → ibge_comparar
- Census themes → ibge_censo
- One municipality's panel → ibge_cidades`,
      inputSchema: indicadoresSchema.shape,
      outputSchema: indicadoresOutputSchema.shape,
      annotations: READ_ONLY,
    },
    async (args) => {
      return toMcpResult(await ibgeIndicadores(args));
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
    READ_ONLY,
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
- Municipality in state: nome="Campinas", uf="SP"

This tool decodes a code's structure and resolves name→code at any level.
Use a different tool when:
- You only need to list/search municipalities → ibge_municipios
- You want the full detailed record of one locality → ibge_localidade`,
    geocodigoSchema.shape,
    READ_ONLY,
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
- 2024 calendar: de="01/01/2024", ate="31/12/2024"
- Field collections: tipo="coleta"

Use a different tool when:
- Already-published news and releases → ibge_noticias`,
    calendarioSchema.shape,
    READ_ONLY,
    async (args) => {
      const result = await ibgeCalendario(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_comparar tool (Phase 2)
  server.registerTool(
    "ibge_comparar",
    {
      description: `Compares data between localities (municipalities or states).

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
- List indicators: indicador="listar"

Use this tool ONLY to rank/compare 2–10 localities on one indicator.
For a single locality, use ibge_cidades (municipal panel), ibge_censo, or ibge_sidra.`,
      inputSchema: compararSchema.shape,
      outputSchema: compararOutputSchema.shape,
      annotations: READ_ONLY,
    },
    async (args) => {
      return toMcpResult(await ibgeComparar(args));
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
- List themes: tema="listar"

Use a different tool when:
- Administrative meshes (Brazil/region/state/municipality outlines) → ibge_malhas`,
    malhasTemaSchema.shape,
    READ_ONLY,
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
- With population: municipio="3550308", incluir_dados=true

Note: proximity is approximated by shared mesoregion (not exact spatial adjacency).
For listing/searching municipalities, use ibge_municipios.`,
    vizinhosSchema.shape,
    READ_ONLY,
    async (args) => {
      const result = await ibgeVizinhos(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register datasaude tool (Phase 3)
  server.registerTool(
    "datasaude",
    {
      description: `Queries Brazil health indicators, served through IBGE's SIDRA (some originally produced by DataSUS, e.g. mortality and births).

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
- List indicators: indicador="listar"

Use a different tool when:
- A single municipality's general panel (which also includes infant mortality) → ibge_cidades
- Population/demographic counts (not health-specific) → ibge_censo or ibge_sidra`,
      inputSchema: datasaudeSchema.shape,
      outputSchema: datasaudeOutputSchema.shape,
      annotations: READ_ONLY,
    },
    async (args) => {
      return toMcpResult(await ibgeDatasaude(args));
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
    READ_ONLY,
    async (args) => {
      const result = await ibgePaises(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Register ibge_cidades tool (Phase 4)
  server.registerTool(
    "ibge_cidades",
    {
      description: `Queries municipal indicators from IBGE (similar to Cidades@ portal).

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
- Available indicators: tipo="indicador"

This tool is the panel for a SINGLE municipality (Cidades@).
Use a different tool when:
- Real-time Brazil population → ibge_populacao
- Census themes / historical series → ibge_censo
- Comparing multiple municipalities → ibge_comparar
- A macro indicator time series → ibge_indicadores`,
      inputSchema: cidadesSchema.shape,
      outputSchema: cidadesOutputSchema.shape,
      annotations: READ_ONLY,
    },
    async (args) => {
      return toMcpResult(await ibgeCidades(args));
    }
  );

  // Reference catalogs (roadmap 1.6) and analysis templates
  registerResources(server);
  registerPrompts(server);

  return server;
}
