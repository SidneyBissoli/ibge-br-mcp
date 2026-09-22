import { readFileSync } from "node:fs";

const norm = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const sub = JSON.parse(readFileSync("cnae-subclasses.json", "utf8")).map((x) => ({
  id: x.id,
  d: x.descricao,
  dn: norm(x.descricao),
}));

// Cada argumento é um padrão; imprime as descrições que casam (normalizado).
for (const p of process.argv.slice(2)) {
  const hits = sub.filter((x) => x.dn.includes(norm(p)));
  console.log(`\n### "${p}" -> ${hits.length}`);
  for (const h of hits.slice(0, 12)) console.log(`   ${h.id}  ${h.d}`);
  if (hits.length > 12) console.log(`   ... e mais ${hits.length - 12}`);
}
