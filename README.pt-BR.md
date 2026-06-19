[![Verified on MseeP](https://mseep.net/pr/sidneybissoli-ibge-br-mcp-badge.png)](https://mseep.ai/app/b39475dc-331c-48ff-a0d9-441f6575598c)

# ibge-br-mcp

[![npm version](https://img.shields.io/npm/v/ibge-br-mcp.svg)](https://www.npmjs.com/package/ibge-br-mcp)
[![npm downloads](https://img.shields.io/npm/dm/ibge-br-mcp.svg)](https://www.npmjs.com/package/ibge-br-mcp)
[![Tests](https://img.shields.io/badge/tests-460%20passed-brightgreen.svg)](https://github.com/SidneyBissoli/ibge-br-mcp)
[![Coverage](https://img.shields.io/badge/coverage-core%2097%25-brightgreen.svg)](https://github.com/SidneyBissoli/ibge-br-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![smithery badge](https://smithery.ai/badge/sidneybissoli/ibge-br-mcp)](https://smithery.ai/server/sidneybissoli/ibge-br-mcp)
[![ibge-br-mcp MCP server](https://glama.ai/mcp/servers/SidneyBissoli/ibge-br-mcp/badges/score.svg)](https://glama.ai/mcp/servers/SidneyBissoli/ibge-br-mcp)

**Dados públicos brasileiros ao vivo e exatos para o seu assistente de IA — com procedência, não chute.**

Pergunte a um LLM _"qual era a população de Belo Horizonte no Censo 2022?"_ e você recebe um número plausível, tirado do treino: talvez certo, talvez desatualizado, sem fonte. O `ibge-br-mcp` faz o seu assistente consultar as APIs oficiais do **IBGE** em tempo real — devolvendo o valor exato junto com a tabela e o período de onde ele veio.

🇺🇸 [Read in English](README.md)

Este servidor implementa o [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) para dar aos assistentes de IA acesso ao vivo e estruturado aos dados públicos geográficos, demográficos, econômicos e de saúde do Brasil — vindos das APIs do IBGE (inclusive os indicadores de saúde, servidos pelo SIDRA do IBGE).

## Recursos

- **22 ferramentas especializadas** cobrindo todos os principais domínios de dados do IBGE
- **Resources de referência & prompts de análise** (catálogos MCP + templates prontos)
- **460 testes automatizados** com 97%+ de cobertura no core
- **Cache automático** com TTL configurável para performance otimizada
- **Mecanismo de retry** com backoff exponencial para resiliência de rede
- **Validação abrangente** para todos os parâmetros de entrada
- **Tratamento de erros padronizado** com sugestões úteis
- **Suporte completo a TypeScript** com tipagem estrita

## Ferramentas Disponíveis

### Localidades e Geografia
| Ferramenta | Descrição |
|:-----------|:----------|
| `ibge_estados` | Lista estados brasileiros com filtro por região |
| `ibge_municipios` | Lista municípios por estado ou busca por nome |
| `ibge_localidade` | Obtém detalhes de uma localidade pelo código IBGE |
| `ibge_geocodigo` | Decodifica códigos IBGE ou busca códigos por nome |
| `ibge_vizinhos` | Encontra municípios vizinhos |

### Dados Estatísticos (SIDRA)
| Ferramenta | Descrição |
|:-----------|:----------|
| `ibge_sidra` | Consulta tabelas SIDRA (Censo, PNAD, PIB, etc.) |
| `ibge_sidra_tabelas` | Lista e busca tabelas SIDRA disponíveis |
| `ibge_sidra_metadados` | Obtém metadados de tabelas (variáveis, períodos, níveis) |
| `ibge_pesquisas` | Lista pesquisas do IBGE e suas tabelas |

### Indicadores Econômicos e Sociais
| Ferramenta | Descrição |
|:-----------|:----------|
| `ibge_indicadores` | Indicadores econômicos e sociais (PIB, IPCA, desemprego) |
| `ibge_censo` | Dados censitários (1970-2022) com 16 temas |
| `ibge_comparar` | Compara indicadores entre localidades com rankings |

### Dados Municipais (Cidades@)
| Ferramenta | Descrição |
|:-----------|:----------|
| `ibge_cidades` | Indicadores municipais (população, IDH, PIB per capita, etc.) |

### Dados Internacionais
| Ferramenta | Descrição |
|:-----------|:----------|
| `ibge_paises` | Dados de países seguindo metodologia ONU M49 |

### Demografia
| Ferramenta | Descrição |
|:-----------|:----------|
| `ibge_populacao` | Projeção populacional brasileira em tempo real |
| `ibge_nomes` | Frequência e rankings de nomes no Brasil |

### Classificações
| Ferramenta | Descrição |
|:-----------|:----------|
| `ibge_cnae` | CNAE (Classificação Nacional de Atividades Econômicas) |

### Mapas e Malhas Geográficas
| Ferramenta | Descrição |
|:-----------|:----------|
| `ibge_malhas` | Malhas geográficas (GeoJSON, TopoJSON, SVG) |
| `ibge_malhas_tema` | Malhas temáticas (biomas, Amazônia Legal, semiárido) |

### Saúde
| Ferramenta | Descrição |
|:-----------|:----------|
| `datasaude` | Indicadores de saúde via SIDRA do IBGE |

### Notícias e Calendário
| Ferramenta | Descrição |
|:-----------|:----------|
| `ibge_noticias` | Notícias e releases do IBGE |
| `ibge_calendario` | Calendário de divulgações e coletas do IBGE |

## Qual ferramenta usar?

Com 22 ferramentas, várias podem tocar no mesmo assunto. Guia rápido para as sobreposições comuns:

### População e demografia

| Você quer… | Use |
|:-----------|:----|
| População do Brasil agora (tempo real) | `ibge_populacao` |
| Painel de um único município/UF (população, IDH, PIB…) | `ibge_cidades` |
| Dados censitários ou série histórica (1970–2022) | `ibge_censo` |
| Ranquear/comparar 2–10 localidades num indicador | `ibge_comparar` |
| Série temporal de indicador macro (PIB, IPCA, desemprego…) | `ibge_indicadores` |
| Uma tabela SIDRA específica / controle fino | `ibge_sidra` |

### Indicadores econômicos

| Você quer… | Use |
|:-----------|:----|
| IPCA, INPC, PIB, desemprego (IBGE, fonte primária) | `ibge_indicadores` |

### Localidades e códigos

| Você quer… | Use |
|:-----------|:----|
| Listar/buscar municípios | `ibge_municipios` |
| Listar estados | `ibge_estados` |
| Resolver nome→código em qualquer nível, ou decodificar a estrutura de um código | `ibge_geocodigo` |
| Ficha completa de uma localidade da qual você já tem o código | `ibge_localidade` |
| Municípios vizinhos | `ibge_vizinhos` |

### Fluxo SIDRA

Descobrir → inspecionar → consultar: `ibge_pesquisas` / `ibge_sidra_tabelas` (achar a tabela) → `ibge_sidra_metadados` (sua estrutura) → `ibge_sidra` (consultar). Para dados comuns, os atalhos acima (`ibge_censo`, `ibge_indicadores`, `ibge_comparar`, `ibge_cidades`) costumam ser mais fáceis.

### Mapas (malhas)

| Você quer… | Use |
|:-----------|:----|
| Contornos administrativos (Brasil/região/UF/município) | `ibge_malhas` |
| Áreas temáticas (biomas, Amazônia Legal, semiárido, regiões metropolitanas) | `ibge_malhas_tema` |

## Instalação

### Pré-requisitos

- Node.js 18.x ou superior
- npm ou yarn

### Via npm (recomendado)

```bash
npm install -g ibge-br-mcp
```

### A partir do código-fonte

```bash
# Clone o repositório
git clone https://github.com/SidneyBissoli/ibge-br-mcp.git
cd ibge-br-mcp

# Instale as dependências
npm install

# Compile o projeto
npm run build
```

## Configuração

### Claude Desktop

Adicione ao seu arquivo de configuração do Claude Desktop (`claude_desktop_config.json`):

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

Ou se instalado a partir do código-fonte:

```json
{
  "mcpServers": {
    "ibge-br-mcp": {
      "command": "node",
      "args": ["/caminho/para/ibge-br-mcp/dist/index.js"]
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

## Exemplos de Uso das Ferramentas

### ibge_estados

Lista todos os estados brasileiros.

```
# Listar todos os estados
ibge_estados

# Estados da região Nordeste
ibge_estados(regiao="NE")

# Estados ordenados por sigla
ibge_estados(ordenar="sigla")
```

### ibge_municipios

Lista municípios brasileiros.

```
# Municípios do estado de São Paulo
ibge_municipios(uf="SP")

# Buscar municípios por nome
ibge_municipios(busca="Campinas")

# Municípios de MG contendo "Belo"
ibge_municipios(uf="MG", busca="Belo")
```

### ibge_cidades

Consulta indicadores municipais (similar ao portal Cidades@).

```
# Panorama de São Paulo
ibge_cidades(tipo="panorama", municipio="3550308")

# Histórico populacional
ibge_cidades(tipo="historico", municipio="3550308", indicador="populacao")

# Listar pesquisas disponíveis
ibge_cidades(tipo="pesquisas")
```

**Indicadores disponíveis:** populacao, area, densidade, pib_per_capita, idh, escolarizacao, mortalidade, salario_medio, receitas, despesas

### ibge_paises

Consulta dados internacionais de países.

```
# Listar todos os países
ibge_paises(tipo="listar")

# Detalhes do Brasil
ibge_paises(tipo="detalhes", pais="BR")

# Buscar países
ibge_paises(tipo="buscar", busca="Argentina")

# Países das Américas
ibge_paises(tipo="listar", regiao="americas")
```

**Regiões:** americas, europa, africa, asia, oceania

### ibge_sidra

Consulta tabelas SIDRA (Sistema IBGE de Recuperação Automática).

```
# População do Brasil em 2023
ibge_sidra(tabela="6579", periodos="2023")

# População por estado
ibge_sidra(tabela="6579", nivel_territorial="3", periodos="2023")

# Censo 2022 para o município de São Paulo
ibge_sidra(tabela="9514", nivel_territorial="6", localidades="3550308")
```

**Tabelas comuns:**
| Código | Descrição |
|-------:|:----------|
| 6579 | Estimativas populacionais (anual) |
| 9514 | População Censo 2022 |
| 4714 | Taxa de desemprego (PNAD) |
| 6706 | PIB a preços correntes |

**Níveis territoriais:**
| Código | Nível |
|-------:|:------|
| 1 | Brasil |
| 2 | Região (Norte, Nordeste, etc.) |
| 3 | Estado (UF) |
| 6 | Município |
| 7 | Região Metropolitana |
| 106 | Região de Saúde |
| 127 | Amazônia Legal |
| 128 | Semiárido |

### ibge_censo

Consulta dados censitários (1970-2022).

```
# População Censo 2022
ibge_censo(ano="2022", tema="populacao")

# Série histórica de população
ibge_censo(ano="todos", tema="populacao")

# Alfabetização por estado em 2010
ibge_censo(ano="2010", tema="alfabetizacao", nivel_territorial="3")
```

**Temas disponíveis:** populacao, alfabetizacao, domicilios, idade_sexo, religiao, cor_raca, rendimento, migracao, educacao, trabalho

### ibge_indicadores

Consulta indicadores econômicos e sociais.

```
# PIB
ibge_indicadores(indicador="pib")

# IPCA últimos 12 meses
ibge_indicadores(indicador="ipca", periodos="last 12")

# Desemprego por estado
ibge_indicadores(indicador="desemprego", nivel_territorial="3")

# Listar todos os indicadores
ibge_indicadores(indicador="listar")
```

**Indicadores disponíveis:**
| Categoria | Indicadores |
|:----------|:------------|
| Econômicos | pib, pib_variacao, pib_per_capita, industria, comercio, servicos |
| Preços | ipca, ipca_acumulado, inpc |
| Trabalho | desemprego, ocupacao, rendimento, informalidade |
| População | populacao, densidade |
| Agropecuária | agricultura, pecuaria |

### ibge_nomes

Consulta frequência e rankings de nomes.

```
# Frequência de "Maria"
ibge_nomes(tipo="frequencia", nomes="Maria")

# Comparar nomes
ibge_nomes(tipo="frequencia", nomes="João,José,Pedro")

# Ranking de nomes nos anos 2000
ibge_nomes(tipo="ranking", decada=2000)

# Ranking de nomes femininos
ibge_nomes(tipo="ranking", sexo="F")
```

### ibge_malhas

Obtém malhas geográficas (mapas).

```
# Brasil com estados
ibge_malhas(localidade="BR", resolucao="2")

# São Paulo com municípios
ibge_malhas(localidade="SP", resolucao="5")

# Município específico
ibge_malhas(localidade="3550308")

# Formato SVG
ibge_malhas(localidade="BR", formato="svg")
```

**Níveis de resolução:**
| Valor | Divisões Internas |
|:-----:|:------------------|
| 0 | Sem divisões (apenas contorno) |
| 2 | Estados |
| 5 | Municípios |

### datasaude

Consulta indicadores de saúde servidos pelo SIDRA do IBGE (alguns originalmente do DataSUS, ex.: óbitos e nascidos vivos).

```
# Mortalidade infantil no Brasil
datasaude(indicador="mortalidade_infantil")

# Expectativa de vida por estado
datasaude(indicador="esperanca_vida", nivel_territorial="3")

# Listar indicadores
datasaude(indicador="listar")
```

**Indicadores disponíveis:** mortalidade_infantil, esperanca_vida, nascidos_vivos, obitos, fecundidade, saneamento_agua, saneamento_esgoto, plano_saude

## APIs Utilizadas

### APIs do IBGE

- **Localidades**: `servicodados.ibge.gov.br/api/v1/localidades`
- **Nomes**: `servicodados.ibge.gov.br/api/v2/censos/nomes`
- **Agregados/SIDRA**: `servicodados.ibge.gov.br/api/v3/agregados`
- **API SIDRA**: `apisidra.ibge.gov.br/values`
- **Malhas**: `servicodados.ibge.gov.br/api/v3/malhas`
- **Notícias**: `servicodados.ibge.gov.br/api/v3/noticias`
- **População**: `servicodados.ibge.gov.br/api/v1/projecoes/populacao`
- **CNAE**: `servicodados.ibge.gov.br/api/v2/cnae`
- **Calendário**: `servicodados.ibge.gov.br/api/v3/calendario`
- **Países**: `servicodados.ibge.gov.br/api/v1/paises`
- **Pesquisas**: `servicodados.ibge.gov.br/api/v1/pesquisas`

## Desenvolvimento

```bash
# Compilar
npm run build

# Modo watch
npm run watch

# Executar testes
npm test

# Executar testes em modo watch
npm run test:watch

# Executar testes com cobertura
npm run test:coverage

# Linter
npm run lint

# Formatar código
npm run format

# Testar com MCP inspector
npm run inspector
```

## Estrutura do Projeto

```
ibge-br-mcp/
├── src/
│   ├── index.ts              # Servidor MCP principal
│   ├── types.ts              # Tipos TypeScript
│   ├── config.ts             # Configuração e constantes
│   ├── cache.ts              # Sistema de cache de requisições
│   ├── retry.ts              # Retry com backoff exponencial
│   ├── errors.ts             # Tratamento de erros padronizado
│   ├── validation.ts         # Helpers de validação de entrada
│   ├── metrics.ts            # Métricas e logging
│   ├── utils/
│   │   └── formatters.ts     # Utilitários de formatação
│   └── tools/
│       ├── index.ts          # Exports das ferramentas
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
│       ├── datasaude.ts      # datasaude
│       ├── pesquisas.ts      # ibge_pesquisas
│       ├── nomes.ts          # ibge_nomes
│       ├── noticias.ts       # ibge_noticias
│       ├── paises.ts         # ibge_paises
│       └── cidades.ts        # ibge_cidades
├── tests/                    # Arquivos de teste
├── dist/                     # Arquivos compilados
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## Testes

O projeto inclui uma suíte de testes abrangente com 227 testes cobrindo:

- Funções de validação
- Mecanismo de retry
- Utilitários de formatação
- Tratamento de erros
- Operações de cache
- Testes de integração com mocks

```bash
npm test
```

## Garantia de Qualidade

Este projeto mantém altos padrões de qualidade de código:

- **227 testes automatizados** cobrindo validação, cache, retry, formatação e integrações
- **97%+ de cobertura de testes** nos módulos core (cache, validation, errors, types)
- **ESLint** para linting de código sem warnings
- **Prettier** para formatação consistente
- **TypeScript modo strict** para segurança de tipos
- **CI/CD automatizado** via GitHub Actions

Execute os testes localmente:
```bash
# Rodar todos os testes
npm test

# Rodar testes com cobertura
npm run test:coverage

# Rodar linter
npm run lint
```

## Licença

MIT

## Autor

Sidney Bissoli

## Referências

- [IBGE - Serviço de Dados](https://servicodados.ibge.gov.br/api/docs/)
- [SIDRA - Sistema IBGE de Recuperação Automática](https://sidra.ibge.gov.br/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
