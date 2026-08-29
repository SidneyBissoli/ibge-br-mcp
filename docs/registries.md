# Registries e diretórios MCP

Verificação de propriedade da listagem deste servidor em diretórios de terceiros.

## MseeP.ai

[![Verified on MseeP](https://mseep.net/pr/sidneybissoli-ibge-br-mcp-badge.png)](https://mseep.ai/app/sidneybissoli-ibge-br-mcp)

Badge da listagem
[mseep.ai/app/sidneybissoli-ibge-br-mcp](https://mseep.ai/app/sidneybissoli-ibge-br-mcp)
(diretório com scan de segurança automatizado de servidores MCP). Saiu do topo
do README em 2026-08-26 e ficou aqui.

Ao guardá-lo aqui eu repeti a nota do `senado-br-mcp-cloudflare`, que dizia ser
este badge "o mecanismo de verificação de propriedade" e mandava não removê-lo.
Conferido na visão de PROPRIETÁRIO no mesmo dia: a listagem atribui a
propriedade à CONTA ("Owners: Sidney Bissoli", com edição liberada) e nada na
página a condiciona a um badge no README. Mantido por precaução, não por regra.

O que a mesma visita mostrou, e vale para qualquer produto do portfólio:

- a nota da listagem é o **trust rating**, e sai do `npm audit` do repositório —
  inclusive de advisories que só existem em `devDependencies`. Aqui, 5
  advisories transitivas do eslint punham a listagem em 2,7 ("Moderate Risk",
  scan de 13/08/2026) com `npm audit --omit=dev` limpo. Corrigido em 26/08;
- a "Detailed Description" da listagem é uma CÓPIA do README guardada pelo
  MseeP, editável na página, que NÃO acompanha o repositório: em 26/08 ela ainda
  mostrava o README pré-v3 (23 tools, uma tool `bcb` que não existe mais, 227
  testes). Reconferir a cada release que mexa no README.

## Auditoria de qualidade das fichas (2026-08-28, após a 4.0.0)

De onde cada listagem tira o texto que exibe — medido, não suposto. A distinção
que importa é entre ficha DERIVADA (relê o repositório, se conserta sozinha) e
ficha DIGITADA (alguém escreveu na interface, e apodrece em silêncio):

| Listagem | Fonte do texto | Conserta sozinha? |
|:---|:---|:---|
| Registro oficial MCP | `server.json`, capturado NO ATO do publish | Não relê o repo — a descrição nova só chega no próximo release |
| npm | `package.json` | Sim, a cada publish |
| Glama | rastreia o repositório | Sim |
| LobeHub | `lhm.plugin.json` | Sim, desde que o arquivo esteja certo |
| Smithery | **digitada** na plataforma | **Não** |
| MseeP | **cópia** do README guardada por eles | **Não** |
| awesome-mcp-servers | uma linha no README deles | Não — só por PR |

Duas armadilhas confirmadas na prática:

- **Contagem de ferramentas em texto apodrece.** A entrada do
  awesome-mcp-servers dizia "23 tools" (errado desde a v3) e o Smithery diz "22
  read-only tools". Ao mexer numa ficha, remova o número em vez de atualizá-lo.
- **Versão de arquivo bumpado à mão também apodrece.** O `lhm.plugin.json` ficou
  em 3.3.0 com o pacote em 4.0.0. Resolvido na raiz: virou alvo do
  `scripts/sync-version.mjs`, então o `npm version` o espelha.

Depois de um release que mexa no README, nas descrições ou na superfície de
ferramentas, reconferir Smithery e MseeP à mão — são as duas que nenhum
automatismo alcança.
