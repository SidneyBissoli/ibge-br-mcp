# Baselines de superfície

Dumps NORMALIZADOS de `tools/list` + resources + prompts, gerados por
`node scripts/dump-surface.mjs` (chaves ordenadas recursivamente, tools por
name / resources por uri / prompts por name, versão do servidor omitida de
propósito — mudaria a cada release e sujaria todo diff). Prática transplantada
do bcb-br-mcp, onde o dump revelou que stdio e worker haviam divergido de
verdade (contrato HTTP sem `minItems`, resources com nomes diferentes,
descrições 12× menores em produção). Nenhum teste unitário pega essa classe.

| Arquivo | Como foi capturado | O que representa |
|:--|:--|:--|
| `surface-stdio-4.2.0.json` | `--stdio` sobre `dist/index.js` do fonte atual | o que o canal npm publica |
| `surface-http-prod-4.2.0.json` | `--url https://ibge.sidneybissoli.com/mcp` | o que o endpoint hospedado serve DE FATO |

## Medição da captura inicial (2026-09-01)

**As duas superfícies são IDÊNTICAS byte a byte** — 21 tools, 5 resources,
2 prompts, mesmo `serverName`. Não é sorte: o worker reutiliza o `registerAll`
do build do pacote pai (`worker/src/server.ts`), então stdio e worker partilham
a superfície por construção, e a produção estava recém-deployada (4.2.0,
31/08). As divergências possíveis aqui são de DEPLOY (fonte à frente da
produção), não de definição dupla como era no bcb pré-fundação — por isso o
script não tem modo `--source`.

## Como usar no gate

Depois de qualquer mudança que possa mexer na superfície:

```bash
npm run build
node scripts/dump-surface.mjs --stdio > depois.json
# diff contra o baseline vigente (surface-stdio-4.2.0.json)
```

Toda diferença precisa ser deliberada e listada no CHANGELOG. Depois de um
deploy do worker, recapturar `--url` e conferir que voltou a bater com o stdio
(a propagação da Cloudflare serve isolates mistos por alguns segundos — se
divergir logo após o deploy, re-sondar antes de concluir deriva).
