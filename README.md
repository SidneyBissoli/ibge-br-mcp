# ibge-br-mcp

[![smithery badge](https://smithery.ai/badge/sidneybissoli/ibge-br-mcp)](https://smithery.ai/server/sidneybissoli/ibge-br-mcp)

MCP Server for IBGE (Brazilian Institute of Geography and Statistics) APIs.

🇧🇷 [Leia em Português](README.pt-BR.md)

This server implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) to provide access to IBGE's public APIs, enabling AI assistants to query geographic, demographic, and statistical data from Brazil.

## Features

- **23 specialized tools** covering all major IBGE data domains
- **Automatic caching** with configurable TTL for optimal performance
- **Retry mechanism** with exponential backoff for network resilience
- **Comprehensive validation** for all input parameters
- **Standardized error handling** with helpful suggestions
- **Full TypeScript support** with strict typing

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
| `ibge_populacao` | Real-time Brazilian population projection |
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

### External Data (BCB & Health)
| Tool | Description |
|:-----|:------------|
| `bcb` | Central Bank data (SELIC, IPCA, exchange rates) |
| `datasaude` | Health indicators via IBGE/DataSUS |

### News & Calendar
| Tool | Description |
|:-----|:------------|
| `ibge_noticias` | IBGE news and press releases |
| `ibge_calendario` | IBGE release and collection calendar |

## Installation

### Prerequisites

- Node.js 18.x or higher
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
      "args": ["ibge-br-mcp"]
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
      "args": ["ibge-br-mcp"]
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

### bcb

Query Central Bank of Brazil data.

```
# SELIC last 12 months
bcb(indicador="selic", ultimos=12)

# IPCA for 2023
bcb(indicador="ipca", dataInicio="01/01/2023", dataFim="31/12/2023")

# Dollar exchange rate last 30 days
bcb(indicador="dolar_venda", ultimos=30)
```

**Available indicators:** selic, cdi, tr, ipca, ipca_acum, igpm, inpc, dolar_compra, dolar_venda, euro, desemprego

### datasaude

Query health indicators via IBGE/DataSUS.

```
# Infant mortality in Brazil
datasaude(indicador="mortalidade_infantil")

# Life expectancy by state
datasaude(indicador="esperanca_vida", nivel_territorial="3")

# List indicators
datasaude(indicador="listar")
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

### External APIs

- **Central Bank (BCB)**: `api.bcb.gov.br/dados/serie/bcdata.sgs` - Interest rates, exchange rates, inflation

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
│       ├── populacao.ts      # ibge_populacao
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
│       ├── bcb.ts            # bcb
│       ├── datasaude.ts      # datasaude
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

The project includes a comprehensive test suite with 227 tests covering:

- Validation functions
- Retry mechanism
- Formatting utilities
- Error handling
- Cache operations
- Integration tests with mocks

```bash
npm test
```

## License

MIT

## Author

Sidney Bissoli

## References

- [IBGE - Data Service](https://servicodados.ibge.gov.br/api/docs/)
- [SIDRA - IBGE Automatic Recovery System](https://sidra.ibge.gov.br/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
