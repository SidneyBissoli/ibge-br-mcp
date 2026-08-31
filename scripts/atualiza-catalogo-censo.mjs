#!/usr/bin/env node
/**
 * Atualiza o espelho do catálogo de agregados do Censo Demográfico.
 *
 * O espelho existe para que `tests/censo-mapa-de-tabelas.test.ts` possa provar,
 * SEM rede, que toda tabela declarada no mapa de temas de `ibge_censo` é mesmo
 * uma tabela do Censo — e não de outra pesquisa. Ele é uma CÓPIA da fonte, não
 * um literal escrito à mão: quando o IBGE publicar tabelas novas, rode isto.
 *
 *   node scripts/atualiza-catalogo-censo.mjs
 *
 * O teste não fica refém do espelho estar em dia: uma tabela nova do Censo que
 * ainda não esteja aqui reprova, e a mensagem manda rodar este script. É o
 * inverso do que se quer evitar — falso negativo barulhento, nunca falso
 * positivo silencioso.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const URL_AGREGADOS = "https://servicodados.ibge.gov.br/api/v3/agregados";
/** Id da pesquisa "Censo Demográfico" na API de Agregados. */
const PESQUISA_CENSO = "CD";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const destino = join(raiz, "tests", "fixtures", "censo-agregados.json");

const resposta = await fetch(URL_AGREGADOS, { headers: { Accept: "application/json" } });
if (!resposta.ok) {
  throw new Error(`API de Agregados respondeu ${resposta.status} ${resposta.statusText}`);
}
const pesquisas = await resposta.json();
const censo = pesquisas.find((p) => p.id === PESQUISA_CENSO);
if (!censo) {
  throw new Error(`pesquisa ${PESQUISA_CENSO} ausente da resposta — o catálogo mudou de forma`);
}

const agregados = Object.fromEntries(
  censo.agregados.map((a) => [String(a.id), a.nome]).sort((a, b) => Number(a[0]) - Number(b[0])),
);

const saida = {
  _meta: {
    fonte: "IBGE — API de Agregados, pesquisa CD (Censo Demográfico)",
    url: URL_AGREGADOS,
    extraido_em: new Date().toISOString().slice(0, 10),
    como_atualizar: "node scripts/atualiza-catalogo-censo.mjs",
    para_que: "espelho do catálogo oficial, para o teste do mapa de temas de ibge_censo",
  },
  agregados,
};

writeFileSync(destino, `${JSON.stringify(saida, null, 1)}\n`, "utf8");
console.log(`${Object.keys(agregados).length} agregados do Censo gravados em ${destino}`);
