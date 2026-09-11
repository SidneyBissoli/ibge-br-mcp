/**
 * Contrato dos recortes temáticos contra o WFS REAL do IBGE Geosserviços.
 *
 * Por que existe. `ibge_malhas_tema` anunciava sete temas e não entregava
 * nenhum: pedia caminhos (`/malhas/biomas`, `/malhas/semiarido`…) que a API de
 * malhas nunca teve, e respondia 404 desde o commit inicial. Os testes offline
 * eram verdes porque mockavam `fetch` e conferiam a URL que eles mesmos
 * esperavam. Camada de WFS é a mesma classe de hipótese: o nome só vale
 * enquanto o IBGE o publicar.
 *
 * O que este arquivo afirma, e que nenhum mock pode afirmar:
 *  - cada camada pinada ainda existe e responde;
 *  - cada campo declarado em `campos` é campo DE VERDADE — é ele que vai no
 *    `propertyName`, e um nome errado ali faz o GeoServer recusar a requisição
 *    inteira (ou, pior, devolver a camada sem o atributo que a resposta usa);
 *  - o filtro CQL que separa RM de RIDE ainda separa;
 *  - o recorte não ficou vazio.
 *
 * As contagens NÃO são pinadas: município entra e sai de faixa de fronteira, e
 * um teste que exige 590 reprova no dia em que o IBGE publicar 591. O que se
 * exige é o que caracteriza o recorte (há feições; os campos existem; o filtro
 * filtra).
 *
 * Roda apenas com INTEGRATION_TESTS=1 (rede real; ver
 * .github/workflows/integration.yml — cron semanal + dispatch manual).
 */
import { describe, expect, it } from "vitest";
import { ibgeMalhasTema, RECORTES, TEMAS } from "../src/tools/malhas-tema.js";
import { IBGE_API } from "../src/types.js";

const LIVE = process.env.INTEGRATION_TESTS === "1" || process.env.INTEGRATION_TESTS === "true";

interface Resposta {
  numberMatched?: number;
  features?: Array<{ properties?: Record<string, unknown> | null }>;
}

async function consulta(camada: string, campos: readonly string[], filtro?: string, count = 5) {
  const url = new URL(IBGE_API.GEOSERVICOS);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typeNames", camada);
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("propertyName", campos.join(","));
  url.searchParams.set("count", String(count));
  if (filtro) url.searchParams.set("CQL_FILTER", filtro);

  const resposta = await fetch(url);
  expect(resposta.status, `${camada} em ${url}`).toBe(200);
  const corpo = (await resposta.json()) as Resposta;
  return corpo;
}

describe.skipIf(!LIVE)("contrato dos recortes temáticos no WFS do IBGE", () => {
  it("todo tema do esquema tem recorte declarado", () => {
    expect(Object.keys(RECORTES).sort()).toEqual([...TEMAS].sort());
  });

  for (const tema of TEMAS) {
    const r = RECORTES[tema];

    it(`${tema}: a camada existe, responde e traz feições`, async () => {
      const corpo = await consulta(r.camada, r.campos, r.filtro);
      expect(corpo.numberMatched ?? 0, `${tema}: recorte vazio`).toBeGreaterThan(0);
      expect(corpo.features?.length ?? 0).toBeGreaterThan(0);
    }, 60000);

    it(`${tema}: todo campo declarado existe na camada`, async () => {
      const corpo = await consulta(r.camada, r.campos, r.filtro);
      const props = corpo.features?.[0]?.properties ?? {};
      for (const campo of r.campos) {
        expect(Object.keys(props), `${tema}: campo "${campo}" sumiu da camada`).toContain(campo);
      }
    }, 60000);
  }

  it("o filtro CQL ainda separa região metropolitana de RIDE", async () => {
    const rm = await consulta(
      RECORTES.metropolitana.camada,
      RECORTES.metropolitana.campos,
      RECORTES.metropolitana.filtro
    );
    const ride = await consulta(
      RECORTES.ride.camada,
      RECORTES.ride.campos,
      RECORTES.ride.filtro
    );
    expect(rm.features?.every((f) => f.properties?.FIRST_TIPO === "RM")).toBe(true);
    expect(ride.features?.every((f) => f.properties?.FIRST_TIPO === "RIDE")).toBe(true);
    // Os dois somados não podem valer o total sem filtro por acaso: se um dia o
    // campo sumir, o CQL falha e os dois voltariam iguais.
    expect(rm.numberMatched).not.toBe(ride.numberMatched);
  }, 60000);

  it("os códigos de bioma vêm da fonte, não de uma tabela no código", async () => {
    // A versão antiga documentava 2 = Cerrado. Na camada, 2 é Caatinga. Por
    // isso a ferramenta LISTA os códigos em vez de afirmar um mapa fixo.
    const corpo = await consulta(RECORTES.biomas.camada, RECORTES.biomas.campos, undefined, 10);
    const codigos = (corpo.features ?? []).map((f) => Number(f.properties?.cd_bioma));
    expect(codigos.length).toBeGreaterThanOrEqual(6);
    expect(new Set(codigos).size).toBe(codigos.length);
  }, 60000);

  it("a ferramenta inteira responde, sem erro e sem geometria", async () => {
    const { markdown, structured, isError } = await ibgeMalhasTema({ tema: "biomas", limite: 10 });
    expect(isError).toBeFalsy();
    expect(markdown).toContain("Biomas");
    const s = structured as { feicoes: number; url_geometria: string };
    expect(s.feicoes).toBeGreaterThan(0);
    expect(JSON.stringify(structured)).not.toContain("coordinates");

    // E a URL que a ferramenta entrega para baixar a geometria precisa VALER —
    // é a única coisa que ela promete e não verifica sozinha. HEAD basta: o
    // corpo passa de 9 MB.
    const resposta = await fetch(s.url_geometria, { method: "HEAD" });
    expect(resposta.status, s.url_geometria).toBe(200);
  }, 120000);
});
