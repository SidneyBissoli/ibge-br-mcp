/**
 * Toda contagem de ferramentas escrita em texto para HUMANO bate com a
 * superfície real do servidor.
 *
 * POR QUE ESTE ARQUIVO EXISTE. A superfície foi de 23 para 22 e depois para 21
 * ferramentas (v2.0.0 removeu a tool `bcb`; a revisão seguinte fundiu as de
 * nomes). Os números escritos à mão nos textos não foram junto, e cada um
 * envelheceu por conta própria: em 2026-08-30 o `README`, o `server.json` e o
 * `CLAUDE.md` diziam 21, a ficha do awesome dizia 23 (corrigida para 22, ainda
 * errado) e a `description` do Worker — que é o que a LANDING PAGE, o `/status`
 * e o `server-card` mostram, ou seja a única superfície pública em português —
 * dizia 22. O defeito não quebra nada e por isso não aparece: só um leitor
 * conferindo tool por tool o encontraria.
 *
 * A defesa tem que ficar aqui, e não num literal a mais. `evals/fixtures` já
 * pina o total (tripwire para renomear/remover tool) e é ele que o
 * desenvolvedor atualiza quando a contagem muda de verdade — mas atualizar
 * aquele número não diz nada sobre a PROSA. Este teste fecha o vão: ele deriva
 * a contagem do `registerAll` real e a compara com o que cada texto afirma,
 * sem pinar literal nenhum ([[verificacao-deriva-da-fonte]]).
 *
 * Ao acrescentar um arquivo que anuncie a contagem para o público, some-o a
 * TEXTOS. Histórico (CHANGELOG, ROADMAP, relatórios de segurança, resultados
 * de eval) fica de fora de propósito: ali o número antigo é o registro correto
 * do que era verdade naquele dia.
 *
 * A segunda metade guarda a PARIDADE pt/en. No bcb a mesma classe de defeito
 * apareceu maior: o README traduzido listava 9 das 15 ferramentas, duas
 * famílias inteiras a menos, porque o texto em inglês é o que se revisa a cada
 * release e o traduzido é cópia que ninguém reabre. Aqui os dois estão em dia;
 * o teste é o que mantém.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { CATALOG } from "../evals/catalog.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leia = (f: string) => readFileSync(join(raiz, f), "utf8");

/** Textos vivos, voltados ao público, que podem afirmar um total. */
const TEXTOS = [
  "README.md",
  "README.pt-BR.md",
  "server.json",
  "package.json",
  "worker/src/config.ts",
] as const;

/** "21 tools", "21 ferramentas", "21 ferramentas especializadas". */
const AFIRMACAO = /(\d+)\s+(?:tools|ferramentas)\b/gi;
/** Nomes de ferramenta citados em crase no texto. */
const CITADAS = /`(ibge_[a-z_0-9]+)`/g;

describe("contagem de ferramentas nos textos públicos", () => {
  const esperado = CATALOG.tools.length;

  it("o catálogo vivo é a fonte da contagem", () => {
    expect(esperado).toBeGreaterThan(0);
  });

  for (const arquivo of TEXTOS) {
    it(`${arquivo} não afirma uma contagem diferente de ${esperado}`, () => {
      const conteudo = readFileSync(join(raiz, arquivo), "utf8");
      for (const [trecho, numero] of [...conteudo.matchAll(AFIRMACAO)].map(
        (m) => [m[0], Number(m[1])] as const,
      )) {
        expect(
          numero,
          `${arquivo} anuncia "${trecho}", mas o servidor registra ${esperado} ferramentas`,
        ).toBe(esperado);
      }
    });
  }
});

describe("paridade entre o README em inglês e o em português", () => {
  const pt = "README.pt-BR.md";

  it("o README em português existe", () => {
    expect(existsSync(join(raiz, pt)), `${pt} ausente — metade da superfície em pt`).toBe(true);
  });

  it("cita exatamente as mesmas ferramentas que o README em inglês", () => {
    const nomes = (f: string) => new Set([...leia(f).matchAll(CITADAS)].map((m) => m[1]));
    const en = nomes("README.md");
    const ptBR = nomes(pt);
    const faltamNoPt = [...en].filter((n) => !ptBR.has(n)).sort();
    const sobramNoPt = [...ptBR].filter((n) => !en.has(n)).sort();
    expect(faltamNoPt, "ferramentas no README em inglês e ausentes do português").toEqual([]);
    expect(sobramNoPt, "ferramentas no README em português e ausentes do inglês").toEqual([]);
  });

  it("tem o mesmo esqueleto de seções", () => {
    const secoes = (f: string) => (leia(f).match(/^#{2,3} /gm) ?? []).length;
    expect(secoes(pt), "número de seções divergente entre os dois READMEs").toBe(secoes("README.md"));
  });
});
