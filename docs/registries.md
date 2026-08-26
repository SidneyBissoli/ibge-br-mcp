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
