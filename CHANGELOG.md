# Changelog

All notable changes to the IBGE MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
