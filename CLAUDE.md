# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP (Model Context Protocol) server, published to npm as `ibge-br-mcp`, that exposes Brazilian public data (IBGE, Banco Central, DataSUS) as ~23 tools over STDIO. Pure TypeScript, ESM, no runtime framework — just `@modelcontextprotocol/sdk` + `zod`. There is no database and no local state beyond an in-memory cache; every tool is a thin async function that fetches from a public REST API and formats the result as Markdown text.

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
```

Run a single test file or test by name:

```bash
npx vitest run tests/validation.test.ts
npx vitest run -t "ibgeEstados"
```

Node >= 18 (uses the global `fetch`). Tests mock `global.fetch` — they never hit the network.

## Architecture

**Request flow for every tool:** `index.ts` registers the tool → handler calls the tool's `ibgeXxx(args)` function → that function wraps its body in `withMetrics(...)` → calls `cachedFetch(url, key, ttl)` → `cachedFetch` checks the in-memory cache, and on a miss calls `fetchWithRetry` (exponential backoff on network errors + 429/5xx) → on error the tool catches and returns `parseHttpError(...)`.

**Two registration shapes — pick by whether the tool returns tabular data:**
- **Markdown-only tools** (catalog / localidade / listing — the majority) register with `server.tool(name, description, schema.shape, handler)`; the handler returns `{ content: [{ type: "text", text: result }] }` and the tool's impl returns a **Markdown string**.
- **Data tools** (the 7 tabular ones: `ibge_sidra`, `ibge_censo`, `ibge_indicadores`, `datasaude`, `ibge_populacao`, `ibge_comparar`, `ibge_cidades`) register with `server.registerTool(name, { description, inputSchema, outputSchema }, handler)`. Their impl returns a `StructuredToolResult` (`{ markdown, structured?, isError? }`) and the handler converts it via `toMcpResult(...)` from `structured.ts`, attaching a typed `structuredContent` payload validated against `outputSchema`. See roadmap 1.2.

**Shared infrastructure (`src/`), used by every tool — reuse these, don't reinvent:**
- `config.ts` — single source of truth for API endpoints, UF/region code maps, SIDRA territorial levels, biome codes, common SIDRA table codes, validation regexes, and helpers (`getUfCode`, `validateIbgeCode`, etc.). Add new constants/mappings here.
- `cache.ts` — global in-memory `cache` + `cachedFetch`. Pick a TTL from `CACHE_TTL` (`STATIC` 24h, `MEDIUM` 1h, `SHORT` 15m, `REALTIME` 1m) based on how often the upstream data changes. Build keys with `cacheKey(url, params)`.
- `retry.ts` — `fetchWithRetry` and `RETRY_PRESETS`; `cachedFetch` uses it automatically.
- `errors.ts` — `parseHttpError`, `formatError`, `ValidationErrors`. All user-facing errors are Portuguese Markdown with a suggestion and related tools.
- `metrics.ts` — wrap every tool body in `withMetrics(toolName, apiName, fn)`. Also exports `logger` (writes to **stderr** only — stdout is the MCP protocol channel, never log there).
- `structured.ts` — structured-output plumbing for data tools: `StructuredToolResult` type, `toMcpResult` (success → `structuredContent`, error → `isError` so the SDK skips schema validation), `sidraRecords` (SIDRA header+rows → labeled `{ colunas, registros, totalRegistros }`), and `selectSidraColumns` (the `campos` field-selection filter, accent/case-insensitive, returns data unchanged on no match).
- `utils/formatters.ts` (re-exported via `utils/index.js`) — `createMarkdownTable`, `createKeyValueTable`, `formatNumber`, etc. Output formatting goes through these.
- `types.ts` — IBGE API response interfaces plus the `IBGE_API` / `BCB_API` endpoint aliases.

**Tools live in `src/tools/`, one file per tool.** Each file exports a zod schema `xxxSchema` and the async impl `ibgeXxx`. The canonical small example is `estados.ts`.

## Adding or changing a tool

Three edits, but the tool's user-facing description lives in exactly ONE place:
1. The tool file in `src/tools/` — the Zod schema (`xxxSchema`), the input type, and the async impl (`ibgeXxx`).
2. `src/tools/index.ts` — re-export the schema and the function.
3. `src/index.ts` — a registration block (`server.tool(...)` for Markdown-only tools, `server.registerTool(...)` with an `outputSchema` for tabular data tools — see the request flow above). This **English** description is the ONLY description the MCP client sees; put tool-selection / disambiguation guidance here.

Note `SERVER_VERSION` in `src/index.ts` is hardcoded and must be bumped to match `version` in `package.json` and `server.json` on release — all three drift easily. Add a `CHANGELOG.md` entry for the release too.

## Conventions

- ESM with `NodeNext` resolution: **all relative imports must use the `.js` extension** (e.g. `import { cache } from "./cache.js"`) even though the source is `.ts`. TypeScript is in `strict` mode with `noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns` on.
- All input validation is zod schemas with `.describe(...)` on each field (descriptions are in Portuguese and surface to the MCP client). Reuse `validation.ts` helpers for cross-cutting checks.
- Two-language split is intentional: tool descriptions and error messages shown to end users are Portuguese; code, comments, and the registrations in `index.ts` are English.

## Planning

`ROADMAP.md` is the actively-maintained plan of record (in Portuguese): it tracks current status, prioritized work items, and the guiding principles (depth over breadth, LLM usability as the product, live/exact data only, IBGE-focused — no scope creep). Check it before proposing new tools or features, and update item status when work lands.

## Tests

Vitest, in `tests/`. Coverage spans the shared infrastructure (`cache`, `validation`, `retry`, `errors`, `formatters`, `structured`) and per-tool mock-based tests that stub `global.fetch` (every tool is ≥50% covered — see roadmap 1.5). Use the mock helper in `tests/helpers.ts` rather than hand-rolling `fetch` stubs. Note the two test styles: `xxx.test.ts` files often assert only the Zod schema, while `xxx.tool.test.ts` (and the integration files) actually invoke `ibgeXxx` against a mocked upstream — when adding a tool, write the latter.
