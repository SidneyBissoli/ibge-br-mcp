/**
 * SIDRA pela API de Agregados v3 — o mesmo banco, por outra porta.
 *
 * POR QUE EXISTE. Em 15/09/2026 (entre o último smoke verde, 14/09 22:11 UTC,
 * e o primeiro vermelho, 16/09 01:12 UTC) o IBGE pôs `apisidra.ibge.gov.br`
 * atrás de um desafio gerenciado do Cloudflare (`cf-mitigated: challenge`, a
 * página "Just a moment..."). Medido em 16/09/2026: 60 de 60 requisições
 * feitas com o `fetch` do Node voltaram 403, com qualquer User-Agent — o
 * desafio exige executar JavaScript de navegador, e nenhum cliente
 * programático passa: nem o Worker em produção, nem o CI, nem o stdio. As
 * seis ferramentas que liam o SIDRA por lá (`ibge_sidra`, `ibge_censo`,
 * `ibge_comparar`, `ibge_datasaude`, `ibge_indicadores`, `ibge_vizinhos`)
 * emudeceram de uma vez.
 *
 * A API de Agregados v3 (`servicodados.ibge.gov.br/api/v3/agregados`) serve
 * as MESMAS tabelas do SIDRA — é a API que o próprio site do SIDRA consome —
 * e com `view=flat` responde no formato idêntico ao do apisidra: a primeira
 * linha é o cabeçalho (NC, NN, MC, MN, V, D1C, D1N, …) e as demais são os
 * dados, código de unidade inclusive. Conferido em 16/09/2026 para tabela
 * anual, mensal (rótulo "outubro 2019"), classificação múltipla, município e
 * consulta sem dado (só o cabeçalho, como no apisidra). Por isso este módulo
 * só TRADUZ o caminho: as ferramentas continuam montando o caminho do SIDRA
 * (`/t/6579/n3/all/v/allxp/p/last`), que é a gramática que a documentação
 * delas publica, e o que muda é a URL que vai para a rede — e que vai para a
 * proveniência, porque a citação tem de apontar para onde o dado veio.
 *
 * O que NÃO é igual: o erro. O apisidra respondia 400 com a frase que resolve
 * o caso ("Parâmetro N3 (Nível territorial) incompatível com a tabela"); a v3
 * responde 500 "Internal server error" a tabela, variável, nível ou
 * localidade inválidos, sem dizer qual. `explicarFalha` pergunta aos
 * metadados da tabela (uma chamada, em cache de um dia) e recompõe a frase,
 * para o chamador não voltar a tentar combinações às cegas — a razão de ser
 * do `UpstreamError`.
 */

import { IBGE_API } from "./types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "./cache.js";
import { RETRY_PRESETS, UpstreamError, type RetryOptions } from "./retry.js";

/**
 * Retry para a v3: igual ao padrão, MENOS o 500. O apisidra respondia 400 a
 * parâmetro inválido, e 400 nunca foi retentado; a v3 responde 500 ao mesmo
 * erro, que é determinístico — retentá-lo quatro vezes com espera exponencial
 * (2 s, 4 s, 8 s, 16 s) faria uma tabela digitada errado levar meio minuto
 * para responder. 502/503/504 e 429 continuam sendo o que são: transitórios.
 * Quem chama pode sobrepor (`ibge_vizinhos` usa o preset rápido), e a
 * exclusão do 500 se mantém por baixo.
 */
export const RETRY_SIDRA: RetryOptions = {
  ...RETRY_PRESETS.DEFAULT,
  retryableStatusCodes: [408, 429, 502, 503, 504],
};

/** Uma consulta do SIDRA, lida do caminho `/t/…/n…/…/v/…/p/…[/c…/…]`. */
export interface CaminhoSidra {
  tabela: string;
  /** Só o número do nível territorial (`3` para `n3`). */
  nivel: string;
  /** `all`, um código ou lista separada por vírgula, como no caminho. */
  localidades: string;
  /** `all`, `allxp`, um código ou lista separada por vírgula. */
  variaveis: string;
  /** Como veio no caminho (`last`, `last 4`, `all`, `2022`, `2010-2020`, `2010,2020`). */
  periodos: string;
  classificacoes: Array<{ id: string; categorias: string }>;
}

/**
 * Lê o caminho na gramática do apisidra: pares `chave/valor` em qualquer
 * ordem — `t`, `n<nível>`, `v`, `p`, `c<classificação>` — mais as opções de
 * formatação `f`, `h` e `d`, que são ignoradas: a v3 com `view=flat` já
 * devolve código e rótulo de toda dimensão, que é o que as ferramentas leem.
 * Caminho sem tabela, nível, variável ou período é erro de programação, não
 * da fonte, e lança.
 */
export function lerCaminhoSidra(caminho: string): CaminhoSidra {
  const partes = caminho
    .split("/")
    .filter(Boolean)
    .map((p) => decodeURIComponent(p));
  let tabela: string | undefined;
  let nivel: string | undefined;
  let localidades: string | undefined;
  let variaveis: string | undefined;
  let periodos: string | undefined;
  const classificacoes: Array<{ id: string; categorias: string }> = [];

  for (let i = 0; i + 1 < partes.length; i += 2) {
    const chave = partes[i];
    const valor = partes[i + 1];
    if (chave === "t") tabela = valor;
    else if (/^n\d+$/i.test(chave)) {
      nivel = chave.slice(1);
      localidades = valor;
    } else if (chave === "v") variaveis = valor;
    else if (chave === "p") periodos = valor;
    else if (/^c\d+$/i.test(chave)) classificacoes.push({ id: chave.slice(1), categorias: valor });
  }

  if (!tabela || nivel === undefined || !localidades || !variaveis || !periodos) {
    throw new Error(`Caminho SIDRA incompleto (precisa de t, n, v e p): ${caminho}`);
  }
  return { tabela, nivel, localidades, variaveis, periodos, classificacoes };
}

/**
 * Período na gramática da v3: `last` é `-1`, `last N` é `-N`; `all`, `first`,
 * ano, intervalo (`2010-2020`) e lista (`2010,2020`) passam como estão —
 * conferido em 16/09/2026 que a v3 aceita os quatro.
 */
export function periodosAgregados(periodos: string): string {
  const m = /^last(?:\s+(\d+))?$/i.exec(periodos.trim());
  if (m) return `-${m[1] ?? "1"}`;
  return periodos.trim();
}

/** A URL da v3 que reproduz a consulta, já com `view=flat`. */
export function urlAgregados(consulta: CaminhoSidra): string {
  let url =
    `${IBGE_API.AGREGADOS}/${consulta.tabela}` +
    `/periodos/${periodosAgregados(consulta.periodos)}` +
    `/variaveis/${consulta.variaveis}` +
    `?localidades=N${consulta.nivel}[${consulta.localidades}]`;
  if (consulta.classificacoes.length > 0) {
    url += `&classificacao=${consulta.classificacoes.map((c) => `${c.id}[${c.categorias}]`).join("|")}`;
  }
  return `${url}&view=flat`;
}

/** Caminho do SIDRA → URL da v3, num passo só. */
export function traduzirCaminhoSidra(caminho: string): string {
  return urlAgregados(lerCaminhoSidra(caminho));
}

/** O que `fetchSidra` devolve: a URL que foi de fato consultada vai para a proveniência. */
export interface RespostaSidra<T> {
  url: string;
  chaveCache: string;
  data: T;
}

/**
 * Busca uma consulta do SIDRA pela v3, com cache e retry iguais aos de
 * `cachedFetch`. Falha da fonte sem explicação (5xx) passa por
 * `explicarFalha` antes de subir.
 */
export async function fetchSidra<T = Record<string, string>[]>(
  caminho: string,
  ttlMinutes?: number,
  retryOptions?: RetryOptions
): Promise<RespostaSidra<T>> {
  const consulta = lerCaminhoSidra(caminho);
  const url = urlAgregados(consulta);
  const chaveCache = cacheKey(url);
  try {
    const data = await cachedFetch<T>(url, chaveCache, ttlMinutes, { ...RETRY_SIDRA, ...retryOptions });
    return { url, chaveCache, data };
  } catch (erro) {
    if (erro instanceof UpstreamError && erro.status >= 500) {
      const explicado = await explicarFalha(consulta, erro);
      if (explicado) throw explicado;
    }
    throw erro;
  }
}

interface MetadadosAgregado {
  nivelTerritorial?: Record<string, string[] | undefined>;
  variaveis?: Array<{ id?: number | string }>;
  classificacoes?: Array<{ id?: number | string }>;
}

/**
 * Recompõe, a partir dos metadados da tabela, a frase que o apisidra dava de
 * graça. Só afirma o que os metadados provam: tabela que não existe, variável
 * ou classificação fora da tabela, nível territorial que ela não publica.
 * Quando tudo isso confere, a causa que sobra é a localidade (código que não
 * existe naquele nível) ou o período, e a frase diz isso sem escolher.
 * Devolve `undefined` se os próprios metadados não puderem ser lidos por
 * outro motivo — aí o erro original é a melhor informação que há.
 */
async function explicarFalha(
  consulta: CaminhoSidra,
  original: UpstreamError
): Promise<UpstreamError | undefined> {
  const urlMeta = `${IBGE_API.AGREGADOS}/${consulta.tabela}/metadados`;
  let meta: MetadadosAgregado;
  try {
    meta = await cachedFetch<MetadadosAgregado>(urlMeta, cacheKey(urlMeta), CACHE_TTL.STATIC, RETRY_SIDRA);
  } catch (erro) {
    if (erro instanceof UpstreamError) {
      return new UpstreamError(400, "Bad Request", `Tabela ${consulta.tabela}: tabela inválida`);
    }
    return undefined;
  }

  const niveis = Object.values(meta.nivelTerritorial ?? {}).flatMap((lista) => lista ?? []);
  if (niveis.length > 0 && !niveis.includes(`N${consulta.nivel}`)) {
    return new UpstreamError(
      400,
      "Bad Request",
      `Parâmetro N${consulta.nivel} (Nível territorial) incompatível com a tabela ${consulta.tabela}. ` +
        `Níveis que ela publica: ${niveis.join(", ")}`
    );
  }

  if (!/^all(xp)?$/i.test(consulta.variaveis)) {
    const conhecidas = new Set((meta.variaveis ?? []).map((v) => String(v.id)));
    const estranhas = consulta.variaveis.split(",").filter((v) => !conhecidas.has(v.trim()));
    if (conhecidas.size > 0 && estranhas.length > 0) {
      return new UpstreamError(
        400,
        "Bad Request",
        `Parâmetro V (Variável) com código ${estranhas.join(", ")} inexistente na tabela ${consulta.tabela}. ` +
          `Variáveis que ela tem: ${[...conhecidas].join(", ")}`
      );
    }
  }

  const classes = new Set((meta.classificacoes ?? []).map((c) => String(c.id)));
  const semClasse = consulta.classificacoes.filter((c) => !classes.has(c.id));
  if (semClasse.length > 0) {
    return new UpstreamError(
      400,
      "Bad Request",
      `Parâmetro C${semClasse.map((c) => c.id).join(", C")} (Classificação) inexistente na tabela ${consulta.tabela}` +
        (classes.size > 0 ? `. Classificações que ela tem: ${[...classes].join(", ")}` : "")
    );
  }

  return new UpstreamError(
    original.status,
    original.statusText,
    `A fonte recusou a consulta sem dizer por quê. Tabela ${consulta.tabela}, ` +
      `variável ${consulta.variaveis} e nível N${consulta.nivel} existem; ` +
      `o que resta conferir é a localidade (${consulta.localidades}) — existe nesse nível? — ` +
      `e o período (${consulta.periodos}).`
  );
}
