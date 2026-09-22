import { readFileSync } from "node:fs";

const norm = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const sub = JSON.parse(readFileSync("cnae-subclasses.json", "utf8")).map((x) => ({
  dn: norm(x.descricao),
}));
const n = (p) => sub.filter((x) => x.dn.includes(norm(p))).length;

// [palavra perguntada, [grafias do IBGE]]
const pares = [
  ["software", ["programas de computador"]],
  ["app", ["programas de computador"]],
  ["aplicativo", ["programas de computador"]],
  ["site", ["programas de computador", "portais"]],
  ["farmacia", ["produtos farmaceuticos"]],
  ["drogaria", ["produtos farmaceuticos"]],
  ["dentista", ["odontolog"]],
  ["consultorio", ["ambulatorial"]],
  ["advogado", ["advocatici"]],
  ["advocacia", ["advocatici"]],
  ["contador", ["contabilidade", "contabil"]],
  ["hotel", ["hoteis"]],
  ["motel", ["moteis"]],
  ["pousada", ["pensoes", "alojamento"]],
  ["academia", ["condicionamento fisico"]],
  ["salao", ["cabeleireiro"]],
  ["barbearia", ["cabeleireiro"]],
  ["oficina", ["manutencao e reparacao", "veiculos automotores"]],
  ["caminhao", ["transporte rodoviario de carga"]],
  ["frete", ["transporte rodoviario de carga"]],
  ["delivery", ["consumo domiciliar"]],
  ["pizzaria", ["restaurantes", "lanchonetes"]],
  ["petshop", ["animais domesticos"]],
  ["teatro", ["artes cenicas"]],
  ["jardinagem", ["paisagis"]],
  ["reciclagem", ["residuos", "sucatas"]],
  ["lixo", ["residuos"]],
  ["faculdade", ["educacao superior"]],
  ["universidade", ["educacao superior"]],
  ["propaganda", ["publicidade"]],
];

console.log("perguntado".padEnd(16) + "n".padStart(4) + "   o IBGE escreve");
for (const [p, fontes] of pares) {
  const alvo = fontes.map((f) => `${f} (${n(f)})`).join(" / ");
  console.log(`${p.padEnd(16)}${String(n(p)).padStart(4)}   ${alvo}`);
}
