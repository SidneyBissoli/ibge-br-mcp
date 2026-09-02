# IBGE Brasil MCP Server

[![npm version](https://img.shields.io/npm/v/ibge-br-mcp.svg)](https://www.npmjs.com/package/ibge-br-mcp)
[![npm downloads](https://img.shields.io/npm/dm/ibge-br-mcp.svg)](https://www.npmjs.com/package/ibge-br-mcp)
[![node](https://img.shields.io/node/v/ibge-br-mcp)](https://www.npmjs.com/package/ibge-br-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![LobeHub](https://lobehub.com/badge/mcp/sidneybissoli-ibge-br-mcp)](https://lobehub.com/mcp/sidneybissoli-ibge-br-mcp)
[![smithery badge](https://smithery.ai/badge/sidneybissoli/ibge-br-mcp)](https://smithery.ai/server/sidneybissoli/ibge-br-mcp)
[![ibge-br-mcp MCP server](https://glama.ai/mcp/servers/@SidneyBissoli/ibge-br-mcp/badges/score.svg)](https://glama.ai/mcp/servers/@SidneyBissoli/ibge-br-mcp)
[![CI](https://github.com/SidneyBissoli/ibge-br-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/SidneyBissoli/ibge-br-mcp/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-%E2%89%A588%25-brightgreen.svg)](https://github.com/SidneyBissoli/ibge-br-mcp/blob/main/vitest.config.ts)
[![GitHub stars](https://img.shields.io/github/stars/SidneyBissoli/ibge-br-mcp?style=flat&logo=github)](https://github.com/SidneyBissoli/ibge-br-mcp)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/SidneyBissoli?logo=githubsponsors&label=Sponsor&color=db61a2)](https://github.com/sponsors/SidneyBissoli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Live, exact Brazilian public data for your AI assistant — with provenance, not guesswork.**

Ask an LLM _"what was Belo Horizonte's population in the 2022 Census?"_ and you get a plausible number from its training data: maybe right, maybe outdated, with no source. `ibge-br-mcp` instead has your assistant query the official **IBGE** APIs in real time — returning the exact figure together with the table and period it came from.

🇧🇷 [Leia em Português](README.pt-BR.md)

This server implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) to give AI assistants live, structured access to Brazil's public geographic, demographic, economic, and health data — sourced from the IBGE APIs (including health indicators served through IBGE's SIDRA system).

## See it in action

Ask your assistant, in English or Portuguese:

- *"What was Belo Horizonte's population in the 2022 Census?"* → `ibge_cidades` / `ibge_censo`
- *"List the municipalities of Espírito Santo."* → `ibge_municipios`
- *"Compare GDP across the Southeast state capitals."* → `ibge_comparar`

The answers come live from the official IBGE APIs — exact figures with the table and period they came from, not numbers guessed from training data.

Want to see a whole analysis rather than a single answer? The
[**end-to-end demo**](docs/demo.md) works one real question — *which state grew
most between the 2010 and 2022 Censuses, and what drove it* — from first call to
conclusion, with every figure as it came back. The
[**practical examples**](examples/README.md) are seven shorter recipes, including
ranking all 5,570 municipalities in a single call.

## Features

- **21 specialized tools** covering all major IBGE data domains
- **Provenance block on every response** — source, canonical URL, reference
  period, real extraction timestamp, ready-to-use citation, and legal regime
  (see [Data provenance](#data-provenance))
- **Reference resources & analysis prompts** (MCP catalogs + ready-made templates)
- **565 automated tests** — 88% overall coverage, 92% across the tools
- **Automatic caching** with configurable TTL for optimal performance
- **Retry mechanism** with exponential backoff for network resilience
- **Comprehensive validation** for all input parameters
- **Standardized error handling** with helpful suggestions
- **Full TypeScript support** with strict typing

📖 **Article (in Portuguese):** [Como achar a tabela certa no SIDRA — e como saber que é a certa](docs/artigo-sidra-tabela-certa.pt-BR.md) — finding the right SIDRA table, the metadata that settles it, a full worked example on 2022 Census data, and the four traps that cost the most. Also published on the site, in Portuguese and English: [sidneybissoli.com](https://sidneybissoli.com/en/blog/posts/sidra-tabela-certa/).

## Data provenance

Since v3.3.0 every successful tool response carries a **provenance block**
([portfolio contract v1.0](https://www.npmjs.com/package/@sbissoli/mcp-provenance)),
so each number is citable, auditable, and reproducible. The block is emitted on
three channels:

1. `structuredContent.provenance` (parseable, visible to the model) — exactly
   six keys: `source` (the IBGE API queried), `source_url` (canonical URL that
   reproduces the query), `data_vintage` (reference period when the source
   exposes one; `null` otherwise), `retrieved_at` (the REAL upstream extraction
   instant, preserved across cache hits, Brasília time), `citation`
   ("Fonte: IBGE — [pesquisa/tabela], [URL], extraído em [data]."), and
   `license` — plus `attribution`, the canonical list of source URLs.
2. `_meta` under `br.com.sidneybissoli.ibge/provenance` and `.../attribution`
   (out-of-band mirror for audit/UI, zero model tokens).
3. A compact text footer appended to the Markdown, for text-only clients.

The IBGE APIs declare no license of their own; the legal regime is Brazil's
open-data framework — Lei 12.527/2011 (LAI) and Decreto 8.777/2016
(unrestricted reuse, free use, obligation limited to crediting the source).
Statistics-mode responses (`estatisticas=true`) and `ibge_comparar` are marked
`derived` with an explanatory note in the canonical block, since the
aggregates are computed server-side from the raw IBGE values.

## Available Tools

### Localities & Geography
| Tool | Description |
|:-----|:------------|
| `ibge_estados` | List Brazilian states with region filtering |
| `ibge_municipios` | List municipalities by state or search by name |
| `ibge_localidade` | Get details of a locality by IBGE code |
| `ibge_geocodigo` | Decode IBGE codes or search codes by name |
| `ibge_vizinhos` | Find neighboring municipalities |

### Statistical Data (SIDRA)
| Tool | Description |
|:-----|:------------|
| `ibge_sidra` | Query SIDRA tables (Census, PNAD, GDP, etc.) |
| `ibge_sidra_tabelas` | List and search available SIDRA tables |
| `ibge_sidra_metadados` | Get table metadata (variables, periods, levels) |
| `ibge_pesquisas` | List IBGE research surveys and their tables |

### Economic & Social Indicators
| Tool | Description |
|:-----|:------------|
| `ibge_indicadores` | Economic and social indicators (GDP, IPCA, unemployment) |
| `ibge_censo` | Census data (1970-2022) with 16 themes |
| `ibge_comparar` | Compare indicators across localities with rankings |

### Municipal Data (Cidades@)
| Tool | Description |
|:-----|:------------|
| `ibge_cidades` | Municipal indicators (population, HDI, GDP per capita, etc.) |

### International Data
| Tool | Description |
|:-----|:------------|
| `ibge_paises` | Country data following UN M49 methodology |

### Demographics
| Tool | Description |
|:-----|:------------|
| `ibge_nomes` | Name frequency and rankings in Brazil |

### Classifications
| Tool | Description |
|:-----|:------------|
| `ibge_cnae` | CNAE (National Classification of Economic Activities) |

### Maps & Geographic Meshes
| Tool | Description |
|:-----|:------------|
| `ibge_malhas` | Geographic meshes (GeoJSON, TopoJSON, SVG) |
| `ibge_malhas_tema` | Thematic meshes (biomes, Legal Amazon, semi-arid) |

### Health
| Tool | Description |
|:-----|:------------|
| `ibge_datasaude` | Health indicators via IBGE's SIDRA |

### News & Calendar
| Tool | Description |
|:-----|:------------|
| `ibge_noticias` | IBGE news and press releases |
| `ibge_calendario` | IBGE release and collection calendar |

## Which tool should I use?

With 21 tools, several can touch the same topic. Quick guide for the common overlaps:

### Population & demographics

| You want… | Use |
|:----------|:----|
| A single municipality/state panel (population, HDI, GDP…) | `ibge_cidades` |
| Census data or historical series (1970–2022) | `ibge_censo` |
| Rank/compare 2–10 localities on one indicator | `ibge_comparar` |
| A macro indicator time series (GDP, IPCA, unemployment…) | `ibge_indicadores` |
| A specific SIDRA table / fine control | `ibge_sidra` |
| The largest/smallest/mean/median across a whole table | `ibge_sidra`/`ibge_censo`/`ibge_indicadores`/`ibge_datasaude` with `estatisticas=true` |

### Economic indicators

| You want… | Use |
|:----------|:----|
| IPCA, INPC, GDP, unemployment (IBGE, primary source) | `ibge_indicadores` |

### Localities & codes

| You want… | Use |
|:----------|:----|
| List/search municipalities | `ibge_municipios` |
| List states | `ibge_estados` |
| Resolve a name→code at any level, or decode a code's structure | `ibge_geocodigo` |
| Full record of one locality you already have the code for | `ibge_localidade` |
| Neighboring municipalities | `ibge_vizinhos` |

### SIDRA workflow

Discover → inspect → query: `ibge_pesquisas` / `ibge_sidra_tabelas` (find a table) → `ibge_sidra_metadados` (its structure) → `ibge_sidra` (query). For common data, the wrappers above (`ibge_censo`, `ibge_indicadores`, `ibge_comparar`, `ibge_cidades`) are usually easier.

### Maps (meshes)

| You want… | Use |
|:----------|:----|
| Administrative outlines (Brazil/region/state/municipality) | `ibge_malhas` |
| Thematic areas (biomes, Legal Amazon, semi-arid, metro regions) | `ibge_malhas_tema` |

## Installation

### Prerequisites

- Node.js 22.x or higher (`engines.node`)
- npm or yarn

### From npm (recommended)

```bash
npm install -g ibge-br-mcp
```

### From source

```bash
# Clone the repository
git clone https://github.com/SidneyBissoli/ibge-br-mcp.git
cd ibge-br-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

## Configuration

### Claude Desktop

Add to your Claude Desktop configuration file (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ibge-br-mcp": {
      "command": "npx",
      "args": ["-y", "ibge-br-mcp"]
    }
  }
}
```

Or if installed from source:

```json
{
  "mcpServers": {
    "ibge-br-mcp": {
      "command": "node",
      "args": ["/path/to/ibge-br-mcp/dist/index.js"]
    }
  }
}
```

### Claude Code

```json
{
  "mcpServers": {
    "ibge-br-mcp": {
      "command": "npx",
      "args": ["-y", "ibge-br-mcp"]
    }
  }
}
```

## Tool Usage Examples

### ibge_estados

List all Brazilian states.

```
# List all states
ibge_estados

# States in Northeast region
ibge_estados(regiao="NE")

# States sorted by abbreviation
ibge_estados(ordenar="sigla")
```

### ibge_municipios

List Brazilian municipalities.

```
# Municipalities of São Paulo state
ibge_municipios(uf="SP")

# Search municipalities by name
ibge_municipios(busca="Campinas")

# Municipalities in MG containing "Belo"
ibge_municipios(uf="MG", busca="Belo")
```

### ibge_cidades

Query municipal indicators (similar to Cidades@ portal).

```
# Panorama of São Paulo
ibge_cidades(tipo="panorama", municipio="3550308")

# Population history
ibge_cidades(tipo="historico", municipio="3550308", indicador="populacao")

# List available research
ibge_cidades(tipo="pesquisas")
```

**Available indicators:** populacao, area, densidade, pib_per_capita, idh, escolarizacao, mortalidade, salario_medio, receitas, despesas

### ibge_paises

Query international country data.

```
# List all countries
ibge_paises(tipo="listar")

# Brazil details
ibge_paises(tipo="detalhes", pais="BR")

# Search countries
ibge_paises(tipo="buscar", busca="Argentina")

# Countries in Americas
ibge_paises(tipo="listar", regiao="americas")
```

**Regions:** americas, europa, africa, asia, oceania

### ibge_sidra

Query SIDRA tables (IBGE's Automatic Recovery System).

```
# Brazil population in 2023
ibge_sidra(tabela="6579", periodos="2023")

# Population by state
ibge_sidra(tabela="6579", nivel_territorial="3", periodos="2023")

# Census 2022 for São Paulo municipality
ibge_sidra(tabela="9514", nivel_territorial="6", localidades="3550308")
```

**Common tables:**
| Code | Description |
|-----:|:------------|
| 6579 | Population estimates (annual) |
| 9514 | Census 2022 population |
| 4714 | Unemployment rate (PNAD) |
| 6706 | GDP at current prices |

**Territorial levels:**
| Code | Level |
|-----:|:------|
| 1 | Brazil |
| 2 | Region (North, Northeast, etc.) |
| 3 | State (UF) |
| 6 | Municipality |
| 7 | Metropolitan Region |
| 106 | Health Region |
| 127 | Legal Amazon |
| 128 | Semi-arid |

**Statistics mode** (also on `ibge_censo`, `ibge_indicadores`, `ibge_datasaude`):
for largest/smallest/mean/median/distribution/ranking questions, pass
`estatisticas=true` — the server computes the full distribution (min/max/mean/
median/std-dev/labeled percentiles) over **all** rows before pagination and
returns `top`/`bottom` rankings (`topN`, default 10). `agruparPor="<column
label>"` ranks groups by descending sum, each with its own mini-distribution.

```
# Which state has the largest estimated population?
ibge_sidra(tabela="6579", nivel_territorial="3", estatisticas=true)

# Census 2022 population distribution grouped by state
ibge_censo(ano="2022", tema="populacao", nivel_territorial="3", estatisticas=true, agruparPor="Unidade da Federação")
```

### ibge_censo

Query Census data (1970-2022).

```
# Population Census 2022
ibge_censo(ano="2022", tema="populacao")

# Historical population series
ibge_censo(ano="todos", tema="populacao")

# Literacy by state in 2010
ibge_censo(ano="2010", tema="alfabetizacao", nivel_territorial="3")
```

**Available themes:** populacao, alfabetizacao, domicilios, idade_sexo, religiao, cor_raca, rendimento, migracao, educacao, trabalho

### ibge_indicadores

Query economic and social indicators.

```
# GDP
ibge_indicadores(indicador="pib")

# IPCA last 12 months
ibge_indicadores(indicador="ipca", periodos="last 12")

# Unemployment by state
ibge_indicadores(indicador="desemprego", nivel_territorial="3")

# List all indicators
ibge_indicadores(indicador="listar")
```

**Available indicators:**
| Category | Indicators |
|:---------|:-----------|
| Economic | pib, pib_variacao, pib_per_capita, industria, comercio, servicos |
| Prices | ipca, ipca_acumulado, inpc |
| Labor | desemprego, ocupacao, rendimento, informalidade |
| Population | populacao, densidade |
| Agriculture | agricultura, pecuaria |

### ibge_nomes

Query name frequency and rankings.

```
# Frequency of "Maria"
ibge_nomes(tipo="frequencia", nomes="Maria")

# Compare names
ibge_nomes(tipo="frequencia", nomes="João,José,Pedro")

# Ranking of names in 2000s
ibge_nomes(tipo="ranking", decada=2000)

# Female names ranking
ibge_nomes(tipo="ranking", sexo="F")
```

### ibge_malhas

Get geographic meshes (maps).

```
# Brazil with states
ibge_malhas(localidade="BR", resolucao="2")

# São Paulo with municipalities
ibge_malhas(localidade="SP", resolucao="5")

# Specific municipality
ibge_malhas(localidade="3550308")

# SVG format
ibge_malhas(localidade="BR", formato="svg")
```

**Resolution levels:**
| Value | Internal Divisions |
|:-----:|:-------------------|
| 0 | No divisions (outline only) |
| 2 | States |
| 5 | Municipalities |

### ibge_datasaude

Query Brazilian health indicators served through IBGE's SIDRA (some originally produced by DataSUS, e.g. mortality and births).

```
# Infant mortality in Brazil
ibge_datasaude(indicador="mortalidade_infantil")

# Life expectancy by state
ibge_datasaude(indicador="esperanca_vida", nivel_territorial="3")

# List indicators
ibge_datasaude(indicador="listar")
```

**Available indicators:** mortalidade_infantil, esperanca_vida, nascidos_vivos, obitos, fecundidade, saneamento_agua, saneamento_esgoto, plano_saude

## APIs Used

### IBGE APIs

- **Localities**: `servicodados.ibge.gov.br/api/v1/localidades`
- **Names**: `servicodados.ibge.gov.br/api/v2/censos/nomes`
- **Aggregates/SIDRA**: `servicodados.ibge.gov.br/api/v3/agregados`
- **SIDRA API**: `apisidra.ibge.gov.br/values`
- **Meshes**: `servicodados.ibge.gov.br/api/v3/malhas`
- **News**: `servicodados.ibge.gov.br/api/v3/noticias`
- **Population**: `servicodados.ibge.gov.br/api/v1/projecoes/populacao`
- **CNAE**: `servicodados.ibge.gov.br/api/v2/cnae`
- **Calendar**: `servicodados.ibge.gov.br/api/v3/calendario`
- **Countries**: `servicodados.ibge.gov.br/api/v1/paises`
- **Research**: `servicodados.ibge.gov.br/api/v1/pesquisas`

## Development

```bash
# Build
npm run build

# Watch mode
npm run watch

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint

# Format
npm run format

# Test with MCP inspector
npm run inspector
```

## Project Structure

```
ibge-br-mcp/
├── src/
│   ├── index.ts              # Main MCP server
│   ├── types.ts              # TypeScript types
│   ├── config.ts             # Configuration and constants
│   ├── cache.ts              # Request caching system
│   ├── retry.ts              # Retry with exponential backoff
│   ├── errors.ts             # Standardized error handling
│   ├── validation.ts         # Input validation helpers
│   ├── metrics.ts            # Metrics and logging
│   ├── utils/
│   │   └── formatters.ts     # Formatting utilities
│   └── tools/
│       ├── index.ts          # Tool exports
│       ├── estados.ts        # ibge_estados
│       ├── municipios.ts     # ibge_municipios
│       ├── localidade.ts     # ibge_localidade
│       ├── geocodigo.ts      # ibge_geocodigo
│       ├── censo.ts          # ibge_censo
│       ├── sidra.ts          # ibge_sidra
│       ├── sidra-tabelas.ts  # ibge_sidra_tabelas
│       ├── sidra-metadados.ts# ibge_sidra_metadados
│       ├── indicadores.ts    # ibge_indicadores
│       ├── cnae.ts           # ibge_cnae
│       ├── calendario.ts     # ibge_calendario
│       ├── comparar.ts       # ibge_comparar
│       ├── malhas.ts         # ibge_malhas
│       ├── malhas-tema.ts    # ibge_malhas_tema
│       ├── vizinhos.ts       # ibge_vizinhos
│       ├── datasaude.ts      # ibge_datasaude
│       ├── pesquisas.ts      # ibge_pesquisas
│       ├── nomes.ts          # ibge_nomes
│       ├── noticias.ts       # ibge_noticias
│       ├── paises.ts         # ibge_paises
│       └── cidades.ts        # ibge_cidades
├── tests/                    # Test files
├── dist/                     # Compiled files
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## Testing

The project includes a comprehensive test suite with 565 tests covering:

- Validation functions
- Retry mechanism
- Formatting utilities
- Error handling
- Cache operations
- Integration tests with mocks

```bash
npm test
```

## Quality Assurance

This project maintains high code quality standards:

- **565 automated tests** covering validation, caching, retry logic, formatting, and integrations
- **88% overall test coverage** — cache and validation modules above 97%
- **ESLint** for code linting with zero warnings
- **Prettier** for consistent code formatting
- **TypeScript strict mode** for type safety
- **Automated CI/CD** via GitHub Actions

Run tests locally:
```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run linter
npm run lint
```

## License

MIT

## Author

Sidney da Silva Pereira Bissoli

## References

- [IBGE - Data Service](https://servicodados.ibge.gov.br/api/docs/)
- [SIDRA - IBGE Automatic Recovery System](https://sidra.ibge.gov.br/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
