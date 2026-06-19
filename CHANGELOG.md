# Changelog

All notable changes to the IBGE MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.10.0] - 2026-06-19

This release completes **Phase 1 (usability)** of the roadmap: structured
output, parameter consistency, reliability, errors that teach, and the MCP
protocol capabilities (resources, prompts, read-only annotations).

### Added
- **MCP resources** (roadmap item 1.6): five reference catalogs exposed as
  readable `ibge://catalogos/*` resources — `ufs`, `regioes`,
  `niveis-territoriais`, `tabelas-sidra`, `biomas` — returning JSON derived from
  `config.ts` (single source of truth). Lets an agent read the lookup tables it
  needs (UF/region codes, SIDRA territorial levels & table codes, biomes)
  without guessing a code or spending a tool round-trip. Lives in
  `src/resources.ts`.
- **MCP prompts** (roadmap item 1.6): three ready-made analysis templates —
  `comparar-municipios`, `perfil-demografico` and `cruzar-ibge-bcb` — that steer
  the model through chaining the right tools, with zod-validated arguments.
  Lives in `src/prompts.ts`.
- **Read-only tool annotations** (roadmap item 1.6): all 23 tools now declare
  `readOnlyHint`/`idempotentHint`/`openWorldHint` (and `destructiveHint: false`)
  via a shared `READ_ONLY` constant, so MCP clients can auto-approve or badge
  them as safe. Completes roadmap item 1.6.
- **Configurable request timeout** (roadmap item 1.4): every upstream request is
  now bounded by an `AbortController` (default 30s), overridable via the
  `IBGE_MCP_TIMEOUT_MS` environment variable or per call. A timed-out request is
  retried and, if it keeps failing, surfaces a clear "Tempo de resposta
  excedido" message instead of hanging indefinitely.
- **Structured output** (roadmap item 1.2). Data tools now declare an
  `outputSchema` and return a typed `structuredContent` payload alongside the
  Markdown text, so agents can consume data without parsing Markdown. Done for
  all seven data tools — `ibge_sidra`, `ibge_censo`, `ibge_indicadores`,
  `datasaude`, `ibge_populacao`, `ibge_comparar` and `ibge_cidades` (registered
  via `server.registerTool`). A reusable pattern lives in `src/structured.ts`
  (`StructuredToolResult` + `toMcpResult`, plus a shared `sidraRecords` helper
  that turns a SIDRA response into typed `colunas`/`registros`); the remaining
  data tools can adopt it the same way.
  - `ibge_sidra` paginates large results (100 rows/page) via a new `pagina`
    input, with continuation guidance in the text channel.
  - **Field selection**: the tabular tools (`ibge_sidra`, `ibge_censo`,
    `ibge_indicadores`, `datasaude`) accept a `campos` input to keep only
    matching columns (accent/case-insensitive), shrinking both the structured
    payload and the Markdown table. Completes roadmap item 1.2.
  - Convention: success returns `structuredContent`; errors return `isError`
    (the SDK skips output validation); an empty result is success-with-empty
    payload, not an error; non-data responses (e.g. `listar` catalogs) return a
    minimal valid payload with the listing in the text channel.
  - Note: `ibge_sidra` `formato="json"` now returns the structured payload as
    JSON (was the raw SIDRA array).

### Changed
- **Errors that teach the right alternative** (roadmap item 1.4): every tool's
  error path now points at the related tool(s) to try next (e.g. `bcb` →
  `ibge_indicadores`, `ibge_municipios` → `ibge_geocodigo`/`ibge_localidade`,
  `ibge_malhas` ↔ `ibge_malhas_tema`), following the disambiguation map. Tools
  with no natural sibling (`ibge_cnae`, `ibge_nomes`, `ibge_paises`) are
  intentionally left without related-tool noise. The "no data vs real failure"
  split (empty result → `ValidationErrors.emptyResult`; real error →
  `parseHttpError`) was verified across all tools. Completes roadmap item 1.4.
- **Server construction extracted** from `index.ts` into a side-effect-free
  `createServer()` in `src/server.ts`; `index.ts` is now a thin STDIO entry.
  This makes the full MCP protocol surface testable end-to-end.
- **Standardized territorial-level (`nivel_territorial`) nomenclature** across
  `ibge_sidra`, `ibge_censo`, `ibge_datasaude` and `ibge_indicadores`. A single
  `territorialLevelHint`/`territorialLevelList` helper in `config.ts` (backed by
  `TERRITORIAL_LEVEL_LABELS`) now generates every level description and error
  suggestion, ending naming drift (e.g. "Grande Região" vs "Região") and the
  inconsistent/incomplete level lists. Each tool now declares the levels it
  actually supports (roadmap item 1.3 — completes 1.3).

- **Unified locality (UF) input** across `ibge_municipios`, `ibge_vizinhos` and
  `ibge_geocodigo`: a state can now be given by sigla (`SP`), name (`São Paulo`,
  accent/case-insensitive) or IBGE code (`35`) interchangeably. New single
  resolver `resolveUf` in `config.ts` is the source of truth; `normalizeUf`
  delegates to it. Removes a sigla-only schema constraint on `ibge_municipios`
  and a duplicated lookup map in `ibge_geocodigo` (roadmap item 1.3).
- **Unified date input format** across all date-taking tools (`bcb`, `ibge_noticias`,
  `ibge_calendario`). All now accept the canonical Brazilian `DD/MM/AAAA` (plus
  `DD-MM-AAAA` and ISO `AAAA-MM-DD`) and convert internally to each upstream API's
  required format. Previously `ibge_noticias`/`ibge_calendario` required the
  ambiguous month-first `MM-DD-AAAA`, which silently produced wrong or empty
  results. New helpers `parseUserDate` / `toBcbDate` / `toIbgeApiDate` in
  `validation.ts` centralize this (roadmap item 1.3).

  Roadmap item 1.3 (parameter consistency) is now complete.

### Tests
- Raised coverage of the priority data tools well past the ≥50% target
  (`sidra` 0→86%, `malhas` 0→95%, `indicadores` 53→87%, `censo` 51→81%, plus
  `datasaude` 16→88%): URL building, table/JSON formatting, number formatting,
  parameter validation, and graceful handling of empty results vs upstream
  failures. Adds a shared `tests/helpers.ts` mock helper (roadmap item 1.5).
- Closed the remaining coverage long tail — every tool is now ≥50%, with the
  `src/tools` directory at ~89% (`cnae`, `geocodigo`, `sidra-tabelas`,
  `noticias`, `comparar`, `paises`, `nomes`, `malhas-tema`, `populacao`,
  `pesquisas`, `vizinhos`, `cidades`, `sidra-metadados`). `cidades`/`paises`
  previously had schema-only tests and now exercise the tool functions. Suite:
  290 → 436 tests, all green.
- Added end-to-end protocol tests (`tests/server.test.ts`) that drive the real
  server over an in-memory transport and client: tool annotations, resource
  listing/reads, and prompt expansion. Plus request-timeout tests
  (`retry.test.ts`/`errors.test.ts`) and related-tools error tests
  (`integration.test.ts`). Suite: 436 → 460 tests.

### Fixed
- `ibge_censo`, `ibge_datasaude` and `ibge_indicadores` now **validate**
  `nivel_territorial` against their supported levels and return a clear
  "Nível territorial inválido" message, instead of forwarding an unsupported
  level straight to the SIDRA API.
- `ibge_calendario` now reads the real IBGE API fields (`data_divulgacao`,
  `nome_produto`): month grouping and the date column previously rendered `NaN`
  because the code referenced non-existent `data_inicio`/`produto` fields.
- Invalid dates now return a clear "Data inválida" message with the accepted
  formats instead of being passed raw to the upstream API.

## [1.9.0] - 2024

### Added
- **Países tool** (`ibge_paises`): Query international country data from IBGE
  - List all countries (UN M49 methodology)
  - Search countries by name
  - Filter by region/continent (Americas, Europe, Africa, Asia, Oceania)
  - Get detailed country information (area, languages, currency, indicators)
- **Cidades tool** (`ibge_cidades`): Query municipal indicators (similar to Cidades@IBGE portal)
  - Municipal panorama with key indicators (population, GDP, HDI, etc.)
  - Historical indicator data over time
  - Research and indicator listing
- **Test suite**: Comprehensive unit tests for paises and cidades tools (36 new tests)
- **Package metadata**: Added homepage and bugs.url fields

### Changed
- All 23 tool descriptions standardized to English for MCP catalog compatibility
- README completely rewritten in English with comprehensive documentation

### Fixed
- Phase 4 tools (ibge_paises, ibge_cidades) now properly registered in main server
- SERVER_VERSION updated to 1.9.0
- Fixed 14 ESLint non-null assertion warnings using nullish coalescing

## [1.8.0] - 2024

### Added
- **LICENSE**: MIT license file
- **.npmignore**: Proper npm package exclusions

### Fixed
- All linter warnings resolved (0 warnings)

## [1.7.0] - 2024

### Added
- **Testing framework**: Vitest with comprehensive test suite
  - 173 unit tests covering validation, cache, errors, retry, and formatters
  - Test coverage configuration (v8 provider)
  - Test timeout settings for network operations

## [1.6.0] - 2024

### Added
- **Retry mechanism**: Exponential backoff for network failures
  - Configurable retry count and delay
  - Custom retry conditions
  - Retry utility for fetch operations

## [1.5.0] - 2024

### Added
- **Centralized validation**: Input validation with descriptive error messages
  - IBGE code validation (regions, states, municipalities, districts)
  - UF normalization (abbreviation to code conversion)
  - Date format validation
  - Period validation (years, ranges, quarters)
  - Territorial level validation
  - CNAE code validation

### Changed
- All tools now use centralized validation

## [1.4.0] - 2024

### Added
- **Centralized error handling**: Consistent error messages across all tools
  - HTTP error parsing with helpful suggestions
  - Validation error formatting
  - Tool-specific error context

### Changed
- All tools now use centralized error handling

## [1.3.0] - 2024

### Added
- **ESLint + Prettier**: Code quality and formatting
  - TypeScript-aware linting rules
  - Consistent code formatting
  - Pre-configured for ES modules

## [1.2.0] - 2024

### Added
- **Performance metrics**: Request tracking and performance monitoring
  - Request duration tracking
  - API endpoint categorization
  - Success/failure statistics
  - Average response times

### Changed
- All tools now report metrics via `withMetrics` wrapper

## [1.1.0] - 2024

### Added
- **Centralized utilities**: Common formatting functions
  - `formatNumber`: Locale-aware number formatting
  - `truncate`: String truncation with ellipsis
  - `createMarkdownTable`: Markdown table generation
  - `buildQueryString`: URL query string construction

### Changed
- All tools migrated to use centralized utilities
- Consistent number and date formatting across all tools

## [1.0.0] - 2024

### Added
- **Cache system**: In-memory caching with TTL
  - Configurable TTL levels (STATIC, MEDIUM, SHORT, REALTIME)
  - Cache key generation with parameter normalization
  - Automatic cache expiration

### Changed
- All tools now use caching for improved performance

## [0.9.0] - 2024

### Added
- **Phase 3 tools**:
  - `ibge_malhas_tematicas`: Thematic meshes (health regions, metropolitan areas)
  - `bcb_inflacao`: Central Bank inflation data (IPCA, IGP-M, INPC)
  - `datasaude`: Health indicators (mortality, life expectancy, sanitation)
  - `ibge_indicadores`: Economic and social indicators (GDP, unemployment, IPCA)

## [0.8.0] - 2024

### Added
- **Phase 2 tools**:
  - `ibge_noticias`: IBGE news and releases
  - `ibge_calendario`: IBGE release calendar
  - `ibge_sidra_metadados`: SIDRA table metadata
  - `ibge_pesquisas`: IBGE research surveys
  - `ibge_sidra_tabelas`: SIDRA table search
  - `ibge_censo`: Census data (2022 and 2010)
  - `ibge_cnae`: CNAE economic activity codes

## [0.7.0] - 2024

### Added
- **Phase 1 tools**:
  - `ibge_estados`: Brazilian states
  - `ibge_municipios`: Municipalities by state
  - `ibge_distritos`: Districts
  - `ibge_localidades`: Localities search
  - `ibge_regioes`: Geographic regions
  - `ibge_sidra`: SIDRA data queries
  - `ibge_nomes`: Name frequency statistics
  - `ibge_ranking_nomes`: Name rankings
  - `ibge_malhas`: Geographic meshes (GeoJSON/TopoJSON)

## [0.1.0] - 2024

### Added
- Initial MCP server setup
- Basic project structure
- TypeScript configuration
- Package configuration

---

For more details on each release, see the [commit history](https://github.com/SidneyBissoli/ibge-br-mcp/commits/main).
