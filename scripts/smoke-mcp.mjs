/**
 * Smoke manual da superfície MCP (portado do ilo-mcp-server): initialize →
 * tools/list → chamadas reais, cobrindo os modos estatísticos D2.
 *
 * O script fala com o SERVIDOR (worker em produção ou STDIO local), nunca com o
 * IBGE diretamente — quem consulta o IBGE é o servidor (o WAF do IBGE rejeita
 * User-Agent não-navegador; esse tratamento mora no retry do servidor).
 *
 * Uso:
 *   node scripts/smoke-mcp.mjs                     # HTTP em produção
 *   node scripts/smoke-mcp.mjs http://localhost:8787  # HTTP em outra base
 *   node scripts/smoke-mcp.mjs --stdio             # spawn de dist/index.js (requer npm run build)
 */

import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const STDIO = process.argv[2] === "--stdio";
const BASE = STDIO ? null : (process.argv[2] ?? "https://ibge.sidneybissoli.com");
let nextId = 1;

// --- Transporte HTTP (Streamable HTTP, com sessão) -------------------------
let sessionId = null;
async function rpcHttp(method, params, isNotification = false) {
  const body = { jsonrpc: "2.0", method, params };
  if (!isNotification) body.id = nextId++;
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  sessionId ??= res.headers.get("mcp-session-id");
  if (isNotification) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 300)}`);
  // Streamable HTTP pode responder SSE; extrair o(s) data:
  const payloads =
    text.startsWith("event:") || text.includes("\ndata:") || text.startsWith("data:")
      ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
      : [text];
  const msg = JSON.parse(payloads[payloads.length - 1]);
  if (msg.error) throw new Error(`${method}: ${JSON.stringify(msg.error).slice(0, 400)}`);
  return msg.result;
}

// --- Transporte STDIO (JSON delimitado por \n contra dist/index.js) --------
let child = null;
const pending = new Map();
function startStdio() {
  child = spawn(process.execPath, ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"] });
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error).slice(0, 400)));
        else resolve(msg.result);
      }
    }
  });
}
function rpcStdio(method, params, isNotification = false) {
  const body = { jsonrpc: "2.0", method, params };
  if (isNotification) {
    child.stdin.write(JSON.stringify(body) + "\n");
    return Promise.resolve(null);
  }
  const id = nextId++;
  body.id = id;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify(body) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method}: timeout (60s)`));
      }
    }, 60_000).unref();
  });
}

const rpc = STDIO ? rpcStdio : rpcHttp;
if (STDIO) startStdio();

function fail(msg) {
  console.error(`SMOKE FALHOU: ${msg}`);
  process.exit(1);
}

// --- Roteiro ----------------------------------------------------------------
const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0.0.0" },
});
console.log("initialize:", init.serverInfo);
if (!init.instructions) fail("instructions ausentes no handshake");
console.log("instructions:", init.instructions.slice(0, 80) + "...");

await rpc("notifications/initialized", {}, true).catch(() => {});

// A contagem esperada NÃO é um literal: vem do baseline de superfície mais
// recente (baselines/surface-stdio-<versão>.json, ver baselines/README.md).
// Mudou a superfície sem recapturar o baseline → o smoke fica vermelho, que é
// o combinado; um "21" pinado aqui ficou para trás na 4.3.0 e derrubou o
// deploy com a produção certa.
const versaoDe = (nome) => nome.match(/(\d+)\.(\d+)\.(\d+)/).slice(1).map(Number);
const baselineMaisRecente = readdirSync("baselines")
  .filter((f) => /^surface-stdio-\d+\.\d+\.\d+\.json$/.test(f))
  .sort((a, b) => {
    const [va, vb] = [versaoDe(a), versaoDe(b)];
    return va[0] - vb[0] || va[1] - vb[1] || va[2] - vb[2];
  })
  .at(-1);
if (!baselineMaisRecente) fail("nenhum baselines/surface-stdio-*.json para derivar a contagem");
const esperado = JSON.parse(readFileSync(`baselines/${baselineMaisRecente}`, "utf8")).toolCount;

const { tools } = await rpc("tools/list", {});
console.log(`tools/list: ${tools.length} tools (baseline ${baselineMaisRecente}: ${esperado})`);
if (tools.length !== esperado) fail(`esperava ${esperado} tools, veio ${tools.length}`);
const semTitle = tools.filter((t) => !t.title);
if (semTitle.length > 0) fail(`tools sem title: ${semTitle.map((t) => t.name).join(", ")}`);
console.log(`titles: ok nas ${tools.length}`);

// 1) Tool simples + bloco de proveniência (contrato v1.0, três canais)
const estados = await rpc("tools/call", {
  name: "ibge_estados",
  arguments: { regiao: "SE" },
});
if (estados.isError) fail("ibge_estados retornou erro");
console.log("\nibge_estados SE: ok,", Object.keys(estados.structuredContent ?? {}));

const prov = estados.structuredContent?.provenance;
if (!prov) fail("bloco de proveniência ausente em structuredContent");
const chaves = Object.keys(prov).join(",");
if (chaves !== "source,source_url,data_vintage,retrieved_at,citation,license")
  fail(`chaves do bloco concise fora do contrato: ${chaves}`);
if (!/^Fonte: IBGE — .+, extraído em \d{2}\/\d{2}\/\d{4}\.$/.test(prov.citation))
  fail(`citation fora do padrão: ${prov.citation}`);
if (!Array.isArray(estados.structuredContent.attribution) || estados.structuredContent.attribution.length === 0)
  fail("attribution ausente em structuredContent");
const rodape = estados.content?.[estados.content.length - 1]?.text ?? "";
if (!rodape.includes("A referência completa desta informação pode ser solicitada nesta própria conversa."))
  fail("rodapé de proveniência ausente no canal de texto");
const metaProv = estados._meta?.["br.com.sidneybissoli.ibge/provenance"];
if (!metaProv) fail("espelho de proveniência ausente em _meta");
console.log("provenance: ok (structuredContent + rodapé + _meta) |", prov.source);

// 2) D2 — distribuição + top/bottom (população por UF)
const stats = await rpc("tools/call", {
  name: "ibge_sidra",
  arguments: { tabela: "6579", nivel_territorial: "3", estatisticas: true, topN: 3 },
});
if (stats.isError) fail("ibge_sidra estatisticas=true retornou erro");
const bloco = stats.structuredContent?.estatisticas;
if (!bloco?.distribuicao) fail("bloco estatisticas.distribuicao ausente");
if (!stats.structuredContent?.provenance) fail("proveniência ausente no modo estatísticas (derivado)");
console.log("\nibge_sidra estatisticas: n =", bloco.distribuicao.n, "| top[0] =", JSON.stringify(bloco.top?.[0]));
if (stats.structuredContent.registros.length !== 0) fail("registros deveriam vir vazios no modo estatísticas");

// 3) D2 — agrupado
const agrupado = await rpc("tools/call", {
  name: "ibge_censo",
  arguments: { ano: "2022", tema: "populacao", nivel_territorial: "3", estatisticas: true, agruparPor: "Unidade da Federação" },
});
if (agrupado.isError) fail("ibge_censo agrupado retornou erro");
const blocoG = agrupado.structuredContent?.estatisticas;
if (!blocoG?.grupos?.length) fail("bloco agrupado sem grupos");
console.log("ibge_censo agrupado: totalGrupos =", blocoG.totalGrupos, "| grupos[0] =", blocoG.grupos[0].grupo);

// 4) Erro pedagógico — coluna de agrupamento inexistente
const erro = await rpc("tools/call", {
  name: "ibge_sidra",
  arguments: { tabela: "6579", estatisticas: true, agruparPor: "ColunaInexistente" },
});
if (!erro.isError) fail("agruparPor inválido deveria retornar isError");
console.log("agruparPor inválido → isError: true |", erro.content[0].text.slice(0, 80));

// 5) Contrato Deep Research do ChatGPT: search → fetch. A primeira busca
// constrói o índice (dois GETs + ranking) — no Worker é também a prova de
// que o custo de CPU cabe no limite por requisição.
const busca = await rpc("tools/call", { name: "search", arguments: { query: "população residente estimada" } });
if (busca.isError) fail(`search retornou erro: ${busca.content?.[0]?.text?.slice(0, 200)}`);
if (busca.content?.length !== 1) fail(`search: content deveria ter 1 bloco, veio ${busca.content?.length}`);
const objetoBusca = JSON.parse(busca.content[0].text);
if (!Array.isArray(objetoBusca.results) || objetoBusca.results.length === 0) fail("search: results vazio");
if (JSON.stringify(objetoBusca.results) !== JSON.stringify(busca.structuredContent?.results))
  fail("search: content[0].text e structuredContent.results divergem");
if (!busca.structuredContent?.provenance) fail("search: proveniência ausente em structuredContent");
const primeiro = objetoBusca.results[0];
if (!primeiro.id || !primeiro.title || !primeiro.url) fail(`search: resultado fora do contrato: ${JSON.stringify(primeiro)}`);
console.log(`search: ${objetoBusca.results.length} resultados | [0] = ${primeiro.id} — ${primeiro.title}`);

const doc = await rpc("tools/call", { name: "fetch", arguments: { id: primeiro.id } });
if (doc.isError) fail(`fetch retornou erro: ${doc.content?.[0]?.text?.slice(0, 200)}`);
const objetoDoc = JSON.parse(doc.content[0].text);
for (const chave of ["id", "title", "text", "url"]) {
  if (typeof objetoDoc[chave] !== "string" || !objetoDoc[chave]) fail(`fetch: campo ${chave} ausente ou vazio`);
}
if (objetoDoc.id !== primeiro.id) fail("fetch: id devolvido difere do pedido");
if (!doc.structuredContent?.provenance) fail("fetch: proveniência ausente em structuredContent");
console.log(`fetch: ${objetoDoc.id} | text ${objetoDoc.text.length} chars | url ${objetoDoc.url}`);

if (STDIO) child.kill();
console.log("\nSMOKE OK");
process.exit(0);
