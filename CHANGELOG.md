# Changelog

All notable changes to the IBGE MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.2.0] - 2026-08-31

Conserta um defeito silencioso de `ibge_censo` que fazia a tool devolver dados
de OUTRA PESQUISA sob o rótulo do tema pedido, e publica a superfície do
produto em português.

### Fixed

- **15 das 41 tabelas do mapa de temas de `ibge_censo` apontavam para a
  pesquisa errada ou para o assunto errado.** A tool traduz `tema` + `ano` em
  código de tabela SIDRA por um mapa escrito à mão — o código de um lado, uma
  `descricao` também escrita à mão do outro — e nada jamais confrontou o par
  com o catálogo do IBGE. `tema="saneamento"` com `ano="2022"` respondia com a
  tabela 9696, que é da **PNAD Contínua** e mede rendimento em domicílio com
  televisão por assinatura; `fecundidade`/2010 apontava para o **INPC** de 1990;
  `rendimento`/2000, para o **Censo Agropecuário**; `quilombolas`/2022, para uso
  de Internet; `educacao`/2000, para nascidos vivos do Registro Civil;
  `deficiencia`/2000, para transportes da Pesquisa Anual de Serviços; e mais
  nove. Nada quebrava: a resposta vinha normal, com a descrição escrita à mão no
  cabeçalho.
  Onde havia substituta conferida, a tabela foi trocada (saneamento/2022 → 6803,
  quilombolas → 10089 e 10090, indígenas → 3452, 10395 e 10396, educação/2022 →
  10061, deficiência/2022 → 10125, fecundidade → 10075, nupcialidade → 1624 e
  1541, domicílios → 1310, rendimento/2022 → 10293). Onde não havia, a entrada
  foi **removida**: `alfabetizacao`/2000, `rendimento`/2000, `educacao`/2000,
  `deficiencia`/2000, `fecundidade`/2000 e `domicilios`/2022-detalhado deixam de
  existir. É melhor a tool dizer que não cobre aquele ano do que servir outra
  pesquisa com o rótulo do tema — e quem chamava essas combinações estava
  recebendo dado errado, não dado.
- A landing anunciava "22 ferramentas" com 21 registradas.
- O `README.pt-BR.md` não tinha a seção de procedência dos dados, que o inglês
  tem desde a v3.3.0.

### Added

- **`tests/censo-mapa-de-tabelas.test.ts`**, 88 casos, com duas provas por
  entrada contra a fonte: o código existe no catálogo do Censo Demográfico
  (espelho em `tests/fixtures/censo-agregados.json`, regenerável por
  `node scripts/atualiza-catalogo-censo.mjs`) e o NOME OFICIAL da tabela contém
  um termo do assunto que o tema promete. A segunda prova é a que pega o caso
  traiçoeiro — universo certo, assunto errado.
- **`tests/contagem-nos-textos.test.ts`**: toda afirmação "N ferramentas/tools"
  em texto público conferida contra a contagem derivada do `registerAll` real,
  mais paridade pt/en dos READMEs.
- **`docs/artigo-sidra-tabela-certa.pt-BR.md`**: como achar a tabela certa no
  SIDRA e como saber que é a certa, com um exemplo completo em dado de 2022 e
  todos os números capturados ao vivo.

### Changed

- **Landing page** com `meta description`, canonical, og:, JSON-LD
  `SoftwareApplication`, perguntas reais, destaques, links para repositório,
  pacote e artigo, e o segundo idioma como seção própria. Antes eram oito
  linhas de corpo, sem nada disso.


## [4.1.0] - 2026-08-30

Fecha os SETE achados de conformidade do `mcpscore`. Produção de **165/173
(95,4%) para 173/173 = 100%**; stdio de 137/148 para 146/148, com zero falhas —
os 2 pontos restantes são limite do SDK, não deste repositório.

### Added

- `serverInfo` do handshake passa a declarar `title`, `icons` e `websiteUrl`.
  Os três já existiam no `server.json` — que é o que o MCP Registry publica e os
  diretórios copiam — mas não no que o cliente MCP recebe ao conectar. São
  lugares diferentes, e é o handshake que o auditor mede.
- Cursor de paginação inválido passa a ser recusado com JSON-RPC `-32602` nos
  quatro endpoints de lista (`src/pagination.ts`). Toda lista deste servidor cabe
  numa página, então nenhum cursor é válido — mas os handlers do SDK ignoram
  `params.cursor` e devolviam a lista inteira, contra a spec §Pagination.
- `server/discover` passa a anunciar TODAS as revisões atendidas, não só as
  modernas que o SDK filtra (`src/discover.ts`). Anunciar a verdade em vez de
  desligar o ciclo legado, que trocaria 1 ponto por uma regressão de
  compatibilidade com quase todos os clientes.

### Fixed

- O `websiteUrl` do handshake apontava para o repositório no GitHub enquanto o
  `server.json` apontava para o domínio próprio — duas respostas para "onde fica
  este servidor", e o domínio é quem serve o ícone.
- `no-useless-assignment` (regra nova do `@eslint/js` 10) achou uma atribuição
  morta em `src/tools/censo.ts`: um `let periodos = "last"` cujo valor nunca era
  lido, porque os dois ramos seguintes atribuem incondicionalmente.

### Changed

- **TypeScript 7.0.2**. Este repositório é o único do portfólio com
  `typescript-eslint`, que RECUSA a 7 no import — daí o arranjo lado a lado
  recomendado pela própria equipe do TypeScript: `typescript` é o shim
  `@typescript/typescript6`, para o eslint, e `typescript-7` é o compilador.
  **`npx tsc` aqui é a 6.0.3**; quem compila é o binário chamado pelo caminho.
  Guarda derivado em `tests/toolchain-typescript.test.ts`.
- `zod` 4.5.4, `@types/node` 26.4.0, `eslint` 10, `agents` 0.22 no `worker/`, e
  o ferramental na última estável.

### CI

- Catraca do `mcpscore` em 98 (stdio) e **100** (produção).
- `worker/tests/serverinfo-sync.test.ts`: compara a identidade do Worker, da raiz
  e do `server.json` entre si. Existe porque corrigir só a raiz levou o stdio a
  146/148 e deixou produção em 169/173 — com CI verde e deploy bem-sucedido.
- `dependabot.yml` passa a vigiar o `worker/`; Actions agrupadas e em v7.

## [4.0.2] - 2026-08-29

### Changed

- The icon is now served from the server's OWN domain: a new public
  `GET /icon.png` route on the Worker, and `icons[0].src` in `server.json`
  pointing at `https://ibge.sidneybissoli.com/icon.png`. It previously pointed at
  `raw.githubusercontent.com`, which works but puts a third-party host in the
  path of every directory that renders the listing — and the MCP schema
  explicitly recommends the server's own domain. This matches the arrangement
  senado-br-mcp-cloudflare already used.

### Added

- `tests/icon-sync.test.ts` — a gate against icon drift: asset bytes vs. the
  base64 inlined in the Worker, manifest URL vs. the route the code serves, and
  `mimeType`/`sizes` checked against the PNG's real IHDR header. It lives in the
  root suite because this repo's CI does not run `worker/tests/`.

## [4.0.1] - 2026-08-29

### Added

- `icons` in `server.json`: a flat silhouette of Brazil in PNG, served from the
  repository itself (`assets/icon.png`). The mcpindex.ai Quality Score awards 5
  completeness points for a declared icon, and without the field the server
  stopped at 95/100 — measured 2026-08-29. A published version is immutable in
  the MCP Registry (`cannot publish duplicate version`), so new metadata only
  reaches it through a release.

## [4.0.0] - 2026-08-28

**Breaking:** `ibge_populacao` was removed — the server surface goes from 22 to
21 tools. Clients calling it must move to `ibge_censo` or `ibge_indicadores`
(`indicador='populacao'`).

### Removed
- **`ibge_populacao` retired.** The IBGE real-time population-projection API it
  depended on was taken down: `/api/v1/projecoes/populacao/BR` answers 404, the
  `/api/v1/projecoes` root answers 404 too, and `/api/docs/projecoes` now
  redirects to the docs index — it was withdrawn, not temporarily down.
  What survives in SIDRA is the **2018 revision** (aggregates 7358 and 7360):
  annual, eight years stale, and with no clock, birth interval, or daily
  increment. Repointing there would have kept the tool's name while quietly
  changing what it means — the "plausible wrong" this project refuses. The
  server surface goes from 22 to 21 tools; `SERVER_INSTRUCTIONS` no longer
  opens the population disambiguation with a dead tool, and routes to
  `ibge_censo` and `ibge_indicadores` (`indicador='populacao'`), which answer
  from live data.

### Fixed
- **`ibge_comparar` returned unusable data for every indicator pinned to
  `variaveis: "allxp"`.** On `pib` (table 5938, 46 variables) the query pulled
  the sectoral value-added series alongside the GDP total — 200 records instead
  of 5, the same municipality repeated, and Mil Reais mixed with percentages in
  one comparison, which made the aggregate statistics meaningless
  (`variacaoPct: 152403586328.6`). Every template now pins its variable id
  (`populacao` 9324, `populacao_censo` 93, `pib` 37, `alfabetizacao` 2513,
  `domicilios` 617), matching `area` and `densidade`, which always did.
  Table 5938 publishes no per-capita variable, so `pib` is now described for
  what it returns: GDP at current prices, in Mil Reais.
- **`ibge_comparar` tagged every locality with the wrong code.** The row's
  locality code was read by taking the first column whose label contained
  "código", which in a SIDRA response is `Unidade de Medida (Código)` — so the
  payload came back with the *unit* code (28 = inhab./km², 40 = Mil Reais)
  where the IBGE locality code belonged. Anything joining `structuredContent`
  to another dataset joined on the wrong key.
- **`ibge_comparar` turned SIDRA absence markers into zero.** `"..."`, `"-"`,
  `".."` and `"X"` were coerced to `0` by a `parseFloat(...) || 0`, entering
  the ranking and the average as if they were measurements. Values now parse
  through the shared `valorSidra()` helper; an absent value is `null` (the
  `outputSchema` says so), sorts last in a ranking instead of at the bottom of
  a scale it never joined, and stays out of the statistics.
- **`ibge_cidades` (`tipo="panorama"`) timed out for every municipality.** The
  eight indicator lookups ran sequentially with the default retry policy (4
  attempts, backoff from 2s), so the two that the IBGE Pesquisas API was
  answering with HTTP 500 — `escolarizacao` (40/60045) and `salario_medio`
  (33/29765) — consumed roughly 30s each and blew the client's budget, while
  the other six answered in ~0.2s. The lookups now run in parallel with the
  quick retry preset: a failing indicator drops out of the panel instead of
  taking the panel down. Measured after the fix: 2.3–2.7s end to end, against
  the real API, with the two indicators still failing upstream.

### Added
- **`docs/demo.md` / `docs/demo.pt-BR.md`** — one real question worked end to
  end (which state grew most between the 2010 and 2022 Censuses, and what drove
  it), every figure captured live, including the cross-check that the 15
  Roraima municipalities sum exactly to the state total across two different
  SIDRA tables.
- **`examples/README.md` / `examples/README.pt-BR.md`** — six short recipes with
  real output, including a full distribution over all 5,570 municipalities in a
  single call.

## [3.3.0] - 2026-08-08

Dedicated provenance release: every successful response of the 22 tools now
carries the portfolio's provenance block (contract v1.0, via
[`@sbissoli/mcp-provenance`](https://www.npmjs.com/package/@sbissoli/mcp-provenance)).
No new tools; no tool renamed; the response surface changes ONLY by the block.

### Added
- **Provenance block on every successful tool response**, emitted on three
  channels: `structuredContent.provenance` (concise projection — `source`,
  `source_url`, `data_vintage`, `retrieved_at`, `citation`, `license`) plus
  `structuredContent.attribution` (canonical source-URL list, MCP RFC #711);
  an out-of-band mirror in `_meta` under `br.com.sidneybissoli.ibge/provenance`
  and `.../attribution`; and a compact pt-BR text footer appended to the
  Markdown for text-only clients. Every tool's `outputSchema` now declares the
  `provenance` + `attribution` fields.
  - `retrieved_at` is the **real upstream extraction instant**, preserved by
    the cache layer across hits (`cachedFetch` now records per-key fetch
    metadata; `served_from_cache` is tracked in the canonical block).
    Timestamps are serialized in Brasília time (`-03:00`).
  - `citation` follows the fixed pattern "Fonte: IBGE — [pesquisa/tabela],
    [URL], extraído em [data]." — the attribution required by Brazil's
    open-data regime.
  - `license` reflects the normative regime (no explicit upstream license):
    "Dados abertos do Poder Executivo federal (Lei 12.527/2011; Decreto
    8.777/2016)", verified 2026-08-08.
  - `data_vintage` carries the SIDRA reference period when the source exposes
    one (e.g. "2022", "1º trimestre 2023", "2020–2023"); `null` otherwise.
  - Statistics-mode responses (`estatisticas=true`) and `ibge_comparar` are
    marked `derived: true` with a `derivation_note` in the canonical block —
    the aggregates are computed server-side from raw IBGE values.
- Smoke script now verifies the provenance block (three channels) on both
  transports.

## [3.2.0] - 2026-08-08

Statistics engine over SIDRA plus usability: server-computed distributions and
rankings on the four tabular tools, pt-BR display titles on every tool, server
instructions on the handshake, and a smoke script for both transports. No new
tools; no tool was renamed.

### Added
- **Statistics mode (`estatisticas=true`) on `ibge_sidra`, `ibge_censo`,
  `ibge_indicadores`, and `ibge_datasaude`**, served by
  [`@sbissoli/mcp-stats`](https://www.npmjs.com/package/@sbissoli/mcp-stats):
  the server computes min/max/mean/median/std-dev/labeled percentiles over
  **all** rows of the query — before pagination/truncation — and returns
  `top`/`bottom` rankings (`topN`, default 10, cap 100). `agruparPor="<column
  label>"` (accent/case-insensitive) ranks groups by descending sum, each with
  its own mini-distribution. SIDRA absence markers (`-`, `..`, `...`, `X`) are
  excluded from *n* and reported via `registrosSemValor`; queries mixing
  several variables auto-group by "Variável" with an explanatory `aviso`.
  Extremes are identified by the columns that vary across the result (constant
  columns are context, not identity). In this mode `pagina`/`campos`/`formato`
  are ignored and `registros` comes empty; each tool's `outputSchema` gained
  the optional typed `estatisticas` block.
- **`title` on all 22 tools** — pt-BR display names (the description stays
  English, per repo convention; clients show the title to humans).
- **Server `instructions` on the MCP handshake** (STDIO and Worker): the
  disambiguation map across the overlapping tool clusters (population,
  economic, localities, SIDRA flow, meshes) plus guidance to reach the
  statistics modes and to verbalize percentiles from their `rotulo`.
- **Smoke script** `scripts/smoke-mcp.mjs` (ported from ilo-mcp-server):
  exercises initialize/tools/list/tool calls — including the statistics modes
  and a pedagogical-error path — against the hosted Worker
  (`node scripts/smoke-mcp.mjs`) or the local STDIO build
  (`node scripts/smoke-mcp.mjs --stdio`).

## [3.1.0] - 2026-08-08

Foundation release: MCP SDK v2 + zod 4, and the Cloudflare Worker rebuilt on
the portfolio's hosting template. The tool surface is unchanged — `tools/list`
is semantically identical to 3.0.2 (same names, descriptions, schemas, and
annotations; the advertised JSON Schema dialect changes from draft-07 to
2020-12 because SDK v2 emits schemas natively from zod 4).

### Changed
- **Migrated to MCP SDK v2** (`@modelcontextprotocol/server` ^2.0.0, replacing
  `@modelcontextprotocol/sdk` 1.x). Tools, resources, and prompts now register
  with whole zod schemas (Standard Schema); STDIO is served via `serveStdio`,
  which also answers 2025-era protocol openings, so existing clients keep
  working unchanged.
- **Upgraded zod 3 → 4** (4.4.3). Only internal schema code changed.
- **Node.js floor raised to >= 20** (`engines`) — required by MCP SDK v2. This
  only affects local STDIO installs on Node 18, which is end-of-life.

### Added
- **Worker rebuilt on the Fase 0 hosting template** (`createMcpHandler` +
  Durable Object): the hosted endpoint `https://ibge.sidneybissoli.com/mcp`
  gains a landing page, `/status` (version + deploy metadata), `/metrics`
  (aggregated usage statistics), a per-IP rate limit, and optional Bearer auth.
  Usage statistics are privacy-preserving by construction: event kind, tool
  name, and daily counts only — never tool arguments, results, or user data.
- **Worker test suite** (21 tests: auth, rate limit, usage aggregation, status,
  and the served MCP surface).

## [3.0.2] - 2026-06-21

Supply-chain hardening release (no functional changes).

### Changed
- **Pinned `@modelcontextprotocol/sdk` to `^1.29.0`** (was `^1.0.0`). The
  previous wildcard range let any 1.x resolve into the tree; narrowing it gives
  reproducible installs and a tighter supply-chain surface.

### Security
- **Published with npm provenance attestation** via the GitHub Actions release
  workflow (OIDC / SLSA). Earlier 3.0.x releases were published manually and
  carried no attestation; cutting this release through CI restores provenance,
  which Socket.dev and npm surface as a supply-chain trust signal.

## [3.0.0] - 2026-06-20

Naming consistency, structured output everywhere, and a hosted HTTP transport
(roadmap Phase 2 discoverability).

### Changed (BREAKING)
- **Renamed the `datasaude` tool to `ibge_datasaude`.** All 22 tools now share
  the `ibge_` prefix (the lone exception is gone), which improves naming
  consistency in directories/registries and for tool selection. Update any
  client configuration or calls that referenced `datasaude`. The function,
  schema, and behavior are unchanged — only the registered tool name.

### Added
- **Structured output for every tool.** The 15 catalog/locality/listing tools
  now declare an `outputSchema` and return a typed `structuredContent` payload
  alongside the Markdown (previously only the 7 tabular tools did). All 22 tools
  now expose structured output. Additive and non-breaking — clients that ignore
  `structuredContent` still receive the same Markdown. `malhas`/`malhas_tema`
  expose lightweight metadata only (the geometry stays in the Markdown channel).
- **Hosted HTTP transport.** An optional Cloudflare Worker serves the same
  surface over Streamable HTTP at `https://ibge.sidneybissoli.com/mcp`, declared
  as a `remotes` entry in `server.json` and advertised via
  `/.well-known/mcp/server-card.json`. STDIO remains the default.
- **`SECURITY.md`** (read-only security model + disclosure policy) and **npm
  publish provenance** (`--provenance`) for supply-chain attestation.
- A concise **"Behavior:" line** in every tool description stating it is
  read-only/idempotent, the IBGE API it calls, and its output shape.

### Fixed
- **`ibge_paises` was broken against the live IBGE API.** The code assumed the
  wrong response shapes: `nome` is an object (`{ abreviado }`), country `id` is
  keyed `ISO-3166-1-ALPHA-2/3`, currency `id` is an object, and
  `localizacao.regiao.id` is `{ M49 }`. As a result `tipo="buscar"` threw,
  region filtering always returned empty, and names/codes rendered as
  `[object Object]`/`-`. The `Pais`/`PaisLocalizacao` types and every accessor
  were corrected.
- **`ibge_sidra_metadados`**: the table code is returned as a number by the API;
  it is now coerced to a string so the structured payload validates.
- Repointed the Glama badge to its canonical URL and fixed the dead MseeP badge
  link in both READMEs.

## [2.0.0] - 2026-06-19

Refocus on the project's stated principle — **IBGE specialist, no scope creep
to other sources** — plus the first discoverability work (roadmap Phase 2).

### Removed (BREAKING)
- **The `bcb` tool** (Banco Central do Brasil data) has been removed. It was the
  only non-IBGE data source and contradicted the roadmap's "IBGE specialist"
  scope; dedicated Banco Central MCP servers cover this better. Also removed the
  accompanying `cruzar-ibge-bcb` prompt, the BCB API endpoints in `config.ts`
  (SGS/PTAX/EXPECTATIVAS), the `BCB_API` alias, and the `toBcbDate` helper.
  Tool count: 23 → 22. IPCA/INPC and other price indices remain available via
  `ibge_indicadores` (IBGE is their primary source).

### Added
- **README differentiator** (roadmap 2.1): both READMEs now lead with the
  "live, exact, sourced data vs. just asking an LLM" pitch, with a concrete
  example.
- **Registry metadata / SEO** (roadmap 2.4): value-oriented `package.json`
  description and expanded keywords; `server.json` description aligned and its
  malformed indentation fixed.

### Fixed
- **Accuracy:** removed the claim that the server queries a **DataSUS** API. It
  does not — health indicators are read from IBGE's SIDRA (the `datasaude`
  tool). DataSUS is credited only as the original producer of some stats
  (mortality/births) served via SIDRA. Corrected across README, metadata, the
  `datasaude` tool description, and internal comments.

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
