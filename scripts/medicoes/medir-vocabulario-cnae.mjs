import { readFileSync } from "node:fs";

const norm = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const niveis = {};
for (const n of ["secoes", "divisoes", "grupos", "classes", "subclasses"]) {
  niveis[n] = JSON.parse(readFileSync(`cnae-${n}.json`, "utf8")).map((x) => ({
    id: x.id,
    d: x.descricao,
    dn: norm(x.descricao),
  }));
}
const sub = niveis.subclasses; // nível padrão da busca

// Conta como a busca ATUAL faz (toLowerCase, com acento, substring contígua)
const atual = (t) => sub.filter((x) => x.d.toLowerCase().includes(t.toLowerCase())).length;
// Conta normalizado (o que o conserto de ACENTO sozinho já resolveria)
const semAcento = (t) => sub.filter((x) => x.dn.includes(norm(t))).length;

const termos = process.argv.slice(2);
const linhas = [];
for (const t of termos) {
  const a = atual(t);
  const s = semAcento(t);
  linhas.push({ termo: t, atual: a, normalizado: s, ganho: s - a });
}
linhas.sort((x, y) => y.ganho - x.ganho || y.normalizado - x.normalizado);
for (const l of linhas) {
  console.log(
    `${l.termo.padEnd(28)} atual=${String(l.atual).padStart(4)}  normalizado=${String(l.normalizado).padStart(4)}  ganho=${l.ganho > 0 ? "+" : " "}${l.ganho}`
  );
}
