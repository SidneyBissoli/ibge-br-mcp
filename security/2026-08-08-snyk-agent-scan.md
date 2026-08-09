# Gate de segurança — Snyk Agent Scan (2026-08-08)

Gate de fechamento de conformidade (padrão do portfólio, mesmo dos servidores
ilo/uis).

## Resultado

**PASSOU COM RESSALVA DOCUMENTADA** — enumeração de runtime limpa; um único
achado de análise, severidade **low**, avaliado como falso positivo (abaixo).

- Scanner: `snyk-agent-scan` v0.5.16 (via `uvx`), autenticado (SNYK_TOKEN).
- Modo: `--ci --dangerously-run-mcp-servers` (STDIO local real — o scanner
  lançou `node dist/index.js` direto, sem ponte `mcp-remote`).
- Alvo: superfície completa de produção da v3.3.0 — **22 tools, 2 prompts,
  5 resources**, todos enumerados com sucesso; `error: null` (nenhuma falha de
  runtime).
- Evidência bruta: `2026-08-08-snyk-agent-scan.json`.

## Achado único: W001 "Dangerous Words Detection" (low) — falso positivo

A heurística sinaliza a palavra `ignore` em descrições de tool como possível
linguagem de manipulação do agente. As 4 ocorrências estão nas tools tabulares
SIDRA (`ibge_sidra`, `ibge_censo`, `ibge_indicadores`, `ibge_datasaude`) e são
a **mesma frase factual** documentando o modo estatístico:

> "In this mode pagina/campos/formato are ignored and registros comes empty."

É voz passiva descrevendo comportamento de parâmetros (quais campos o modo
`estatisticas` não usa) — não há diretiva ao agente, inflação de prioridade nem
instrução para ignorar regras. A verificação anti-injection do fechamento
(descrições sem diretivas de comportamento) cobre exatamente esse risco e
passa.

**Decisão:** não reescrever as descrições nesta rodada. Qualquer mudança de
descrição altera a superfície de tools e dispararia o gate Inspector + smoke
em produção por uma troca cosmética de palavra ("are ignored" → "are not
used") sem ganho de segurança real. Se uma futura versão tocar essas
descrições por outro motivo, preferir a formulação sem `ignore`.
