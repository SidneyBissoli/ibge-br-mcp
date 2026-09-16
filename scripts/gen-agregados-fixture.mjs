// Gera tests/fixtures/agregados-ids.txt a partir da API de Agregados v3 do IBGE.
//
// POR QUE UM ARQUIVO, e não bater na API no teste: o teste é offline e
// determinístico, e o que ele prova é que a fixture de nomes REAIS usada em
// tests/vocabulario.test.ts não derivou para ficção — cada código citado lá
// existe na lista versionada aqui. O arquivo é derivado, versionado e
// regenerável — nunca digitado. Regenerar quando o IBGE publicar agregados
// novos que a fixture queira citar.
//
// Uso: node scripts/gen-agregados-fixture.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const URL = "https://servicodados.ibge.gov.br/api/v3/agregados";

const res = await fetch(URL, { headers: { "User-Agent": "ibge-br-mcp (https://github.com/SidneyBissoli/ibge-br-mcp)" } });
if (!res.ok) throw new Error(`${URL}: HTTP ${res.status}`);
const pesquisas = await res.json();

const ids = new Set();
for (const p of pesquisas) for (const a of p.agregados ?? []) ids.add(String(a.id));
if (ids.size < 5000) throw new Error(`só ${ids.size} agregados — a API mudou de forma?`);

const cabecalho = [
  `# Códigos de agregado da API v3 do IBGE (${URL}).`,
  `# Gerado por scripts/gen-agregados-fixture.mjs em ${new Date().toISOString().slice(0, 10)} — não editar à mão.`,
  "# Serve ao teste que prova que a fixture de tests/vocabulario.test.ts cita agregados que existem.",
  "",
].join("\n");
writeFileSync(
  join(root, "tests", "fixtures", "agregados-ids.txt"),
  cabecalho + [...ids].sort((a, b) => Number(a) - Number(b)).join("\n") + "\n",
);
console.log(`${ids.size} códigos gravados em tests/fixtures/agregados-ids.txt`);
