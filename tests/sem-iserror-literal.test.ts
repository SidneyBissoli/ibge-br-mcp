/**
 * Guarda: nenhum resultado de erro nasce SEM classe declarada.
 *
 * Por que existe. Varredura de 30/09/2026: de ~118 resultados de erro em
 * `src/tools`, só ~24 levavam a classe (`CLASSE_DO_ERRO`); o resto deixava a
 * telemetria classificar pela FRASE, e a frase ecoa argumento do chamador. O
 * defeito de origem (medical, no mesmo dia) foi um handler que montava
 * `{ content, isError: true }` à mão: o código ecoado "INVALID" casou
 * `\binvalid` e um não-encontrado saiu `contrato`.
 *
 * O conserto pôs a classe nos helpers de src/errors.ts (`erroContrato`,
 * `erroNaoEncontrado`, `erroFonte`, `erroDefeito`, `erroComClasse`,
 * `erroDoCatch`, `erroDaExcecao`). Esta guarda impede o literal de voltar:
 * `isError: true` escrito à mão em código de produção reprova.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = join(__dirname, "..", "src");

/**
 * Os ÚNICOS arquivos onde o literal pode aparecer, e por quê.
 */
const PERMITIDOS: Record<string, string> = {
  // Os helpers que montam o resultado de erro COM a classe.
  "errors.ts": "helpers de erro com classe (erroContrato & cia.)",
  // `toMcpResult` monta o resultado do FIO a partir de um StructuredToolResult
  // que já traz a classe, e a copia como propriedade não enumerável.
  "structured.ts": "toMcpResult converte o resultado (já com classe) para o fio",
};

function arquivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosTs(caminho);
    return caminho.endsWith(".ts") && !caminho.endsWith(".test.ts") ? [caminho] : [];
  });
}

/** Linhas de CÓDIGO com o literal (comentário não conta: documenta, não monta). */
function ocorrencias(caminho: string): number[] {
  return readFileSync(caminho, "utf8")
    .split("\n")
    .flatMap((linha, i) => {
      const t = linha.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return [];
      return /\bisError\s*[:=]\s*true\b/.test(linha) ? [i + 1] : [];
    });
}

describe("nenhum `isError: true` literal fora dos helpers com classe", () => {
  it("src/ (fora de errors.ts e structured.ts) não monta resultado de erro à mão", () => {
    const violacoes = arquivosTs(SRC)
      .map((c) => ({ rel: relative(SRC, c).split(sep).join("/"), linhas: ocorrencias(c) }))
      .filter(({ rel, linhas }) => linhas.length > 0 && !(rel in PERMITIDOS))
      .map(({ rel, linhas }) => `src/${rel}:${linhas.join(",")}`);
    expect(
      violacoes,
      "use erroContrato/erroNaoEncontrado/erroFonte/erroDefeito/erroComClasse/" +
        "erroDoCatch/erroDaExcecao de src/errors.ts — a classe é obrigatória"
    ).toEqual([]);
  });

  it("a guarda enxerga o literal (não passa por estar cega)", () => {
    expect(ocorrencias(join(SRC, "structured.ts")).length).toBeGreaterThan(0);
    expect(ocorrencias(join(SRC, "errors.ts")).length).toBeGreaterThan(0);
  });
});
