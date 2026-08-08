/**
 * Tool-selection eval — REAL-MODEL run (Anthropic Messages API).
 *
 * COSTS MONEY: bills API usage separately from any Claude subscription. Never
 * run with ANTHROPIC_API_KEY set unless the decision-maker explicitly asked
 * for a round. Without the key it prints instructions and exits 0 (CI-safe).
 * The offline regression signal is `tests/evals/fixtures.test.ts` (npm test).
 *
 * Env vars (optional): EVAL_MODEL, EVAL_CONCURRENCY, EVAL_LIMIT.
 */

import { runEval } from "@sbissoli/mcp-evals";
import { CATALOG } from "./catalog.js";
import { FIXTURES } from "./fixtures/queries.js";

const { exitCode } = await runEval({
  catalog: CATALOG,
  fixtures: FIXTURES,
  systemPrompt:
    "Você é o roteador de ferramentas do servidor MCP ibge-br (dados oficiais do IBGE: " +
    "geografia e localidades, população e Censo, indicadores econômicos e sociais, tabelas " +
    "SIDRA, malhas, nomes, CNAE, saúde e notícias). Dada a consulta do usuário, escolha a " +
    "ferramenta mais adequada do catálogo e chame-a. Não responda em texto; apenas chame a ferramenta.",
});

process.exit(exitCode);
