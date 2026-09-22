/**
 * O vocabulário da pergunta contra o vocabulário da CNAE.
 *
 * `ibge_cnae(busca="software")` devolvia UM resultado, e era o errado
 * (`1830003 REPRODUÇÃO DE SOFTWARE EM QUALQUER SUPORTE` — prensar mídia): as
 * três subclasses de desenvolvimento existem, e a CNAE as escreve "PROGRAMAS
 * DE COMPUTADOR". Não dava erro; devolvia resposta plausível. E antes disso
 * havia o ACENTO: o filtro fazia `descricao.toLowerCase().includes(termo)`, que
 * resolve caixa e não resolve acento, contra descrições em CAIXA ALTA COM
 * acento — "comercio" achava 2 de 211.
 *
 * As contagens abaixo são LITERAIS da medição de 2026-09-22
 * (`scripts/medicoes/`), não recálculo com a função sob teste: a guarda que
 * reusa o padrão do defeito cala junto com ele. O que roda contra elas é o
 * catálogo REAL da CNAE, versionado em `tests/fixtures/cnae-catalogo.json`
 * (cópia dos cinco níveis da API v2) — então o teste não fica refém do portal
 * externo nem prova a tabela contra si mesma.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ibgeCnae } from "../src/tools/cnae.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";
import {
  VOCABULARIO,
  VOCABULARIO_CNAE,
  casaBuscaCnae,
  expandirBuscaCnae,
  normalizar,
  notasDeVocabularioCnae,
} from "../src/vocabulario.js";

interface Atividade {
  id: string;
  descricao: string;
}
type Nivel = "secoes" | "divisoes" | "grupos" | "classes" | "subclasses";

const CATALOGO: Record<Nivel, Atividade[]> = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures", "cnae-catalogo.json"),
    "utf8"
  )
);
const SUBCLASSES = CATALOGO.subclasses;

/** O filtro NOVO: normaliza os dois lados, AND por palavra, OR das grafias da CNAE. */
const busca = (termo: string, nivel: Nivel = "subclasses"): Atividade[] => {
  const expandidos = expandirBuscaCnae(termo);
  return CATALOGO[nivel].filter((a) => casaBuscaCnae(normalizar(a.descricao), expandidos));
};

/**
 * O filtro ANTIGO, transcrito da 5.1.2 — é o `antes` das tabelas. Escrito à
 * mão de propósito: comparar o conserto com ele mesmo não provaria nada.
 */
const buscaAntiga = (termo: string, nivel: Nivel = "subclasses"): Atividade[] =>
  CATALOGO[nivel].filter((a) => a.descricao.toLowerCase().includes(termo.toLowerCase()));

describe("o catálogo de fixture é o da CNAE", () => {
  // Se a CNAE mudar, estes números mudam junto com a fixture — e aí as
  // contagens de baixo têm de ser REMEDIDAS, não ajustadas no olho.
  it.each([
    ["secoes", 21],
    ["divisoes", 87],
    ["grupos", 285],
    ["classes", 673],
    ["subclasses", 1332],
  ] as const)("%s: %i registros", (nivel, total) => {
    expect(CATALOGO[nivel]).toHaveLength(total);
  });

  it("as descrições vêm em CAIXA ALTA COM acento — a causa do defeito do acento", () => {
    const comAcento = SUBCLASSES.filter((a) => /[ÁÂÃÀÉÊÍÓÔÕÚÇ]/.test(a.descricao));
    expect(comAcento.length).toBeGreaterThan(800);
    expect(SUBCLASSES.find((a) => a.id === "4520001")?.descricao).toBe(
      "SERVIÇOS DE MANUTENÇÃO E REPARAÇÃO MECÂNICA DE VEÍCULOS AUTOMOTORES"
    );
  });
});

describe("o defeito relatado: busca=software", () => {
  it("antes devolvia 1, e era REPRODUÇÃO DE SOFTWARE — prensar mídia", () => {
    const antes = buscaAntiga("software");
    expect(antes.map((a) => a.id)).toEqual(["1830003"]);
    expect(antes[0].descricao).toBe("REPRODUÇÃO DE SOFTWARE EM QUALQUER SUPORTE");
  });

  it("agora devolve as três de desenvolvimento, e não perde a que já vinha", () => {
    expect(busca("software").map((a) => a.id).sort()).toEqual([
      "1830003",
      "6201501",
      "6202300",
      "6203100",
    ]);
  });

  it("e diz que traduziu", () => {
    expect(notasDeVocabularioCnae(expandirBuscaCnae("software"))).toEqual([
      '"software" também foi buscado como programas de computador — a palavra que a CNAE usa.',
    ]);
  });
});

describe("ACENTO: o que o filtro antigo não achava", () => {
  // Medido nas 1.332 subclasses em 2026-09-22. `servicos` passa do número cru
  // porque a mecânica também casa o singular (SERVIÇO).
  //
  // A coluna "agora" foi REMEDIDA com `@sbissoli/mcp-search` 0.6.0, que passou a
  // exigir que o padrão comece uma palavra. Os que encolheram só perderam
  // casamento de MIOLO, e o caso mais caro é `moveis`: caía em AUTOMÓVEIS, então
  // quem perguntava por móveis recebia carros (30 → 17). Também saíram
  // PREPARAÇÃO para `reparacao` (58 → 49), REPRODUÇÃO para `producao` (49 → 44)
  // e COLOCAÇÃO para `locacao` (10 → 9).
  it.each([
    ["comercio", 2, 211],
    ["servicos", 0, 109],
    ["reparacao", 0, 49],
    ["manutencao", 0, 51],
    ["maquinas", 0, 51],
    ["producao", 0, 44],
    ["veiculos", 0, 42],
    ["construcao", 0, 35],
    ["agua", 2, 30],
    ["moveis", 0, 17],
    ["eletrico", 0, 16],
    ["gestao", 0, 12],
    ["alimenticio", 0, 11],
    ["calcados", 0, 11],
    ["saude", 0, 10],
    ["locacao", 0, 9],
    ["educacao", 0, 9],
    ["informatica", 0, 8],
  ])("%s: %i → %i", (termo, antes, agora) => {
    expect(buscaAntiga(termo)).toHaveLength(antes);
    expect(busca(termo)).toHaveLength(agora);
  });

  it("acento não é tradução — não gera nota de vocabulário", () => {
    expect(notasDeVocabularioCnae(expandirBuscaCnae("comercio"))).toEqual([]);
  });
});

describe("VOCABULÁRIO: os 29 pares medidos", () => {
  it.each([
    ["app", 0, 3],
    ["aplicativo", 0, 3],
    ["site", 0, 4],
    ["farmacia", 0, 3],
    ["drogaria", 0, 3],
    ["dentista", 0, 5],
    ["consultorio", 0, 4],
    ["advogado", 0, 1],
    ["advocacia", 0, 1],
    ["contador", 0, 2],
    ["hotel", 0, 2],
    ["motel", 0, 1],
    ["pousada", 0, 4],
    ["academia", 0, 1],
    ["salao", 0, 1],
    ["barbearia", 0, 1],
    ["caminhao", 0, 2],
    ["frete", 0, 2],
    ["delivery", 0, 1],
    ["pizzaria", 0, 2],
    ["petshop", 0, 2],
    ["teatro", 0, 3],
    ["jardinagem", 0, 1],
    ["reciclagem", 0, 9],
    ["lixo", 0, 8],
    ["faculdade", 0, 3],
    ["universidade", 0, 3],
    ["propaganda", 0, 5],
  ])("%s: %i → %i", (termo, antes, agora) => {
    expect(buscaAntiga(termo)).toHaveLength(antes);
    expect(busca(termo)).toHaveLength(agora);
  });

  it("cada par acerta a atividade certa, e não só uma contagem", () => {
    expect(busca("farmacia").map((a) => a.id).sort()).toEqual(["4771701", "4771702", "4771703"]);
    expect(busca("academia")[0].descricao).toBe("ATIVIDADES DE CONDICIONAMENTO FÍSICO");
    expect(busca("advogado")[0].descricao).toBe("SERVIÇOS ADVOCATÍCIOS");
    expect(busca("jardinagem")[0].descricao).toBe("ATIVIDADES PAISAGÍSTICAS");
    expect(busca("salao")[0].descricao).toBe("CABELEIREIROS, MANICURE E PEDICURE");
  });

  it("a tradução é DITA em todos eles — resultado sem nota parece vir da palavra do usuário", () => {
    for (const e of VOCABULARIO_CNAE) {
      expect(
        notasDeVocabularioCnae(expandirBuscaCnae(e.perguntado)),
        `sem nota: ${e.perguntado}`
      ).toHaveLength(1);
    }
  });

  it("nenhum par REMOVE resultado em nível nenhum: o lado perguntado já era 0", () => {
    // A tabela foi medida contra subclasses; isto prova que ela não estraga os
    // outros quatro níveis, que é o que a tool aceita em `nivel`.
    for (const nivel of ["secoes", "divisoes", "grupos", "classes", "subclasses"] as const) {
      for (const e of VOCABULARIO_CNAE) {
        expect(
          busca(e.perguntado, nivel).length,
          `${e.perguntado} encolheu em ${nivel}`
        ).toBeGreaterThanOrEqual(buscaAntiga(e.perguntado, nivel).length);
      }
    }
  });
});

describe("as duas tabelas são separadas, e é por medição", () => {
  it("os pares do SIDRA NÃO valem na CNAE: seriam falso positivo por substring", () => {
    // `etaria → idade` casaria 126 subclasses, e são "ATIVIDADE..."; `negro →
    // preta` casaria "INTERPRETAÇÃO"; `emprego → ocupa`, "TERAPIA OCUPACIONAL".
    // Se a tabela do SIDRA vazar para cá, estes números explodem.
    // Desde a 0.6.0 da mecânica é ZERO: o único que restava era
    // "INTERMEDIAÇÃO NÃO MONETÁRIA" (mon-ETÁRIA), casamento de miolo.
    expect(busca("etaria")).toHaveLength(0);
    expect(busca("negro")).toHaveLength(0);
    expect(busca("emprego")).toHaveLength(0);
  });

  it("os dois catálogos não compartilham tabela", () => {
    const naCnae = new Set(VOCABULARIO_CNAE.map((e) => e.perguntado));
    const noSidra = new Map(VOCABULARIO.map((e) => [e.perguntado, e.fonte.join("|")]));
    for (const e of VOCABULARIO_CNAE) {
      const mesmoTermoNoSidra = noSidra.get(e.perguntado);
      if (mesmoTermoNoSidra === undefined) continue;
      // "faculdade"/"universidade" existem nos dois, com grafias de fonte
      // DIFERENTES (ensino superior vs educação superior) — cada catálogo
      // escreve do seu jeito, e é por isso que a tabela não pode ser uma só.
      expect(e.fonte.join("|"), `${e.perguntado} igual nos dois`).not.toBe(mesmoTermoNoSidra);
    }
    expect(naCnae.has("faculdade") && noSidra.has("faculdade")).toBe(true);
  });

  it("nenhum par da CNAE entrou na tabela do SIDRA por descuido", () => {
    for (const e of VOCABULARIO_CNAE) {
      const gemeo = VOCABULARIO.find((s) => s.perguntado === e.perguntado);
      if (!gemeo) continue;
      expect(["faculdade", "universidade"]).toContain(e.perguntado);
    }
  });
});

describe("o que ficou de FORA, e por quê", () => {
  it("oficina não entrou: as grafias plausíveis dão par largo demais", () => {
    expect(VOCABULARIO_CNAE.find((e) => e.perguntado === "oficina")).toBeUndefined();
    // O que teria entrado: OR de "manutenção e reparação" com "veículos
    // automotores" casa 63 subclasses, incluindo fabricação de peças e o
    // comércio de combustíveis — resposta plausível e errada, o mesmo pecado.
    const or = SUBCLASSES.filter(
      (a) =>
        normalizar(a.descricao).includes("manutencao e reparacao") ||
        normalizar(a.descricao).includes("veiculos automotores")
    );
    expect(or).toHaveLength(63);
    expect(or.some((a) => a.id === "4731800")).toBe(true); // combustíveis, que não é oficina
  });

  it("termo que a CNAE 2.0 não publica não vira par — nem do lado da fonte", () => {
    for (const inexistente of ["startup", "coworking", "influencer", "streaming"]) {
      expect(busca(inexistente), inexistente).toHaveLength(0);
      expect(VOCABULARIO_CNAE.find((e) => e.perguntado === inexistente)).toBeUndefined();
    }
  });

  it("a palavra de todo dia que JÁ casa não ganhou par", () => {
    for (const [termo, n] of [
      ["loja", 8],
      ["mercado", 14],
      ["bar", 12],
      ["banco", 12],
    ] as const) {
      expect(buscaAntiga(termo), termo).toHaveLength(n);
      expect(VOCABULARIO_CNAE.find((e) => e.perguntado === termo)).toBeUndefined();
    }
  });
});

describe("a substring sem fronteira de palavra — CONSERTADA na 0.6.0 da mecânica", () => {
  // Esta seção nasceu documentando a dívida: `uber` casava 1 subclasse por
  // estar dentro de TUBÉRCULOS, e o conserto era na lib, não numa tabela.
  // `@sbissoli/mcp-search` 0.6.0 passou a exigir que o padrão COMECE uma
  // palavra; os casos viraram a prova de que chegou aqui.
  it("uber não casa mais dentro de TUBÉRCULOS", () => {
    expect(busca("uber")).toHaveLength(0);
    expect(SUBCLASSES.some((a) => a.descricao.includes("TUBÉRCULOS"))).toBe(true);
  });

  it("moveis deixa de trazer AUTOMÓVEIS — quem pede móveis não quer carro", () => {
    const hits = busca("moveis");
    expect(hits).toHaveLength(17);
    expect(hits.some((a) => a.descricao.includes("AUTOMÓVEIS"))).toBe(false);
    expect(hits.some((a) => a.descricao.includes("MÓVEIS"))).toBe(true);
  });

  it("e o prefixo de palavra continua valendo — é o que faz o radical funcionar", () => {
    // "reparacao" ainda alcança REPARAÇÃO; o que saiu foi PREPARAÇÃO.
    const hits = busca("reparacao");
    expect(hits).toHaveLength(49);
    expect(hits.some((a) => a.descricao.includes("PREPARAÇÃO"))).toBe(false);
    expect(busca("dentista").map((a) => a.descricao)).toContain("ATIVIDADE ODONTOLÓGICA");
  });
});

describe("várias palavras casam em E", () => {
  it.each([
    ["comercio varejista", 2, 69],
    ["comercio varejista de combustiveis", 0, 1],
    ["farmacia de manipulacao", 0, 2],
  ])("%s: %i → %i", (termo, antes, agora) => {
    expect(buscaAntiga(termo)).toHaveLength(antes);
    expect(busca(termo)).toHaveLength(agora);
  });

  it("'de' não mata a busca — stopword fica fora do E", () => {
    expect(busca("comercio varejista de combustiveis")[0].id).toBe("4731800");
  });
});

describe("a tool devolve a nota e a contagem verdadeira", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    cache.clear();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("busca traduzida: nota no markdown e em notas_vocabulario", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(SUBCLASSES));
    const r = await ibgeCnae({ busca: "farmacia", limite: 20 });

    expect(r.isError).toBeFalsy();
    expect(r.markdown).toContain("produtos farmaceuticos");
    const busca = (r.structured as { busca: { notas_vocabulario?: string[]; total: number } }).busca;
    expect(busca.notas_vocabulario).toHaveLength(1);
    expect(busca.total).toBe(3);
  });

  it("termo sem tradução não inventa nota", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(SUBCLASSES));
    const r = await ibgeCnae({ busca: "comercio varejista de combustiveis", limite: 20 });

    const busca = (r.structured as { busca: { notas_vocabulario?: string[] } }).busca;
    expect(busca.notas_vocabulario).toBeUndefined();
  });

  it("`encontrados` diz quantas casam de verdade; `total` é o que coube no limite", async () => {
    // Sem isto a resposta diria "20 resultados" para as 211 de "comercio" — o
    // número truncado apresentado como se fosse o total é resposta plausível e errada.
    mockFetch.mockResolvedValueOnce(mockResponse(SUBCLASSES));
    const r = await ibgeCnae({ busca: "comercio", limite: 20 });

    const busca = (r.structured as { busca: { total: number; encontrados: number } }).busca;
    expect(busca.total).toBe(20);
    expect(busca.encontrados).toBe(211);
    expect(r.markdown).toContain("Encontradas 211 atividades");
  });

  it("zero ensina a palavra da CNAE em vez de só dizer não", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(SUBCLASSES));
    const r = await ibgeCnae({ busca: "coworking", limite: 20 });

    expect(r.isError).toBe(true);
    expect(r.markdown).toContain("programas de computador");
    expect(r.markdown).toContain("4520"); // a dica do `oficina`, que ficou fora da tabela
  });
});
