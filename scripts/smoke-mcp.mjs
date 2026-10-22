/**
 * Smoke da superfície MCP (portado do ilo-mcp-server): initialize →
 * tools/list → chamadas reais, cobrindo os modos estatísticos D2.
 *
 * O script fala com o SERVIDOR (worker em produção ou STDIO local), nunca com o
 * IBGE diretamente — quem consulta o IBGE é o servidor. A única exceção é a
 * SONDA (abaixo): um GET mínimo direto na fonte, só quando uma tool falhou.
 *
 * Uso:
 *   node scripts/smoke-mcp.mjs                     # HTTP em produção
 *   node scripts/smoke-mcp.mjs http://localhost:8787  # HTTP em outra base
 *   node scripts/smoke-mcp.mjs --stdio             # spawn de dist/index.js (requer npm run build)
 *   node scripts/smoke-mcp.mjs --sonda             # só pergunta ao IBGE se ele está servindo (sai 0/2)
 *
 * FONTE FORA NÃO É DEPLOY QUEBRADO. Medido em 22/10/2026 (run 39853335263): o
 * IBGE passou a recusar conexões de parte das nuvens; o Worker estava no ar na
 * versão certa, a tool degradou como devia (`isError` com explicação) e este
 * script saía 1 com "ibge_estados retornou erro", sem o texto do erro. O
 * painel abriu "Deploy FALHOU" para um deploy que não falhou. O smoke só vê o
 * que viaja no fio (`isError` + texto; a classe do erro da origem não viaja),
 * então a decisão é do `criarSmoke` do @sbissoli/mcp-live-source: tool com
 * `isError` inesperado → sonda direta na fonte declarada → fonte fora = AVISO
 * (`::warning title=Fonte indisponível`, saída 0); fonte servindo = FALHA com o
 * texto da tool (saída 1). Verificação que lança (asserção, HTTP, JSON-RPC) é
 * defeito do deploy e sai vermelha sem sondar.
 */

import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { criarSmoke } from "@sbissoli/mcp-live-source";

const args = process.argv.slice(2);
const STDIO = args.includes("--stdio");
const BASE = STDIO ? null : (args.find((a) => !a.startsWith("--")) ?? "https://ibge.sidneybissoli.com");

/**
 * As fontes que as tools deste roteiro consultam, num pedido mínimo cada: um
 * recurso que EXISTE, com corpo pequeno. `SMOKE_SONDA_<NOME>` aponta a sonda
 * para outro lugar — para provar o `--sonda` dizendo FORA sem esperar o IBGE
 * cair. A API de Agregados é o mesmo host das localidades desde 16/09/2026
 * (o `apisidra` ficou atrás de um desafio do Cloudflare), mas é OUTRA API,
 * com outro backend: sondar as duas é o que separa "o IBGE caiu" de "o SIDRA
 * caiu".
 */
const ehJson = (f) => (corpo) => {
  try {
    return f(JSON.parse(corpo));
  } catch {
    return false;
  }
};
const smoke = criarSmoke({
  sondas: [
    {
      nome: "localidades",
      url: process.env.SMOKE_SONDA_LOCALIDADES ?? "https://servicodados.ibge.gov.br/api/v1/localidades/estados/33",
      aceita: ehJson((j) => j?.id === 33),
    },
    {
      nome: "agregados",
      url:
        process.env.SMOKE_SONDA_AGREGADOS ??
        "https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N1[all]",
      aceita: ehJson((j) => Array.isArray(j) && j.length > 0),
    },
  ],
});

// Sair no mesmo tick em que o socket do fetch fecha derruba o Node 24 no
// Windows ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)", rc 127
// em vez do código pedido). Um respiro resolve; medido no bcb em 22/10/2026.
let child = null; // o processo do modo STDIO, quando houver
async function sair(codigo) {
  if (child) child.kill();
  await new Promise((r) => setTimeout(r, 200));
  process.exit(codigo);
}

if (args.includes("--sonda")) {
  const estados = await smoke.sondar();
  await sair(estados.every((e) => e.veredito === "servindo") ? 0 : 2);
}

/**
 * O smoke fala pela ROTA DE USO PRÓPRIO, e isso não é detalhe de estilo.
 *
 * Ele chama `ibge_sidra` com um `agruparPor` inválido DE PROPÓSITO, para
 * afirmar que a ferramenta recusa. Pela rota pública essa recusa entra na
 * telemetria indistinguível de gente batendo numa porta emperrada — e entrava:
 * medido em 11/09/2026, a `ibge_sidra` liderava a fila de urgências do painel
 * com 42% de erro, e as redes da Azure (os runners do GitHub Actions) traziam
 * 24 dos 43 erros da janela, numa proporção de um acerto para um erro que é a
 * assinatura exata deste arquivo. O painel acusava o nosso próprio CI.
 *
 * O desconto de varredura do monitor não pega isto: ele procura rajada de
 * catálogo e assinatura repetida de sessão GRANDE, e um smoke é uma sessão
 * pequena e arrumada, igualzinha à de uma pessoa explorando. Quem sabe que
 * este tráfego é nosso é este arquivo, então é ele que se identifica — a rota
 * `/mcp/uso-proprio` existe desde 11/09/2026 para isso (worker/src/analytics.ts).
 *
 * A cobertura da rota pública não se perde: `confereRotaPublica()` abaixo abre
 * um handshake contra `/mcp` antes de tudo. `initialize` é método de protocolo
 * e não conta como chamada de ferramenta no painel.
 */
const ROTA_MCP = STDIO ? null : (process.env.SMOKE_MCP_ROUTE ?? "/mcp/uso-proprio");
let nextId = 1;

// --- Transporte HTTP (Streamable HTTP, com sessão) -------------------------
let sessionId = null;
async function rpcHttp(method, params, isNotification = false) {
  const body = { jsonrpc: "2.0", method, params };
  if (!isNotification) body.id = nextId++;
  const res = await fetch(`${BASE}${ROTA_MCP}`, {
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

/** Asserção do roteiro: lança, e o `verificar` registra como defeito do deploy. */
function exigir(condicao, msg) {
  if (!condicao) throw new Error(msg);
}

/** Verificação de que o resto depende: se falhou, conclui e sai agora. */
async function ouPara(resultado) {
  if (resultado !== undefined) return resultado;
  const resumo = smoke.concluir();
  await sair(resumo.codigoDeSaida);
}

// --- Roteiro ----------------------------------------------------------------

/**
 * A rota PÚBLICA continua provada, mesmo com o roteiro correndo pela privada.
 *
 * Um handshake só, contra `/mcp`, conferindo que o servidor se apresenta com o
 * mesmo nome. É o que fecha o buraco que trocar de rota abriria: uma quebra que
 * atingisse `/mcp` e não a rota de uso próprio passaria despercebida. Sai de
 * graça na telemetria de ferramenta — `initialize` é método de protocolo, e o
 * painel os exclui por construção.
 */
async function confereRotaPublica() {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke-rota-publica", version: "0.0.0" },
      },
    }),
  });
  const texto = await res.text();
  exigir(res.ok, `rota pública /mcp: HTTP ${res.status} ${texto.slice(0, 200)}`);
  const linha = texto.includes("data:")
    ? texto.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim()
    : texto;
  const nome = JSON.parse(linha)?.result?.serverInfo?.name;
  exigir(nome, `rota pública /mcp: handshake sem serverInfo (${texto.slice(0, 200)})`);
  return nome;
}

/**
 * CONTRATO DE SESSÃO (desde 2026-09-17). O Worker emite `Mcp-Session-Id` no
 * initialize para a telemetria ligar as mensagens de um aperto de mão; o
 * handler é stateless e IGNORA o cabeçalho que o cliente devolve. Este teste
 * existe porque isso depende do modo stateless do SDK e do `agents`: um
 * upgrade que passasse a validar sessão quebraria todo cliente que devolve o
 * id — e quebraria aqui, no deploy, antes de virar incidente. O DELETE é 405
 * nos sete servidores (servidor sem sessão não encerra sessão).
 */
async function contratoDeSessao(endpoint) {
  const cab = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const init = await fetch(endpoint, {
    method: "POST", headers: cab,
    body: JSON.stringify({ jsonrpc: "2.0", id: 91, method: "initialize", params: {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "smoke-contrato-sessao", version: "0.0.0" } } })
  });
  await init.text();
  const sid = init.headers.get("mcp-session-id") ?? "";
  exigir(/^[A-Za-z0-9._~-]{1,64}$/.test(sid), `initialize sem Mcp-Session-Id legível (${JSON.stringify(sid)})`);
  const lista = await fetch(endpoint, {
    method: "POST", headers: { ...cab, "mcp-session-id": "contrato-inexistente-" + Date.now() },
    body: JSON.stringify({ jsonrpc: "2.0", id: 92, method: "tools/list", params: {} })
  });
  await lista.text();
  exigir(lista.status === 200, `tools/list com id desconhecido respondeu HTTP ${lista.status} (o handler stateless tem de ignorar o cabeçalho)`);
  const del = await fetch(endpoint, { method: "DELETE", headers: { "mcp-session-id": sid } });
  await del.text();
  exigir(del.status === 405, `DELETE respondeu HTTP ${del.status}, esperado 405 (servidor sem sessão)`);
  return "id emitido no initialize, id desconhecido ignorado, DELETE 405";
}

if (!STDIO && ROTA_MCP !== "/mcp") await ouPara(await smoke.verificar("rota pública /mcp", confereRotaPublica, { detalhe: (n) => n }));
if (!STDIO) await ouPara(await smoke.verificar("contrato de sessão", () => contratoDeSessao(`${BASE}${ROTA_MCP}`), { detalhe: (d) => d }));

await ouPara(
  await smoke.verificar(
    "initialize",
    async () => {
      const init = await rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0.0.0" },
      });
      exigir(init.instructions, "instructions ausentes no handshake");
      await rpc("notifications/initialized", {}, true).catch(() => {});
      return init;
    },
    { detalhe: (init) => `${init.serverInfo?.name} ${init.serverInfo?.version} | ${init.instructions.slice(0, 60)}...` },
  ),
);

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

const { tools } = await ouPara(
  await smoke.verificar(
    "tools/list",
    async () => {
      exigir(baselineMaisRecente, "nenhum baselines/surface-stdio-*.json para derivar a contagem");
      const esperado = JSON.parse(readFileSync(`baselines/${baselineMaisRecente}`, "utf8")).toolCount;
      const r = await rpc("tools/list", {});
      exigir(r.tools.length === esperado, `esperava ${esperado} tools (baseline ${baselineMaisRecente}), veio ${r.tools.length}`);
      const semTitle = r.tools.filter((t) => !t.title);
      exigir(semTitle.length === 0, `tools sem title: ${semTitle.map((t) => t.name).join(", ")}`);
      return r;
    },
    { detalhe: (r) => `${r.tools.length} tools (baseline ${baselineMaisRecente}), titles ok` },
  ),
);

const chamar = (name, args) => rpc("tools/call", { name, arguments: args });

// 1) Tool simples + bloco de proveniência (contrato v1.0, três canais)
await smoke.verificar(
  "ibge_estados SE + proveniência nos três canais",
  async () => {
    const estados = await chamar("ibge_estados", { regiao: "SE" });
    if (estados.isError) return estados;
    const prov = estados.structuredContent?.provenance;
    exigir(prov, "bloco de proveniência ausente em structuredContent");
    // As chaves esperadas vêm do pacote que define o contrato, não de um literal:
    // a lista escrita à mão ("source,...,license", v1.0) derrubou o deploy da 5.4.0
    // (27/09/2026) quando o contrato ganhou `retrieval` — o mesmo defeito do
    // outputSchema transcrito, agora no smoke.
    // Desde a 0.3.0 (contrato v1.2) o schema DECLARA chave opcional (`field_sources`,
    // só presente quando a resposta funde sub-fontes): comparar com TODAS as
    // `properties` derrubou o deploy da 5.6.0 (06/10/2026). A regra é: as `required`
    // presentes, nenhuma chave fora das `properties`, e a ordem das `properties`.
    const { CONCISE_BLOCK_JSON_SCHEMA } = await import("@sbissoli/mcp-provenance");
    const chaves = Object.keys(prov);
    const ordem = Object.keys(CONCISE_BLOCK_JSON_SCHEMA.properties);
    const faltam = CONCISE_BLOCK_JSON_SCHEMA.required.filter((k) => !chaves.includes(k));
    const sobram = chaves.filter((k) => !ordem.includes(k));
    const naOrdem = ordem.filter((k) => chaves.includes(k)).join(",") === chaves.join(",");
    exigir(
      !faltam.length && !sobram.length && naOrdem,
      `chaves do bloco concise fora do contrato: ${chaves.join(",")} ` +
        `(faltam: ${faltam.join(",") || "-"}; fora do schema: ${sobram.join(",") || "-"}; ordem do schema: ${naOrdem ? "ok" : ordem.join(",")})`,
    );
    exigir(prov.retrieval === null || typeof prov.retrieval?.requests === "number", `retrieval fora do contrato: ${JSON.stringify(prov.retrieval)}`);
    exigir(/^Fonte: IBGE — .+, extraído em \d{2}\/\d{2}\/\d{4}\.$/.test(prov.citation), `citation fora do padrão: ${prov.citation}`);
    exigir(Array.isArray(estados.structuredContent.attribution) && estados.structuredContent.attribution.length > 0, "attribution ausente em structuredContent");
    const rodape = estados.content?.[estados.content.length - 1]?.text ?? "";
    exigir(rodape.includes("A referência completa desta informação pode ser solicitada nesta própria conversa."), "rodapé de proveniência ausente no canal de texto");
    exigir(estados._meta?.["br.com.sidneybissoli.ibge/provenance"], "espelho de proveniência ausente em _meta");
    return estados;
  },
  { sondas: ["localidades"], detalhe: (e) => `${e.structuredContent.provenance.source} | retrieval ${JSON.stringify(e.structuredContent.provenance.retrieval)}` },
);

// 2) D2 — distribuição + top/bottom (população por UF)
await smoke.verificar(
  "ibge_sidra estatisticas=true (distribuição + topN)",
  async () => {
    const stats = await chamar("ibge_sidra", { tabela: "6579", nivel_territorial: "3", estatisticas: true, topN: 3 });
    if (stats.isError) return stats;
    const bloco = stats.structuredContent?.estatisticas;
    exigir(bloco?.distribuicao, "bloco estatisticas.distribuicao ausente");
    exigir(stats.structuredContent?.provenance, "proveniência ausente no modo estatísticas (derivado)");
    exigir(stats.structuredContent.registros.length === 0, "registros deveriam vir vazios no modo estatísticas");
    return stats;
  },
  { sondas: ["agregados"], detalhe: (s) => `n = ${s.structuredContent.estatisticas.distribuicao.n} | top[0] = ${JSON.stringify(s.structuredContent.estatisticas.top?.[0])}` },
);

// 3) D2 — agrupado
await smoke.verificar(
  "ibge_censo agrupado por UF",
  async () => {
    const agrupado = await chamar("ibge_censo", { ano: "2022", tema: "populacao", nivel_territorial: "3", estatisticas: true, agruparPor: "Unidade da Federação" });
    if (agrupado.isError) return agrupado;
    exigir(agrupado.structuredContent?.estatisticas?.grupos?.length, "bloco agrupado sem grupos");
    return agrupado;
  },
  { sondas: ["agregados"], detalhe: (a) => `totalGrupos = ${a.structuredContent.estatisticas.totalGrupos} | grupos[0] = ${a.structuredContent.estatisticas.grupos[0].grupo}` },
);

// 4) Erro pedagógico — coluna de agrupamento inexistente: a recusa é o certo.
await smoke.verificar(
  "ibge_sidra agruparPor inválido → isError",
  () => chamar("ibge_sidra", { tabela: "6579", estatisticas: true, agruparPor: "ColunaInexistente" }),
  { esperaErro: true, detalhe: (e) => (e.content?.[0]?.text ?? "").replaceAll(/\s+/g, " ").slice(0, 80) },
);

// 5) Contrato Deep Research do ChatGPT: search → fetch. A primeira busca
// constrói o índice (dois GETs + ranking) — no Worker é também a prova de
// que o custo de CPU cabe no limite por requisição. O índice lê as duas APIs
// (agregados e localidades): as duas sondas explicam uma falha aqui.
const busca = await smoke.verificar(
  "search (Deep Research)",
  async () => {
    const busca = await chamar("search", { query: "população residente estimada" });
    if (busca.isError) return busca;
    exigir(busca.content?.length === 1, `content deveria ter 1 bloco, veio ${busca.content?.length}`);
    const objeto = JSON.parse(busca.content[0].text);
    exigir(Array.isArray(objeto.results) && objeto.results.length > 0, "results vazio");
    exigir(JSON.stringify(objeto.results) === JSON.stringify(busca.structuredContent?.results), "content[0].text e structuredContent.results divergem");
    exigir(busca.structuredContent?.provenance, "proveniência ausente em structuredContent");
    const primeiro = objeto.results[0];
    exigir(primeiro.id && primeiro.title && primeiro.url, `resultado fora do contrato: ${JSON.stringify(primeiro)}`);
    return { busca, primeiro, total: objeto.results.length };
  },
  { detalhe: (b) => `${b.total} resultados | [0] = ${b.primeiro.id} — ${b.primeiro.title}` },
);

if (busca === undefined) {
  smoke.naoMedida("fetch (Deep Research)", "depende do id que o search devolveria");
} else {
  await smoke.verificar(
    "fetch (Deep Research)",
    async () => {
      const doc = await chamar("fetch", { id: busca.primeiro.id });
      if (doc.isError) return doc;
      const objeto = JSON.parse(doc.content[0].text);
      for (const chave of ["id", "title", "text", "url"]) {
        exigir(typeof objeto[chave] === "string" && objeto[chave], `campo ${chave} ausente ou vazio`);
      }
      exigir(objeto.id === busca.primeiro.id, "id devolvido difere do pedido");
      exigir(doc.structuredContent?.provenance, "proveniência ausente em structuredContent");
      return objeto;
    },
    { detalhe: (o) => `${o.id} | text ${o.text.length} chars | url ${o.url}` },
  );
}

const resumo = smoke.concluir();
console.log(resumo.codigoDeSaida === 0 ? (resumo.naoMedidas.length > 0 ? "\nSMOKE OK com aviso de fonte" : "\nSMOKE OK") : "\nSMOKE FALHOU");
await sair(resumo.codigoDeSaida);
