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

### 1.1 Desambiguação e consolidação de tools
- [ ] Mapear sobreposições (ex.: população é atendida por 6 tools) e definir,
      para cada intenção, a tool canônica
- [ ] Reescrever descrições para deixar claro *quando NÃO usar* cada tool e
      apontar a alternativa correta
- [ ] Avaliar fundir/aposentar tools redundantes ou de baixo diferencial

### 1.2 Saída estruturada e compacta
- [ ] Adicionar `outputSchema` + `structuredContent` (JSON tipado) às tools de dado
- [ ] Limitar/paginar respostas grandes (ex.: SIDRA) com orientação de continuação
- [ ] Seleção de campos onde fizer sentido reduzir volume

### 1.3 Consistência de parâmetros
- [ ] Unificar formatos de data entre todas as tools (IBGE e BCB)
- [ ] Normalizar entrada de localidade (sigla, nome ou código intercambiáveis)
- [ ] Padronizar nomenclatura de níveis territoriais

### 1.4 Erros que ensinam
- [ ] Mensagens de erro que sugerem a correção e a tool correta
- [ ] Mensagens claras para "combinação sem dado" (vs. falha real)
- [ ] Timeout de requisição configurável

### 1.5 Confiabilidade (a base da usabilidade)
- [ ] Elevar cobertura de teste das tools (alvo: ≥50%), priorizando
      `sidra.ts`, `indicadores.ts`, `censo.ts`, `malhas.ts`
- [ ] Tratamento gracioso de falhas/instabilidade das APIs upstream

### 1.6 Capacidades do protocolo MCP (estado da arte)
- [ ] **Resources**: expor catálogos de referência (tabelas SIDRA, níveis
      territoriais, códigos de UF/região) como recursos legíveis
- [ ] **Prompts**: templates de análise prontos (comparar municípios, montar
      perfil demográfico, cruzar IBGE + BCB)
- [ ] **Annotations**: marcar todas as tools como read-only

## Fase 2 — Descobribilidade (depois da usabilidade)

Só faz sentido divulgar depois que a experiência justifica a adoção.

- [ ] Reescrever o README com o diferencial explícito ("vs. só perguntar à IA")
- [ ] Demo curta (transcrição/GIF) mostrando uma análise real ponta a ponta
- [ ] Exemplos práticos que também servem de material de divulgação
- [ ] Revisar metadados/keywords do package.json e server.json (SEO de registry)
- [ ] Presença e qualidade em listagens (MCP Registry, Glama, Smithery,
      listas "awesome-mcp")

## 🅿️ Fora de escopo (decidido — não readicionar sem nova justificativa)

- **Mais tools de APIs marginais** (áreas territoriais, fronteiras, PAM, produção
  agrícola, metadados, geocodificação, divisões administrativas): largura não é
  o gargalo. Reconsiderar só se houver demanda real de usuário.
- **Batch / streaming**: escala prematura.
- **OpenAPI/Swagger**: abstração errada para um servidor MCP.
- **Integração com outras fontes (INEP/ANS/Receita)**: seria outro produto.
- **Viz helpers / modo offline**: camada errada e contra a proposta de valor.
