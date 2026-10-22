/**
 * Contrato do catálogo SIDRA — valida, contra a API REAL de agregados, que
 * cada código de tabela declarado nos catálogos do servidor aponta para a
 * tabela que o rótulo promete.
 *
 * Por que existe: em 2026-08 o monitor do portfólio descobriu que vários
 * códigos estavam errados DESDE O COMMIT INICIAL (ex.: AREA_TERRITORIAL
 * apontava para a tabela do IPCA-15; "Mortalidade Infantil" devolvia
 * população residente; "Óbitos por Causas" devolvia produção agrícola).
 * O erro é semanticamente invisível — a API responde 200 com dados válidos,
 * só que de outra coisa — então nenhum teste offline o pega. Este teste é a
 * segunda declaração independente do significado de cada código: o catálogo
 * diz o que a tabela DEVERIA ser; a API diz o que ela É; os dois têm de
 * concordar.
 *
 * Regras de manutenção:
 *  - todo código novo em qualquer catálogo EXIGE uma entrada em EXPECTED
 *    (o teste falha listando códigos sem expectativa);
 *  - a expectativa descreve o RÓTULO (a intenção), nunca copia o nome real
 *    da tabela — senão o teste deixa de ser uma verificação independente.
 *
 * Fonte fora ≠ deriva: cada caso roda em `aoVivo` (ver integration-fetch.ts).
 * O disjuntor de 12/09/2026 (a fonte descarta pacotes de alguns endereços de
 * origem; a rodada das 09:52 UTC travou até o teto de 15 min e a re-rodada 17
 * min depois passou em 70 s — só mudou o runner) é o do pacote: 3 códigos
 * seguidos sem resposta e nenhuma leitura, e os demais pulam sem pagar o
 * orçamento, anotados `Fonte inalcançável`.
 *
 * Roda apenas com INTEGRATION_TESTS=1 (rede real; ver
 * .github/workflows/integration.yml — cron semanal + dispatch manual).
 */
import { describe, expect, it } from "vitest";
import { suiteAoVivo } from "@sbissoli/mcp-live-source/vitest";
import { SIDRA_TABLES } from "../src/config.js";
import { INDICADORES_SAUDE } from "../src/tools/datasaude.js";
import { INDICADORES_CONHECIDOS, ibgeIndicadores } from "../src/tools/indicadores.js";
import { TEMPLATES_COMPARACAO } from "../src/tools/comparar.js";
import { TABELAS_COMUNS } from "../src/tools/sidra.js";
import { CASO_FERRAMENTA, fetchIntegracao, semErro, SUITE_AO_VIVO, TIMEOUT_CASO_MS } from "./integration-fetch.js";

const LIVE = process.env.INTEGRATION_TESTS === "1" || process.env.INTEGRATION_TESTS === "true";
const { aoVivo } = suiteAoVivo(SUITE_AO_VIVO);

/** Expectativa semântica por código: regex sobre o nome real (minúsculo, sem acento). */
const EXPECTED: Record<string, RegExp> = {
  // população e território
  "6579": /populacao residente estimada/,
  "9514": /populacao residente, por sexo, idade/,
  "200": /populacao residente, por sexo, situacao e grupos de idade/,
  "793": /populacao residente/,
  "4714": /populacao residente, area territorial e densidade/i,
  "7358": /populacao, por sexo e idade/,
  // economia
  "1846": /valores a precos correntes/,
  "6784": /produto interno bruto.*per capita/,
  "5938": /produto interno bruto a precos correntes/,
  "5932": /taxa de variacao do indice de volume trimestral/,
  "8888": /producao fisica industrial/,
  "8880": /comercio varejista/,
  "8688": /volume de servicos/,
  // preços
  "7060": /ipca - variacao mensal/,
  "1737": /ipca - serie historica/,
  "7063": /inpc - variacao mensal/,
  // trabalho e renda (PNAD Contínua)
  "4099": /taxas? de desocupacao/,
  "5436": /rendimento medio mensal real das pessoas de 14 anos/,
  "6387": /rendimento medio mensal real e nominal das pessoas de 14 anos/,
  "4093": /pessoas de 14 anos ou mais de idade, total, na forca de trabalho/,
  "4708": /taxa de informalidade/,
  // educação, domicílios, agropecuária
  "9543": /taxa de alfabetizacao/,
  "4711": /domicilios recenseados/,
  "5457": /area plantada ou destinada a colheita/,
  "3939": /efetivo dos rebanhos/,
  // saúde e saneamento
  "7362": /esperanca de vida ao nascer e taxa de mortalidade infantil/,
  "2612": /nascidos vivos/,
  "2681": /obitos, ocorridos no ano/,
  "3727": /taxa de fecundidade total/,
  "1395": /domicilios particulares permanentes.*banheiro/,
  "6805": /domicilios particulares permanentes ocupados, por tipo de esgotamento sanitario/,
  "4938": /pessoas que tinham algum plano de saude/,
  "4751": /autoavaliacao de saude boa ou muito boa/,
};

interface Declared {
  code: string;
  origin: string;
  label: string;
}

function declaredCodes(): Declared[] {
  const out: Declared[] = [];
  for (const [k, v] of Object.entries(SIDRA_TABLES)) {
    out.push({ code: v, origin: "config.SIDRA_TABLES", label: k });
  }
  for (const [k, v] of Object.entries(INDICADORES_SAUDE)) {
    out.push({ code: v.tabela, origin: "datasaude.INDICADORES_SAUDE", label: `${k} (${v.nome})` });
  }
  for (const [k, v] of Object.entries(INDICADORES_CONHECIDOS)) {
    out.push({ code: v.tabela, origin: "indicadores.INDICADORES_CONHECIDOS", label: `${k} (${v.nome})` });
  }
  for (const [k, v] of Object.entries(TEMPLATES_COMPARACAO)) {
    out.push({ code: v.tabela, origin: "comparar.TEMPLATES_COMPARACAO", label: `${k} (${v.nome})` });
  }
  for (const [k, v] of Object.entries(TABELAS_COMUNS)) {
    out.push({ code: k, origin: "sidra.TABELAS_COMUNS", label: v });
  }
  return out;
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * O nome da tabela segundo a API. Fonte fora sobe como erro do pacote (o
 * `aoVivo` decide); resposta recusada (4xx) é o que a fonte DISSE do código,
 * e reprova pela asserção.
 */
async function tableName(code: string): Promise<string> {
  const url = `https://servicodados.ibge.gov.br/api/v3/agregados/${code}/metadados`;
  const res = await fetchIntegracao(url);
  expect(res.ok, `tabela ${code}: metadados responderam HTTP ${res.status}`).toBe(true);
  const meta = (await res.json()) as { nome?: string };
  expect(meta.nome, `tabela ${code}: metadados sem campo nome`).toBeTruthy();
  return meta.nome as string;
}

describe.runIf(LIVE)("contrato do catálogo SIDRA (API real)", () => {
  const declared = declaredCodes();
  const codes = [...new Set(declared.map((d) => d.code))].sort((a, b) => Number(a) - Number(b));

  it("todo código declarado tem expectativa semântica", () => {
    const missing = codes.filter((c) => !(c in EXPECTED));
    expect(
      missing,
      `códigos sem entrada em EXPECTED (adicione a expectativa ao introduzir o código): ${missing.join(", ")}`
    ).toEqual([]);
  });

  for (const code of codes) {
    const users = declared.filter((d) => d.code === code);
    const where = users.map((u) => `${u.origin}:${u.label}`).join("; ");
    aoVivo(
      `tabela ${code} é o que o catálogo promete [${where}]`,
      async () => {
        const nome = await tableName(code);
        const expected = EXPECTED[code];
        if (!expected) return; // já reportado no teste de completude
        expect(
          expected.test(normalize(nome)),
          `tabela ${code} na API é "${nome}" — não bate com a expectativa ${expected} declarada para: ${where}`
        ).toBe(true);
      },
      { endpoint: `agregados-${code}-metadados`, timeout: TIMEOUT_CASO_MS }
    );
  }
});

/**
 * Variável de cada indicador nomeado. O contrato acima confere a TABELA por
 * código, e por isso não via o erro que importava: até a 5.7.0 a 5938 passava
 * ("PIB a preços correntes" bate com a tabela) enquanto `pib_per_capita` a
 * vendia como per capita, e nove indicadores pediam `allxp` — o "IPCA mensal"
 * vinha com acumulado no ano, em 12 meses e o peso. Aqui a expectativa é por
 * INDICADOR e descreve o que o NOME dele promete, nunca copia o rótulo da
 * fonte; a variável fixada tem de existir na tabela e casar com ela.
 */
const EXPECTED_VARIAVEL: Record<string, RegExp> = {
  pib: /^valores a precos correntes$/,
  pib_variacao: /^taxa trimestral \(em relacao ao mesmo periodo do ano anterior\)$/,
  pib_per_capita: /^pib per capita - valores correntes$/,
  industria: /numero-indice \(2022=100\)$/,
  comercio: /numero-indice \(2022=100\)$/,
  servicos: /numero-indice \(2022=100\)$/,
  ipca: /^ipca - variacao mensal$/,
  ipca_acumulado: /^ipca - variacao acumulada em 12 meses$/,
  inpc: /^inpc - variacao mensal$/,
  desemprego: /^taxa de desocupacao/,
  ocupacao: /^pessoas de 14 anos ou mais de idade ocupadas/,
  rendimento: /^rendimento medio mensal real/,
  informalidade: /^taxa de informalidade/,
  populacao: /^populacao residente estimada$/,
  densidade: /densidade demografica/,
  agricultura: /^valor da producao$/,
  pecuaria: /^efetivo dos rebanhos$/,
};

describe.runIf(LIVE)("variável de cada indicador nomeado (API real)", () => {
  it("todo indicador tem expectativa de variável", () => {
    const missing = Object.keys(INDICADORES_CONHECIDOS).filter((k) => !(k in EXPECTED_VARIAVEL));
    expect(missing, `indicadores sem entrada em EXPECTED_VARIAVEL: ${missing.join(", ")}`).toEqual([]);
  });

  for (const [chave, ind] of Object.entries(INDICADORES_CONHECIDOS)) {
    aoVivo(
      `${chave}: tabela ${ind.tabela}, variável ${ind.variavel}`,
      async () => {
        const res = await fetchIntegracao(
          `https://servicodados.ibge.gov.br/api/v3/agregados/${ind.tabela}/metadados`
        );
        expect(res.ok, `metadados da tabela ${ind.tabela}: HTTP ${res.status}`).toBe(true);
        const meta = (await res.json()) as { variaveis?: Array<{ id: number; nome: string }> };
        const v = meta.variaveis?.find((x) => String(x.id) === ind.variavel);
        expect(v, `variável ${ind.variavel} não existe na tabela ${ind.tabela}`).toBeDefined();
        const esperado = EXPECTED_VARIAVEL[chave];
        if (!esperado) return; // já reportado na completude
        expect(
          esperado.test(normalize(v!.nome)),
          `${chave}: a variável ${ind.variavel} é "${v!.nome}" — não bate com ${esperado}`
        ).toBe(true);
      },
      { endpoint: `indicador-${chave}-variavel`, timeout: TIMEOUT_CASO_MS }
    );
  }

  // Prova ATIVA: a tool, chamada como um cliente chamaria, devolve número. Os
  // metadados não pegam o defeito que mais custou: `comercio`, `servicos` e
  // `pib_variacao` tinham tabela e variável certas e respondiam só ".." — a
  // classificação sem categoria cai na categoria 0, que não existe.
  for (const chave of Object.keys(INDICADORES_CONHECIDOS)) {
    aoVivo(
      `${chave}: a tool devolve ao menos um valor numérico nos últimos períodos`,
      async () => {
        const r = await ibgeIndicadores({ indicador: chave, periodos: "last 4", formato: "json" });
        semErro(r);
        const registros = (r.structured as { registros?: Array<Record<string, string>> } | undefined)?.registros ?? [];
        const numericos = registros.filter((x) => /^-?\d+(\.\d+)?$/.test(x["Valor"] ?? ""));
        expect(
          numericos.length,
          `${chave}: ${registros.length} registros e nenhum valor — ${registros.map((x) => x["Valor"]).join(",")}`
        ).toBeGreaterThan(0);
      },
      { endpoint: `indicador-${chave}-tool`, ...CASO_FERRAMENTA }
    );
  }
});
