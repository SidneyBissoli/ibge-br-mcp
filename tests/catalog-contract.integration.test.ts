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
 * Roda apenas com INTEGRATION_TESTS=1 (rede real; ver
 * .github/workflows/integration.yml — cron semanal + dispatch manual).
 */
import { describe, expect, it } from "vitest";
import { SIDRA_TABLES } from "../src/config.js";
import { INDICADORES_SAUDE } from "../src/tools/datasaude.js";
import { INDICADORES_CONHECIDOS } from "../src/tools/indicadores.js";
import { TEMPLATES_COMPARACAO } from "../src/tools/comparar.js";
import { TABELAS_COMUNS } from "../src/tools/sidra.js";

const LIVE = process.env.INTEGRATION_TESTS === "1" || process.env.INTEGRATION_TESTS === "true";

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
 * Orçamento por requisição. Era 45 s, dentro de um prazo de teste de 180 s —
 * três tentativas somavam 147 s por código, e com 33 códigos um runner que
 * não alcança o IBGE levava ~81 min para dizer isso. A API responde em ~250 ms
 * quando responde; 20 s é oitenta vezes isso, folga de sobra para lentidão
 * real sem transformar silêncio em hora de runner.
 */
const ORCAMENTO_REQUISICAO_MS = 20_000;
const ESPERA_BASE_MS = 1000;

/** O IBGE nunca respondeu: DNS, TCP, TLS, abort. Diferente de um status HTTP. */
class FalhaDeTransporte extends Error {
  constructor(causa: unknown) {
    super(String(causa));
    this.name = "FalhaDeTransporte";
  }
}

/**
 * Disjuntor. Medido em 12/09/2026: a fonte descarta pacotes de alguns
 * endereços de origem, e o runner que cai num deles não fala com ela o job
 * inteiro. Aconteceu aqui: a rodada das 09:52 UTC travou e foi cortada pelo
 * teto de 15 min; a re-rodada 17 min depois, mesmo código e mesmo alvo, passou
 * em 70 s — só mudou o runner. Sem disjuntor, cada um dos 33 códigos paga o
 * orçamento inteiro para descobrir a mesma coisa.
 *
 * Só arma enquanto NADA foi lido: depois que o IBGE respondeu uma vez ele está
 * alcançável, e uma falha posterior é daquele código, não da conexão.
 */
const LIMITE_TRANSPORTE = 3;
let leiturasOk = 0;
let sequenciaTransporte = 0;

function disjuntorAberto(): boolean {
  return leiturasOk === 0 && sequenciaTransporte >= LIMITE_TRANSPORTE;
}

async function tableName(code: string): Promise<string> {
  const url = `https://servicodados.ibge.gov.br/api/v3/agregados/${code}/metadados`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(ORCAMENTO_REQUISICAO_MS) });
      } catch (err) {
        throw new FalhaDeTransporte(err);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const meta = (await res.json()) as { nome?: string };
      if (!meta.nome) throw new Error("metadados sem campo nome");
      leiturasOk++;
      sequenciaTransporte = 0;
      return meta.nome;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, ESPERA_BASE_MS * (attempt + 1)));
    }
  }
  if (lastErr instanceof FalhaDeTransporte) {
    sequenciaTransporte++;
  } else {
    // Uma resposta CHEGOU e foi recusada: a conexão está de pé.
    sequenciaTransporte = 0;
  }
  throw new Error(`tabela ${code}: falha ao consultar metadados — ${String(lastErr)}`);
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
    it(`tabela ${code} é o que o catálogo promete [${where}]`, async () => {
      if (disjuntorAberto()) {
        throw new Error(
          `IBGE inalcançável deste runner: ${sequenciaTransporte} códigos seguidos ` +
            `sem nenhuma resposta e nenhuma leitura bem-sucedida. O contrato do ` +
            `catálogo NÃO foi medido — isto não diz nada sobre o código ${code}. ` +
            `Re-rodar cai num runner novo, com outro endereço de origem.`
        );
      }
      const nome = await tableName(code);
      const expected = EXPECTED[code];
      if (!expected) return; // já reportado no teste de completude
      expect(
        expected.test(normalize(nome)),
        `tabela ${code} na API é "${nome}" — não bate com a expectativa ${expected} declarada para: ${where}`
      ).toBe(true);
      // Prazo por teste: 3 tentativas de 20 s mais 1 s + 2 s de espera = 63 s
      // no pior caso. Era 180 s, herdado de um orçamento de 45 s por
      // requisição que já não existe.
    }, 90_000);
  }
});
