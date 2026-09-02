# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP (Model Context Protocol) server, published to npm as `ibge-br-mcp`, that exposes Brazilian public data from the IBGE APIs as ~23 tools over STDIO (health data, including some DataSUS-origin stats, is read via IBGE's SIDRA — the server only ever calls IBGE endpoints). Pure TypeScript, ESM, no runtime framework — just `@modelcontextprotocol/server` (MCP SDK v2) + `zod` 4. There is no database and no local state beyond an in-memory cache; every tool is a thin async function that fetches from a public REST API and formats the result as Markdown text.

## Commands

```bash
npm run build          # tsc → dist/ (required before start/inspector; bin points at dist/index.js)
npm run dev            # build + run
npm run watch          # tsc --watch
npm test               # vitest run (all tests)
npm run test:watch     # vitest watch
npm run test:coverage  # coverage report
npm run lint           # eslint src/  (must be zero warnings)
npm run lint:fix
npm run format         # prettier --write src/
npm run inspector      # @modelcontextprotocol/inspector against dist/index.js — manual tool testing
node scripts/smoke-mcp.mjs           # smoke against the hosted Worker (initialize/tools/list/calls incl. estatisticas)
node scripts/smoke-mcp.mjs --stdio   # same smoke over local STDIO (requires npm run build)
```

Run a single test file or test by name:

```bash
npx vitest run tests/validation.test.ts
npx vitest run -t "ibgeEstados"
```

Node >= 20 (SDK v2 requirement; uses the global `fetch`). Tests mock `global.fetch` — they never hit the network.

The Cloudflare Worker (`worker/`, not published to npm) is an instance of the portfolio's Fase 0 hosting template (`mcp-br-commons/templates/cloudflare-worker`) and has its own scripts, run from inside `worker/`:

```bash
cd worker && npm run dev        # wrangler dev — local HTTP transport
cd worker && npm run deploy     # wrangler deploy
cd worker && npm run typecheck  # tsc --noEmit
cd worker && npm test           # vitest — auth, rate limit, usage, status, surface
```

The Worker intentionally does **not** list `@modelcontextprotocol/server` or `zod` in its own deps — they resolve from the parent package's `node_modules` so there is a single SDK copy (avoids duplicate-instance type clashes with `registerAll`). `worker/.npmrc` pins `legacy-peer-deps=true` so npm does not install a second copy to satisfy the `agents` package's hard peer ranges.

## Architecture

**Entry point split:** `index.ts` is a thin STDIO wrapper — it passes a `createServer` factory to the SDK's `serveStdio` (which serves both the modern and the 2025-era protocol openings) and logs to stderr. `server.ts` holds `createServer()` (builds the `McpServer`, then calls `registerAll(server)`) and the exported `registerAll(server, record?)`, which registers every tool, resource, and prompt onto a given server; the optional `record` hook (`ToolUsageRecorder`) receives `tool_call`/`tool_error` events per tool — the Worker feeds it into its usage Durable Object, STDIO passes nothing. Both are **side-effect-free and testable** (see `tests/server.test.ts`, which drives the server over the SDK's in-memory transport with the `@modelcontextprotocol/client` test client). All tool registrations and their English descriptions live in `registerAll`. The `worker/` directory (not published to npm) is a Cloudflare Worker — an instance of the Fase 0 hosting template — that serves the same `registerAll` surface over Streamable HTTP (`createMcpHandler` from `agents`, stateless, plus a `UsageTracker` Durable Object for usage stats, per-IP rate limit, optional Bearer auth, and landing/health/status/metrics routes); STDIO remains the default transport.

**Request flow for every tool:** `server.ts` registers the tool → handler calls the tool's `ibgeXxx(args)` function → that function wraps its body in `withMetrics(...)` → calls `cachedFetch(url, key, ttl)` → `cachedFetch` checks the in-memory cache, and on a miss calls `fetchWithRetry` (exponential backoff on network errors + 429/5xx) → on error the tool catches and returns `parseHttpError(...)`.

**All tools are annotated read-only** via a shared `READ_ONLY` `ToolAnnotations` const in `server.ts` (`readOnlyHint`/`idempotentHint`/`openWorldHint` true, `destructiveHint` false) — every tool is a pure GET against a public API. Reference catalogs (UF/region codes, SIDRA territorial levels & table codes, biomes) are exposed as `ibge://catalogos/...` **resources** (`resources.ts`), and analysis templates (compare municipalities, demographic profile) as **prompts** (`prompts.ts`).

**One registration shape (since v3.0.0, "structured output everywhere"):** every tool registers with `server.registerTool(name, { description, inputSchema, outputSchema, annotations: READ_ONLY }, handle(name, ibgeXxx))`, where `inputSchema`/`outputSchema` are the **whole zod object schemas** (SDK v2 takes Standard Schemas directly — no `.shape`). Every tool impl returns a `StructuredToolResult` (`{ markdown, structured?, isError? }`); the shared `handle(name, fn)` helper inside `registerAll` converts it via `toMcpResult(...)` from `structured.ts` (attaching the typed `structuredContent` payload validated against `outputSchema`) and reports `tool_call`/`tool_error` to the optional usage recorder.

**Shared infrastructure (`src/`), used by every tool — reuse these, don't reinvent:**
- `config.ts` — single source of truth for API endpoints, UF/region code maps, SIDRA territorial levels, biome codes, common SIDRA table codes, validation regexes, and helpers (`getUfCode`, `validateIbgeCode`, etc.). Add new constants/mappings here.
- `cache.ts` — global in-memory `cache` + `cachedFetch`. Pick a TTL from `CACHE_TTL` (`STATIC` 24h, `MEDIUM` 1h, `SHORT` 15m, `REALTIME` 1m) based on how often the upstream data changes. Build keys with `cacheKey(url, params)`.
- `retry.ts` — `fetchWithRetry` and `RETRY_PRESETS`; `cachedFetch` uses it automatically. Each attempt is bounded by a per-request timeout (`AbortController`), defaulting to `REQUEST_TIMEOUT_MS` in `config.ts` (30s, overridable via the `IBGE_MCP_TIMEOUT_MS` env var, or per-call via `RetryOptions.timeoutMs`). A timeout throws `TimeoutError`, which `parseHttpError` renders as a friendly message.
- `errors.ts` — `parseHttpError`, `formatError`, `ValidationErrors`. All user-facing errors are Portuguese Markdown with a suggestion and related tools.
- `metrics.ts` — wrap every tool body in `withMetrics(toolName, apiName, fn)`. Also exports `logger` (writes to **stderr** only — stdout is the MCP protocol channel, never log there).
- `structured.ts` — structured-output plumbing for data tools: `StructuredToolResult` type, `toMcpResult` (success → `structuredContent`, error → `isError` so the SDK skips schema validation), `sidraRecords` (SIDRA header+rows → labeled `{ colunas, registros, totalRegistros }`), and `selectSidraColumns` (the `campos` field-selection filter, accent/case-insensitive, returns data unchanged on no match).
- `provenance.ts` — the provenance block (portfolio contract v1.0, since v3.3.0), a pt-BR adapter over `@sbissoli/mcp-provenance` (the package owns the canonical model, determinism, timezone, footer wording — never reshape the emitted block by hand). Every tool attaches `provenance: provenienciaIbge({ fonte, url, chaveCache: key, pesquisa, ... })` to EVERY success return (`tests/provenance-wiring.test.ts` is the gate); `toMcpResult` emits the three channels (concise block + `attribution` in `structuredContent`; `_meta` mirror under `br.com.sidneybissoli.ibge/...`; text footer). `retrieved_at` is the real fetch instant pulled from the cache layer (`lastFetchMeta`); SIDRA-backed responses pass `dataset` (table code) and `dataVintage` (`extrairPeriodoSidra`); statistics modes and `ibge_comparar` pass `derivado` (server-side derivation). Registration wraps each `outputSchema` with `comProveniencia(...)` in `server.ts`.
- `tools/deep-research.ts` — the ChatGPT Deep Research contract (v4.3.0): `search`/`fetch` are the ONLY tools without the `ibge_` prefix (names fixed by OpenAI; `tests/evals/fixtures.test.ts` allowlists them from `DEEP_RESEARCH_TOOLS`). Contract, envelope (JSON in `content[0].text` + `structuredContent`), ranking and registration live in `@sbissoli/mcp-search` (portfolio package, registered from `registerAll` via `registerDeepResearchTools`); this module is only the IBGE index (SIDRA tables `sidra:<cod>`, municipalities `mun:<cod7>`, known indicators `ind:<chave>`, built on first use and kept 24h) and the document renderer (which calls the real tool impls and reuses their provenance). The municipality document is hierarchy + SIDRA population on purpose — the Cidades@ panorama takes 24–60 s. Provenance for these two travels as envelope `extras`, not through `toMcpResult`; `formatarCelulaSidra` in `structured.ts` is the single cell formatter of the four SIDRA-backed tables (codes and periods are never number-formatted).
- `stats.ts` — the D2 statistics modes (`estatisticas`/`agruparPor`/`topN`) shared by the four SIDRA-backed tabular tools (`ibge_sidra`, `ibge_censo`, `ibge_indicadores`, `ibge_datasaude`), a pt-BR adapter over `@sbissoli/mcp-stats` (the portfolio package owns the math — percentile type 7, population std-dev, stable tie-breaks; never reimplement locally). Exports the shared input params, the `estatisticasBlocoSchema` output block, and `estatisticasSidra(dados, opcoes)`. SIDRA absence markers (`-`, `..`, `...`, `X`) drop out of *n*; multi-variable queries auto-group by "Variável"; top/bottom entries are identified by the columns that vary across the result.
- `utils/formatters.ts` (re-exported via `utils/index.js`) — `createMarkdownTable`, `createKeyValueTable`, `formatNumber`, etc. Output formatting goes through these.
- `types.ts` — IBGE API response interfaces plus the `IBGE_API` endpoint alias.

**Tools live in `src/tools/`, one file per tool.** Each file exports a zod schema `xxxSchema` and the async impl `ibgeXxx`. The canonical small example is `estados.ts`.

## Adding or changing a tool

Every tool name carries the `ibge_` prefix — the only exceptions are `search` and `fetch` (OpenAI contract), and a third unprefixed tool fails the evals gate. Three edits, but the tool's user-facing description lives in exactly ONE place:
1. The tool file in `src/tools/` — the Zod schema (`xxxSchema`), the input type, and the async impl (`ibgeXxx`).
2. `src/tools/index.ts` — re-export the schema and the function.
3. `src/server.ts` — a registration block inside `registerAll()`: `server.registerTool(name, { title, description, inputSchema: xxxSchema, outputSchema: xxxOutputSchema, annotations: READ_ONLY }, handle(name, ibgeXxx))` (whole zod schemas, no `.shape` — see the request flow above). Pass `READ_ONLY` so the new tool is annotated like the rest, and route the handler through `handle(...)` so usage instrumentation keeps covering it. This **English** description is the ONLY description the MCP client sees; put tool-selection / disambiguation guidance here. `title` is the pt-BR display name — every tool must have one (`tests/server.test.ts` enforces it). Cross-tool guidance (disambiguation clusters, statistics-mode routing) lives in `SERVER_INSTRUCTIONS` (also `server.ts`), sent on the handshake by both `createServer` and the Worker.

Note `SERVER_VERSION` in `src/server.ts` is sourced from `package.json` (`import pkg from "../package.json" with { type: "json" }`; esbuild inlines it for the Worker build), so on release bump the version in **`package.json` only** — `src` no longer drifts. `npm version <x.y.z>` runs `scripts/sync-version.mjs` through npm's `version` hook, which mirrors the number into every file that cannot derive it — `server.json`, `lhm.plugin.json` (the LobeHub listing), and `src/version.ts` / `src/config.ts` where they exist. Nothing is bumped by hand any more: `lhm.plugin.json` was, and drifted to 3.3.0 while the package was at 4.0.0, which is a wrong version on the directory's own product page. Add a `CHANGELOG.md` entry for the release too. (`engines` is `node >=20` — the MCP SDK v2 floor.)

## Conventions

- ESM with `NodeNext` resolution: **all relative imports must use the `.js` extension** (e.g. `import { cache } from "./cache.js"`) even though the source is `.ts`. TypeScript is in `strict` mode with `noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns` on.
- All input validation is zod schemas with `.describe(...)` on each field (descriptions are in Portuguese and surface to the MCP client). Reuse `validation.ts` helpers for cross-cutting checks.
- Two-language split is intentional: tool descriptions and error messages shown to end users are Portuguese; code, comments, and the tool registrations in `server.ts` are English. (Resource/prompt descriptions in `resources.ts`/`prompts.ts` are Portuguese — they surface to end users.)

## Evals

`evals/` holds a tool-selection eval on `@sbissoli/mcp-evals`: `catalog.ts` extracts the live catalog by running the real `registerAll` (single group; per-tool areas reassigned from the cluster map `AREA_BY_TOOL` — keep it covering every tool, `tests/evals/fixtures.test.ts` enforces the partition), and `fixtures/queries.ts` has 40 pt-BR queries tagged by disambiguation cluster (`pop-`/`eco-`/`loc-`/`sidra-`/`malha-`/`ctrl-`). The catalog/fixtures validation runs offline inside `npm test`. The live run (`npx tsx evals/run.ts`) calls the Anthropic Messages API with `ANTHROPIC_API_KEY` and **bills API usage — never run or suggest it unless the user explicitly asks**.

## Baselines de superfície

`baselines/` guarda dumps normalizados de `tools/list` + resources + prompts
(`node scripts/dump-surface.mjs --stdio | --url <endpoint>`), prática
transplantada do bcb-br-mcp. Na captura inicial (01/09/2026, v4.2.0) stdio e
produção saíram byte-idênticos — o worker reutiliza o `registerAll` do build da
raiz, então a única deriva possível é de deploy. Depois de mudança que possa
mexer na superfície: `npm run build && node scripts/dump-surface.mjs --stdio` e
diff contra o baseline vigente; toda diferença precisa ser deliberada e listada
no CHANGELOG. Ver `baselines/README.md`.

## Tests

Vitest, in `tests/`. Coverage spans the shared infrastructure (`cache`, `validation`, `retry`, `errors`, `formatters`, `structured`) and per-tool mock-based tests that stub `global.fetch` (every tool is ≥50% covered). Use the mock helper in `tests/helpers.ts` rather than hand-rolling `fetch` stubs. Note the two test styles: `xxx.test.ts` files often assert only the Zod schema, while `xxx.tool.test.ts` (and the integration files) actually invoke `ibgeXxx` against a mocked upstream — when adding a tool, write the latter.

`tests/output-contract.test.ts` is the output-contract gate: it drives the real server over the in-memory transport, calls every tool with `global.fetch` mocked, and validates the `structuredContent` against the `outputSchema` that `tools/list` publishes — the client's exact view. **Um campo que a fonte pode não publicar precisa ser honesto no `outputSchema`**: `.nullable()` quando o handler devolve `null`, `.optional()` quando ele omite a chave. Handing whole Zod schemas to `registerTool` already buys real protection here — the SDK validates `structuredContent` against the `outputSchema` at call time and a mismatch surfaces as `Output validation error`, i.e. the call fails loudly instead of shipping an invalid payload. What the gate adds is the JSON round trip: a key whose value is `undefined` survives the in-process check but is erased by `JSON.stringify`, and on the wire that reads as a missing required property. The cases come in pairs — payload cheio e payload MAGRO, com os campos opcionais da fonte ausentes — because the happy path passes even with a dishonest schema. Verified clean across all 21 tools on 2026-08-11. **Ao acrescentar campo em resposta, acrescente o caso aqui.**
