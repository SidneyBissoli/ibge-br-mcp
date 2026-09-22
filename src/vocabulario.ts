/**
 * O vocabulário da PERGUNTA contra o vocabulário da FONTE.
 *
 * `ibge_sidra_tabelas` casava o que o usuário escreveu contra o NOME do
 * agregado por substring contígua, SEM tirar acento: quem escrevia
 * "populacao" (sem til, como se digita depressa e como um agente em inglês
 * transcreve) não recebia um resultado ruim — recebia ZERO, sem dizer por quê.
 * Medido nos 9.336 agregados da API v3 (`/agregados`) em 2026-09-16:
 *
 *   perguntado (como se digita)   n     o IBGE escreve                 n
 *   populacao                     0     população                    520
 *   ocupacao                      0     ocupação                     364
 *   instrucao                     0     instrução                    698
 *   domicilio                    20     domicílio                  3.606
 *   municipio                     4     município                    455
 *   saude                         1     saúde                        518
 *   area                          0     área                         956
 *   agua                          0     água                         256
 *   servicos / comercio           0     serviços / comércio      474 / 157
 *   deficiencia                   0     deficiência                  332
 *   salario                       0     salário                       99
 *   forca de trabalho             0     força de trabalho            332
 *
 * Isso é ACENTO, e se resolve normalizando os dois lados (NFD sem diacríticos,
 * caixa baixa), como `normalizeText` já fazia noutras tools e como o índice de
 * `search` sempre fez. O resto é VOCABULÁRIO — a palavra de todo dia contra a
 * palavra do IBGE — e é o que a tabela abaixo guarda, com a mesma medição:
 *
 *   perguntado          n     o IBGE escreve                          n
 *   desemprego          4     desocupação                            33
 *   desempregados       0     desocupadas / desocupados              16
 *   renda              72     rendimento                          1.126
 *   inflação            0     IPCA / INPC / preços             37 / 15 / 75
 *   moradia            14     domicílio                           3.606
 *   casa              101     domicílio                           3.606
 *   cidade            110     município                             455
 *   natalidade          0     nascidos vivos                         84
 *   mortes              1     óbitos                                 33
 *   gênero             40     sexo                                2.020
 *   negros              0     cor ou raça / preta / parda   1.134 / 123
 *   universidade        0     ensino superior / superior         12 / 64
 *   faculdade           0     ensino superior / superior         12 / 64
 *   matrícula           0     frequenta / escola               394 / 610
 *   luz                 0     energia elétrica / eletricidade    43 / 31
 *   emprego            85     ocupação / pessoas ocupadas     364 / 359
 *   fábrica             0     indústria                             248
 *   tabagismo           0     fumante                                94
 *   convênio            2     plano de saúde                        101
 *   migração            3     naturalidade / lugar de nascimento 23 / 15
 *   miséria             0     pobreza                                42
 *   desigualdade        0     gini                                   24
 *   etária             43     idade (grupo de idade)          704 (6.092)
 *   pós-graduação       0     mestrado / doutorado                5 / 5
 *   idosos              0     60 anos (ou mais)                      89
 *   expectativa de vida 0     esperança de vida                       3
 *   quarto              0     dormitório                             46
 *
 * Regra desta tabela: só entra par MEDIDO — a palavra perguntada ausente (ou
 * quase) do catálogo e a palavra da fonte presente. Nada de sinônimo plausível
 * sem contagem; termo que o IBGE não publica em agregado fica de fora, porque
 * inventar apelido para dado inexistente é prometer o que a fonte não tem.
 * Medido e deixado de fora em 2026-09-16: turismo (0), aposentadoria (0),
 * jovem/idoso (0 — o IBGE corta por "grupo de idade", não por rótulo),
 * carro/frota (0 — frota é do Denatran), imc (0), matrícula como cadastro
 * (0 — o IBGE mede "frequenta escola", não matrícula, que é do Inep).
 *
 * A MECÂNICA (normalização dos dois lados, AND por palavra com stopwords do
 * pt-BR fora, singular sem caco, OR das grafias do IBGE, a nota dita e a ponta
 * inversa para o índice de `search`) mora em `@sbissoli/mcp-search` desde a
 * 0.5.0 — cinco servidores a carregavam em cópia; aqui fica só a tabela. Os
 * nomes exportados são os de sempre (em português), para quem chama não mudar.
 */

import { createVocabulary, type ExpandedTerm } from "@sbissoli/mcp-search";

export interface EntradaVocabulario {
  /** Como o usuário escreve (um token, normalizado: minúsculo, sem acento). */
  readonly perguntado: string;
  /** Como o IBGE escreve — substrings normalizadas, podendo ser frase ("nascidos vivos"). */
  readonly fonte: readonly string[];
}

/**
 * A tabela do catálogo de AGREGADOS (`ibge_sidra_tabelas`), medida contra os
 * 9.336 agregados da API v3. Não serve à CNAE: ver `VOCABULARIO_CNAE` e a
 * medição que separou as duas.
 */
export const VOCABULARIO: readonly EntradaVocabulario[] = [
  { perguntado: "desemprego", fonte: ["desocupa"] },
  { perguntado: "desempregado", fonte: ["desocupa"] },
  { perguntado: "desempregada", fonte: ["desocupa"] },
  { perguntado: "renda", fonte: ["rendimento"] },
  { perguntado: "inflacao", fonte: ["ipca", "inpc", "precos"] },
  { perguntado: "moradia", fonte: ["domicilio"] },
  { perguntado: "casa", fonte: ["casa", "domicilio"] },
  { perguntado: "cidade", fonte: ["cidade", "municipio"] },
  { perguntado: "natalidade", fonte: ["nascidos vivos"] },
  { perguntado: "morte", fonte: ["obito"] },
  { perguntado: "genero", fonte: ["genero", "sexo"] },
  { perguntado: "negro", fonte: ["cor ou raca", "preta", "parda"] },
  { perguntado: "negra", fonte: ["cor ou raca", "preta", "parda"] },
  { perguntado: "universidade", fonte: ["ensino superior", "superior"] },
  { perguntado: "faculdade", fonte: ["ensino superior", "superior"] },
  { perguntado: "matricula", fonte: ["frequenta", "escola"] },
  { perguntado: "luz", fonte: ["energia eletrica", "eletricidade"] },
  { perguntado: "emprego", fonte: ["emprego", "ocupa"] },
  { perguntado: "fabrica", fonte: ["industria"] },
  { perguntado: "tabagismo", fonte: ["fumante"] },
  { perguntado: "convenio", fonte: ["plano de saude"] },
  { perguntado: "migracao", fonte: ["migra", "naturalidade", "lugar de nascimento"] },
  { perguntado: "migrante", fonte: ["migra", "naturalidade", "lugar de nascimento"] },
  { perguntado: "miseria", fonte: ["pobreza"] },
  { perguntado: "desigualdade", fonte: ["gini"] },
  { perguntado: "etaria", fonte: ["idade"] },
  { perguntado: "pos-graduacao", fonte: ["mestrado", "doutorado"] },
  { perguntado: "idoso", fonte: ["60 anos"] },
  { perguntado: "idosa", fonte: ["60 anos"] },
  { perguntado: "expectativa", fonte: ["expectativa", "esperanca"] },
  { perguntado: "quarto", fonte: ["quarto", "dormitorio"] },
];

/**
 * A tabela do catálogo da CNAE (`ibge_cnae`), medida contra as 1.332
 * subclasses da API v2 em 2026-09-22.
 *
 * É uma SEGUNDA tabela, e não entradas novas na de cima, porque a regra "só
 * entra par medido" é medida CONTRA UM CATÁLOGO: são 1.332 subclasses de
 * atividade econômica contra 9.336 agregados estatísticos, e o par bom num é
 * falso positivo no outro. Medido nas subclasses, com os pares do SIDRA:
 *
 *   etaria → idade      126 subclasses, e são "ATIVIDADE..." (ativIDADEs de apoio)
 *   negro  → preta        1, "SERVIÇOS DE TRADUÇÃO, INTERPRETAÇÃO" (interPRETAção)
 *   emprego → ocupa       1, "ATIVIDADES DE TERAPIA OCUPACIONAL"
 *
 * Misturar as duas apagaria a medição de origem e entregaria esses falsos
 * positivos como resposta plausível — o mesmo defeito que a tabela conserta.
 *
 * Medido nas 1.332 subclasses em 2026-09-22 (`scripts/medicoes/tabela-pares.mjs`):
 *
 *   perguntado     n     o IBGE escreve                        n
 *   software       1*    programas de computador               3   * "REPRODUÇÃO DE SOFTWARE"
 *   app            0     programas de computador               3
 *   aplicativo     0     programas de computador               3
 *   site           0     programas de computador / portais   3 / 1
 *   farmacia       0     produtos farmacêuticos                3
 *   drogaria       0     produtos farmacêuticos                3
 *   dentista       0     odontolog                             5
 *   consultorio    0     ambulatorial                          4
 *   advogado       0     advocatícios                          1
 *   advocacia      0     advocatícios                          1
 *   contador       0     contabilidade / contábil            1 / 2
 *   hotel          0     hotéis                                2   só o PLURAL existe
 *   motel          0     motéis                                1
 *   pousada        0     pensões / alojamento                1 / 4
 *   academia       0     condicionamento físico                1
 *   salao          0     cabeleireiro                          1
 *   barbearia      0     cabeleireiro                          1
 *   caminhao       0     transporte rodoviário de carga        2
 *   frete          0     transporte rodoviário de carga        2
 *   delivery       0     consumo domiciliar                    1
 *   pizzaria       0     restaurantes / lanchonetes          1 / 1
 *   petshop        0     animais domésticos                    2
 *   teatro         0     artes cênicas                         3
 *   jardinagem     0     paisagísticas                         1
 *   reciclagem     0     resíduos / sucatas                  8 / 3
 *   lixo           0     resíduos                              8
 *   faculdade      0     educação superior                     3
 *   universidade   0     educação superior                     3
 *   propaganda     0     publicidade                           5
 *
 * `software` é o único com lado perguntado diferente de zero nos cinco níveis,
 * e o 1 é a resposta ERRADA (`1830003 REPRODUÇÃO DE SOFTWARE EM QUALQUER
 * SUPORTE` — prensar mídia); o par acrescenta as três de desenvolvimento sem
 * tirá-la. Nos outros 28 o lado perguntado é 0 em seções, divisões, grupos,
 * classes e subclasses, então o par nunca REMOVE resultado em nível nenhum —
 * só acrescenta. Por isso a tabela vale para os cinco níveis.
 *
 * Medidos e deixados de FORA em 2026-09-22 (registrado para ninguém refazer):
 *
 *  - `oficina`. As duas grafias plausíveis dão par largo demais: OR de
 *    "manutenção e reparação" com "veículos automotores" casa 63 subclasses,
 *    entre elas 12 de FABRICAÇÃO de peças e o comércio varejista de
 *    combustíveis; "veículos automotores" sozinho casa 26, metade fabricação e
 *    comércio. O AND das duas casaria 3, e perderia 5 das 8 do grupo 4520
 *    (borracharia, lanternagem, alinhamento, lavagem, capotaria) — além de a
 *    mecânica fazer OR, e não AND, das grafias de um par. Resultado plausível e
 *    errado é o defeito que se está consertando, então `oficina` vai para a
 *    dica do zero, não para a tabela.
 *  - `startup`, `coworking`, `influencer`, `ecommerce`, `comercio eletronico`,
 *    `streaming` — 0 dos DOIS lados. A CNAE 2.0 não publica esses rótulos, e
 *    inventar apelido para dado inexistente é prometer o que a fonte não tem.
 *  - `marketing` (1), `loja` (8), `mercado` (14), `bar` (12), `banco` (12) — a
 *    palavra de todo dia JÁ casa; par nenhum a melhora.
 *
 * Armadilha medida e NÃO consertada aqui: `uber` casa 1 subclasse por estar
 * dentro de `TUBÉRCULOS`. A mecânica casa substring sem fronteira de palavra;
 * isso é de `@sbissoli/mcp-search` e vale para os cinco servidores que a usam,
 * não de uma tabela. Fica como caso de teste que documenta o comportamento de
 * hoje.
 */
export const VOCABULARIO_CNAE: readonly EntradaVocabulario[] = [
  { perguntado: "software", fonte: ["software", "programas de computador"] },
  { perguntado: "app", fonte: ["programas de computador"] },
  { perguntado: "aplicativo", fonte: ["programas de computador"] },
  { perguntado: "site", fonte: ["programas de computador", "portais"] },
  { perguntado: "farmacia", fonte: ["produtos farmaceuticos"] },
  { perguntado: "drogaria", fonte: ["produtos farmaceuticos"] },
  { perguntado: "dentista", fonte: ["odontolog"] },
  { perguntado: "consultorio", fonte: ["ambulatorial"] },
  { perguntado: "advogado", fonte: ["advocaticios"] },
  { perguntado: "advocacia", fonte: ["advocaticios"] },
  { perguntado: "contador", fonte: ["contabilidade", "contabil"] },
  { perguntado: "hotel", fonte: ["hoteis"] },
  { perguntado: "motel", fonte: ["moteis"] },
  { perguntado: "pousada", fonte: ["pensoes", "alojamento"] },
  { perguntado: "academia", fonte: ["condicionamento fisico"] },
  { perguntado: "salao", fonte: ["cabeleireiro"] },
  { perguntado: "barbearia", fonte: ["cabeleireiro"] },
  { perguntado: "caminhao", fonte: ["transporte rodoviario de carga"] },
  { perguntado: "frete", fonte: ["transporte rodoviario de carga"] },
  { perguntado: "delivery", fonte: ["consumo domiciliar"] },
  { perguntado: "pizzaria", fonte: ["restaurantes", "lanchonetes"] },
  { perguntado: "petshop", fonte: ["animais domesticos"] },
  { perguntado: "teatro", fonte: ["artes cenicas"] },
  { perguntado: "jardinagem", fonte: ["paisagisticas"] },
  { perguntado: "reciclagem", fonte: ["residuos", "sucatas"] },
  { perguntado: "lixo", fonte: ["residuos"] },
  { perguntado: "faculdade", fonte: ["educacao superior"] },
  { perguntado: "universidade", fonte: ["educacao superior"] },
  { perguntado: "propaganda", fonte: ["publicidade"] },
];

const vocabulario = createVocabulary({
  entries: VOCABULARIO.map((e) => ({ asked: e.perguntado, source: e.fonte })),
  locale: "pt-BR",
  sourceName: "o IBGE",
});

const vocabularioCnae = createVocabulary({
  entries: VOCABULARIO_CNAE.map((e) => ({ asked: e.perguntado, source: e.fonte })),
  locale: "pt-BR",
  sourceName: "a CNAE",
});

export interface TermoExpandido {
  readonly termo: string;
  readonly padroes: readonly string[];
  /** A tabela (não a mera flexão de plural) mudou o que se procura. */
  readonly traduzido: boolean;
}

const emPortugues = (e: ExpandedTerm): TermoExpandido => ({
  termo: e.term,
  padroes: e.patterns,
  traduzido: e.translated,
});
const emIngles = (e: TermoExpandido): ExpandedTerm => ({
  term: e.termo,
  patterns: e.padroes,
  translated: e.traduzido,
});

/** Sem acento, caixa baixa, espaços colapsados — os dois lados da busca passam por aqui. */
export const normalizar = vocabulario.normalize;
/** Os termos efetivos da busca: normalizados, sem stopword, sem vazio. */
export const termosDaBusca = vocabulario.queryTerms;
/** Um termo e as substrings que o representam na busca (o próprio termo primeiro). */
export const expandirTermo = vocabulario.expandTerm;
/** A busca inteira, termo a termo, pronta para virar filtro. */
export function expandirBusca(busca: string): TermoExpandido[] {
  return vocabulario.expandQuery(busca).map(emPortugues);
}
/** A frase que conta ao chamador que a palavra dele não é a do IBGE. */
export function notasDeVocabulario(expandidos: readonly TermoExpandido[]): string[] {
  return vocabulario.vocabularyNotes(expandidos.map(emIngles));
}
/** Um nome (já normalizado) casa o termo expandido? */
export function casaTermo(nomeNormalizado: string, expandido: TermoExpandido): boolean {
  return vocabulario.matchesTerm(nomeNormalizado, emIngles(expandido));
}
/** Um nome (já normalizado) casa TODOS os termos da busca expandida? */
export function casaBusca(nomeNormalizado: string, expandidos: readonly TermoExpandido[]): boolean {
  return vocabulario.matchesQuery(nomeNormalizado, expandidos.map(emIngles));
}
/** A ponta inversa: as palavras com que se PERGUNTA por este nome — keywords do índice de `search`. */
export const palavrasPerguntadas = vocabulario.askedWordsFor;

/* ── A mesma ponta, para o catálogo da CNAE (`VOCABULARIO_CNAE`) ───────────── */

/** A busca inteira contra o vocabulário da CNAE, pronta para virar filtro. */
export function expandirBuscaCnae(busca: string): TermoExpandido[] {
  return vocabularioCnae.expandQuery(busca).map(emPortugues);
}
/** A frase que conta ao chamador que a palavra dele não é a da CNAE. */
export function notasDeVocabularioCnae(expandidos: readonly TermoExpandido[]): string[] {
  return vocabularioCnae.vocabularyNotes(expandidos.map(emIngles));
}
/** Uma descrição (já normalizada) casa TODOS os termos da busca expandida? */
export function casaBuscaCnae(
  descricaoNormalizada: string,
  expandidos: readonly TermoExpandido[]
): boolean {
  return vocabularioCnae.matchesQuery(descricaoNormalizada, expandidos.map(emIngles));
}
