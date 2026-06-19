# Roadmap — ibge-br-mcp

**Posicionamento:** ser o MCP de referência para dados do IBGE — otimizado para
agentes LLM: preciso, atual, estruturado e bem descrito. O diferencial sobre
"apenas perguntar a uma IA" é dado exato, ao vivo e com procedência — não
manchete aproximada.

## Princípios (filtro para qualquer item futuro)

1. **Profundidade > largura.** Aperfeiçoar o núcleo vale mais que adicionar a
   próxima API. Toda nova tool precisa justificar o aumento de superfície.
2. **A usabilidade para LLM é o produto.** Descrições, desambiguação, saída
   estruturada e respostas compactas importam mais que contagem de features.
3. **Vivo e exato.** Nada de modo offline ou dado estático — é a proposta de valor.
4. **Especialista em IBGE.** Sem scope creep para outras fontes no núcleo.

## ✅ Status atual (v1.9.x)

- [x] 23 tools cobrindo as principais APIs do IBGE
- [x] Cache automático com TTL configurável
- [x] Retry com backoff exponencial
- [x] 227 testes automatizados
- [x] Documentação bilíngue (EN / PT-BR)
- [x] CI/CD (lint, format, build, matriz Node 18/20/22, coverage, type-check, audit)
- [x] Publicado no npm e no MCP Registry

## Fase 1 — Usabilidade (foco atual)

O objetivo é que um agente acerte a tool certa, com os parâmetros certos, e
receba uma resposta que ele consiga usar sem desperdiçar contexto.

### 1.1 Desambiguação e consolidação de tools ✅
- [x] Mapear sobreposições (população é atendida por 6 tools) e definir,
      para cada intenção, a tool canônica
- [x] Reescrever descrições com bloco "use a different tool when" nos clusters
      população, econômico, localidades, fluxo SIDRA e malhas
- [x] Avaliar fundir/aposentar tools — decisão: **desambiguar sem fundir**
      (reversível, não quebra a superfície publicada)
- [x] Mapa canônico publicado no README ("Qual ferramenta usar?" / EN+PT)
- [x] Bônus: removida a duplicação morta de descrições (array `tools` +
      objetos `xxxTool`) → fonte única em `src/index.ts`

### 1.2 Saída estruturada e compacta ✅
- [x] Adicionar `outputSchema` + `structuredContent` (JSON tipado) às tools de dado
      — todos os 7 tools de dado migrados
- [x] Limitar/paginar respostas grandes (ex.: SIDRA) com orientação de continuação
- [x] Seleção de campos onde fizer sentido reduzir volume — input `campos` nos
      4 tools tabulares (`sidra`, `censo`, `indicadores`, `datasaude`)

> Progresso:
> - Padrão reutilizável em `src/structured.ts` (`StructuredToolResult` +
>   `toMcpResult` + helper `sidraRecords`): sucesso → `structuredContent`; erro →
>   `isError` (isento de validação no SDK); vazio → payload estruturado vazio
>   (sucesso); resposta não-dado (ex.: `listar`) → payload mínimo válido.
> - **Migrados (7/23, todos os tools de dado)** via `server.registerTool` +
>   `outputSchema`: `ibge_sidra` (com paginação de 100/página via input `pagina`),
>   `ibge_censo`, `ibge_indicadores`, `datasaude`, `ibge_populacao`,
>   `ibge_comparar`, `ibge_cidades`. Confirmado end-to-end que `tools/list`
>   anuncia o `outputSchema` de cada um.
> - Os demais 16 tools são de catálogo/localidade/listagem (não-tabular); podem
>   receber `structuredContent` caso surja demanda.
> - **Falta:** avaliar seleção de campos onde reduzir volume fizer sentido.

### 1.3 Consistência de parâmetros ✅
- [x] Unificar formatos de data entre todas as tools (IBGE e BCB)
- [x] Normalizar entrada de localidade (sigla, nome ou código intercambiáveis)
- [x] Padronizar nomenclatura de níveis territoriais

> Resolução do item de datas:
> - Formato canônico adotado: **`DD/MM/AAAA`** (brasileiro), aceitando também
>   `DD-MM-AAAA` e ISO `AAAA-MM-DD`. Helpers `parseUserDate` / `toBcbDate` /
>   `toIbgeApiDate` em `src/validation.ts` convertem para o formato de cada API.
> - **Confirmado empiricamente** que as APIs `noticias` e `calendario` do IBGE
>   exigem `MM-DD-AAAA` (mês primeiro) — a conversão é interna; o usuário só vê
>   o formato brasileiro. A ordem mês-primeiro deixou de ser aceita na entrada.
> - Bônus: corrigido bug em `ibge_calendario` que lia campos inexistentes
>   (`data_inicio`/`produto`) e renderizava `NaN`.
>
> Resolução do item de localidade:
> - Criado `resolveUf(input)` em `src/config.ts` (fonte única) que aceita sigla
>   (`SP`), nome (`São Paulo`, sem depender de acento/caixa) e código (`35`).
>   `normalizeUf` passou a delegar a ele, propagando o suporte a nome a todas as
>   tools que já o usavam. `ibge_municipios`/`ibge_vizinhos`/`ibge_geocodigo`
>   passam a aceitar as três formas; removida restrição `length(2)` e um mapa de
>   UF duplicado no `geocodigo`.
> - Escopo de UF (estado). Resolução de **município por nome → código** já existe
>   localmente (`ibge_vizinhos`, `ibge_geocodigo`, `ibge_municipios(busca=)`);
>   unificá-la num helper único é candidato futuro, não bloqueante.
>
> Resolução do item de níveis territoriais:
> - Labels canônicos curtos em `TERRITORIAL_LEVEL_LABELS` + helpers
>   `territorialLevelHint`/`territorialLevelList` em `config.ts` geram todas as
>   descrições e sugestões de erro de `nivel_territorial`. Fim da divergência de
>   nomenclatura ("Grande Região" vs "Região") e de listas incompletas.
> - `ibge_sidra`/`ibge_censo`/`ibge_datasaude`/`ibge_indicadores` declaram os
>   níveis que de fato suportam e **validam** a entrada (antes os três últimos
>   repassavam nível inválido direto à API SIDRA).

### 1.4 Erros que ensinam ✅
- [x] Mensagens de erro que sugerem a correção e a tool correta
- [x] Mensagens claras para "combinação sem dado" (vs. falha real)
- [x] Timeout de requisição configurável

> Resolução do item "sugerir a tool correta":
> - Auditados os 20 pontos `catch → parseHttpError` das tools. Só ~5 passavam o
>   4º argumento `relatedTools`; agora todas as tools com uma irmã natural o
>   passam (14 call sites preenchidos), seguindo o mapa de desambiguação das
>   descrições em `index.ts`: ex. `bcb`→`ibge_indicadores`,
>   `ibge_municipios`→`ibge_geocodigo`/`ibge_localidade`,
>   `ibge_malhas`↔`ibge_malhas_tema`, `ibge_pesquisas`→`ibge_sidra_tabelas`/`ibge_sidra`.
> - **Decisão deliberada:** tools genuinamente sem irmã (`ibge_cnae`,
>   `ibge_nomes`, `ibge_paises`) ficam sem `relatedTools` — apontar uma tool
>   não-relacionada seria ruído, não ajuda.
> - +3 testes (`integration.test.ts`) confirmam que a falha de `ibge_estados` e
>   `ibge_municipios` rende o bloco "Ferramentas relacionadas".
>
> Resolução do item "sem dado vs falha real":
> - Verificado que **todas** as tools já distinguem os dois caminhos: erro real →
>   `parseHttpError`; resultado vazio/combinação sem dado → `ValidationErrors.emptyResult`
>   (mensagem própria, sem sinalizar falha de API). Confirmado nos 20 catch sites.
>
> Resolução do item de timeout:
> - Cada requisição agora tem um teto de tempo real: `fetchWithRetry` arma um
>   `AbortController` por tentativa (`createTimeoutSignal` em `retry.ts`), então
>   uma conexão pendurada não trava mais o cliente — antes não havia
>   `signal`/timeout e o `fetch` podia esperar indefinidamente.
> - **Configurável** via env `IBGE_MCP_TIMEOUT_MS` (default `30000`, em
>   `config.ts`) e por chamada via `RetryOptions.timeoutMs`.
> - Timeout conta como erro **transiente** (retentável); ao esgotar as
>   tentativas, lança `TimeoutError`, que `parseHttpError` converte na mensagem
>   pronta `timeoutError` (com segundos e tools relacionadas) — antes
>   `timeoutError` e o campo `FetchOptions.timeout` eram scaffolding morto, nunca
>   acionados. `FetchOptions` (não usado) foi removido.
> - +15 testes (`retry.test.ts`, `errors.test.ts`): aborta no teto, retenta e
>   sucede numa tentativa posterior, não aborta requisição rápida, e renderização
>   da mensagem de timeout.

### 1.5 Confiabilidade (a base da usabilidade)
- [x] Elevar cobertura de teste das tools (alvo: ≥50%), priorizando
      `sidra.ts`, `indicadores.ts`, `censo.ts`, `malhas.ts`
- [x] Tratamento gracioso de falhas/instabilidade das APIs upstream

> Resolução:
> - Tools prioritários muito acima do alvo: `sidra` 0→86%, `malhas` 0→95%,
>   `indicadores` 53→87%, `censo` 51→81%; bônus `datasaude` 16→88%.
> - Testes afirmam o tratamento gracioso já existente: distinção "sem dado" vs
>   falha real, `parseHttpError` com tools relacionadas, e rejeição de input
>   inválido sem chamar a API.
> - **Cauda longa fechada (2ª passada):** todo tool agora ≥50% — `cnae` 99%,
>   `geocodigo` 99%, `sidra-tabelas` 98%, `noticias` 33→98%, `comparar` 97%,
>   `paises` 2→96%, `nomes` 94%, `malhas-tema` 93%, `populacao` 92%, `pesquisas`
>   92%, `vizinhos` 92%, `cidades` 2→89%, `sidra-metadados` 88%. Pasta `tools`:
>   ~32%→**89%**. Suíte: 253→436 testes. Helper de mock em `tests/helpers.ts`;
>   `cidades`/`paises` tinham testes só de schema — adicionados testes de
>   invocação de função.

### 1.6 Capacidades do protocolo MCP (estado da arte) ✅
- [x] **Resources**: expor catálogos de referência (tabelas SIDRA, níveis
      territoriais, códigos de UF/região) como recursos legíveis
- [x] **Prompts**: templates de análise prontos (comparar municípios, montar
      perfil demográfico, cruzar IBGE + BCB)
- [x] **Annotations**: marcar todas as tools como read-only

> Resolução:
> - **Refator base:** construção do servidor extraída de `index.ts` para
>   `createServer()` em `src/server.ts` (sem efeitos colaterais → testável);
>   `index.ts` virou um wrapper STDIO fino. Isso permite testar a superfície do
>   protocolo de ponta a ponta com `InMemoryTransport` + `Client`.
> - **Annotations:** const `READ_ONLY` (`readOnlyHint`/`idempotentHint`/
>   `openWorldHint` true, `destructiveHint` false) aplicada às 23 tools — todas
>   são GET puro contra APIs públicas. Clients podem auto-aprovar/sinalizar como
>   seguras.
> - **Resources** (`src/resources.ts`): 5 catálogos JSON em `ibge://catalogos/…`
>   — `ufs`, `regioes`, `niveis-territoriais`, `tabelas-sidra`, `biomas` —
>   derivados de `config.ts` (fonte única). Dão ao agente as tabelas de lookup
>   sem gastar round-trip de tool nem chutar código.
> - **Prompts** (`src/prompts.ts`): 3 templates — `comparar-municipios`,
>   `perfil-demografico`, `cruzar-ibge-bcb` — que orientam o encadeamento das
>   tools certas, com argumentos validados por zod.
> - +7 testes (`tests/server.test.ts`) exercendo annotations, leitura de
>   resources e expansão de prompts via client real. Suíte: 453→460. Confirmado
>   que `node dist/index.js` ainda sobe normalmente.

## Fase 2 — Descobribilidade (depois da usabilidade)

Só faz sentido divulgar depois que a experiência justifica a adoção.

- [x] Reescrever o README com o diferencial explícito ("vs. só perguntar à IA")
- [ ] Demo curta (transcrição/GIF) mostrando uma análise real ponta a ponta
- [ ] Exemplos práticos que também servem de material de divulgação
- [x] Revisar metadados/keywords do package.json e server.json (SEO de registry)
- [ ] Presença e qualidade em listagens (MCP Registry, Glama, Smithery,
      listas "awesome-mcp")

> Progresso (2.1 + 2.4):
> - **README diferencial:** abertura dos dois READMEs (EN/PT-BR) reescrita com o
>   pitch "dado ao vivo/exato/com procedência vs. só perguntar à IA", com exemplo
>   concreto (população de BH no Censo 2022) e citando as três fontes (IBGE,
>   Banco Central, DataSUS).
> - **SEO de metadados:** `package.json` ganhou descrição orientada a valor +
>   ~11 keywords novas (`mcp-server`, `datasus`, `bcb`, `banco-central`, `ipca`,
>   `selic`, `cidades`, `demografia`, `geografia`, `estatistica`, `dados-abertos`,
>   `open-data`); `server.json` teve a descrição alinhada e a indentação quebrada
>   da linha corrigida (≤100 chars p/ o schema do registry).
> - **Pendente:** demo (2.2) e exemplos práticos (2.3) dependem de gravar/redigir
>   sessões reais; presença em listagens (2.5) depende de ações externas.
> - Nota: a nova descrição/keywords do `package.json` só aparecem no npm após o
>   próximo `publish` (mudança de metadados não republicada automaticamente).

## 🅿️ Fora de escopo (decidido — não readicionar sem nova justificativa)

- **Mais tools de APIs marginais** (áreas territoriais, fronteiras, PAM, produção
  agrícola, metadados, geocodificação, divisões administrativas): largura não é
  o gargalo. Reconsiderar só se houver demanda real de usuário.
- **Batch / streaming**: escala prematura.
- **OpenAPI/Swagger**: abstração errada para um servidor MCP.
- **Integração com outras fontes (INEP/ANS/Receita)**: seria outro produto.
- **Viz helpers / modo offline**: camada errada e contra a proposta de valor.
