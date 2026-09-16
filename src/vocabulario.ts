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
 * Vale para os dois caminhos de busca, pelas duas pontas da mesma tabela:
 * `ibge_sidra_tabelas` expande o TERMO da busca (OR dentro do termo, AND entre
 * termos — expandir só aumenta o recall, nunca perde casamento que já havia) e
 * o índice de `search` (Deep Research) recebe a palavra perguntada como KEYWORD
 * do agregado cujo nome traz a palavra da fonte.
 *
 * Mesma receita de `src/ilostat/vocabulary.ts` (ilo-mcp-server 0.6.0) e
 * `src/uis/vocabulary.ts` (uis-mcp-server 0.3.0); terceiro servidor com ela —
 * candidata a subir para `@sbissoli/mcp-search`.
 */

export interface EntradaVocabulario {
  /** Como o usuário escreve (um token, normalizado: minúsculo, sem acento). */
  readonly perguntado: string;
  /** Como o IBGE escreve — substrings normalizadas, podendo ser frase ("nascidos vivos"). */
  readonly fonte: readonly string[];
}

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

const POR_PERGUNTADO: ReadonlyMap<string, readonly string[]> = new Map(
  VOCABULARIO.map((e) => [e.perguntado, e.fonte])
);

/**
 * Palavras que não carregam significado no nome de um agregado e, em AND,
 * excluem resultado certo ("grupo de idade" não pode morrer no "de"). Só saem
 * quando sobra algum termo — busca feita só de stopword continua valendo.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "o",
  "as",
  "os",
  "um",
  "uma",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "ao",
  "aos",
  "por",
  "para",
  "com",
  "sem",
  "que",
  "ou",
]);

/** Sem acento, caixa baixa, espaços colapsados — os dois lados da busca passam por aqui. */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Forma singular de um termo já normalizado — a substring mais curta casa o
 * plural também. Só as regras do português que não fabricam caco: "ões/ães"
 * → "ão" (já sem acento: "oes"→"ao"), "ais/eis/ois" → "al/el/ol" e o "s" final.
 */
function singulares(termo: string): string[] {
  if (termo.length > 4 && (termo.endsWith("oes") || termo.endsWith("aes")))
    return [`${termo.slice(0, -3)}ao`];
  if (termo.length > 4 && /(ais|eis|ois)$/.test(termo)) return [`${termo.slice(0, -2)}l`];
  if (termo.length > 3 && termo.endsWith("s") && !termo.endsWith("ss")) return [termo.slice(0, -1)];
  return [];
}

/** Os termos efetivos da busca: normalizados, sem stopword, sem vazio. */
export function termosDaBusca(busca: string): string[] {
  const todos = normalizar(busca).split(" ").filter(Boolean);
  const ficam = todos.filter((t) => !STOPWORDS.has(t));
  return ficam.length ? ficam : todos;
}

/**
 * Um termo e as substrings que o representam na busca (o próprio termo primeiro).
 * A expansão só acrescenta alternativas em OR: o que casava antes segue casando.
 */
export function expandirTermo(termo: string): string[] {
  const t = normalizar(termo);
  const saida = [
    t,
    ...(POR_PERGUNTADO.get(t) ?? []),
    ...singulares(t).flatMap((s) => [s, ...(POR_PERGUNTADO.get(s) ?? [])]),
  ];
  return [...new Set(saida)];
}

export interface TermoExpandido {
  readonly termo: string;
  readonly padroes: readonly string[];
  /** A tabela (não a mera flexão de plural) mudou o que se procura. */
  readonly traduzido: boolean;
}

/** A busca inteira, termo a termo, pronta para virar filtro. */
export function expandirBusca(busca: string): TermoExpandido[] {
  return termosDaBusca(busca).map((termo) => {
    const padroes = expandirTermo(termo);
    const traduzido =
      POR_PERGUNTADO.has(termo) || singulares(termo).some((s) => POR_PERGUNTADO.has(s));
    return { termo, padroes, traduzido };
  });
}

/**
 * A frase que conta ao chamador que a palavra dele não é a do IBGE — sem isto
 * a tradução é invisível e o resultado parece vir do que ele escreveu.
 */
export function notasDeVocabulario(expandidos: readonly TermoExpandido[]): string[] {
  return expandidos
    .filter((e) => e.traduzido)
    .map((e) => {
      const outros = e.padroes.filter((p) => p !== e.termo);
      return `"${e.termo}" também foi buscado como ${outros.join(", ")} — a palavra que o IBGE usa.`;
    });
}

/** Um nome (já normalizado) casa o termo expandido? */
export function casaTermo(nomeNormalizado: string, expandido: TermoExpandido): boolean {
  return expandido.padroes.some((p) => nomeNormalizado.includes(p));
}

/** Um nome (já normalizado) casa TODOS os termos da busca expandida? */
export function casaBusca(nomeNormalizado: string, expandidos: readonly TermoExpandido[]): boolean {
  return expandidos.every((e) => casaTermo(nomeNormalizado, e));
}

/**
 * A ponta inversa da tabela: as palavras com que se PERGUNTA por este nome de
 * agregado — keywords do índice de `search`, que ranqueia por relevância em
 * vez de casar substring.
 */
export function palavrasPerguntadas(nome: string): string[] {
  const n = normalizar(nome);
  const saida = VOCABULARIO.filter((e) => e.fonte.some((f) => n.includes(f))).map(
    (e) => e.perguntado
  );
  return [...new Set(saida)];
}
