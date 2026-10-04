/**
 * O `/.well-known/mcp/server-card.json` é a superfície travada, não uma cópia.
 *
 * O card é gerado por `@sbissoli/mcp-surface/card` a partir do `buildServer()`
 * do Worker (a mesma fábrica do `/mcp`). Aqui se prova, sem pinar literal:
 * - `serverInfo` tem nome e a versão do package.json da raiz (forma da Smithery);
 * - o card, normalizado de volta, tem o MESMO sha256 da seção `declarada` do
 *   `surface.lock.json` — se divergir, o scanner lê outra superfície;
 * - `authentication.required` é o que a seção `semToken` mediu em produção
 *   (`apiKeyAusente`, `POST /mcp`, `tools/list`).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { impressaoDigital, lerTrava, normalizarSuperficie } from "@sbissoli/mcp-surface";
import { superficieDoCard } from "@sbissoli/mcp-surface/card";
import { describe, expect, it } from "vitest";

import worker from "../src/index.js";
import type { Env } from "../src/types.js";

// `.href`: o URL das workers-types não é o do node:url para o compilador.
const raiz = fileURLToPath(new URL("../../", import.meta.url).href);
const caminhoTrava = `${raiz}surface.lock.json`;
const versao = (JSON.parse(readFileSync(`${raiz}package.json`, "utf8")) as { version: string }).version;

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

async function pedirCard(): Promise<Response> {
  return worker.fetch(new Request("https://ibge.sidneybissoli.com/.well-known/mcp/server-card.json"), {} as Env, ctx);
}

describe("GET /.well-known/mcp/server-card.json", () => {
  it("responde 200 JSON com serverInfo.name e a versão do package.json", async () => {
    const res = await pedirCard();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const card = (await res.json()) as { serverInfo?: { name?: unknown; version?: unknown } };
    expect(typeof card.serverInfo?.name).toBe("string");
    expect(card.serverInfo?.name).not.toBe("");
    expect(card.serverInfo?.version).toBe(versao);
  });

  it("o card normalizado tem o MESMO sha256 da superfície declarada na trava", async () => {
    const declarada = lerTrava(caminhoTrava).declarada;
    expect(declarada, "rode `npm run surface:lock` na raiz").toBeDefined();
    const card = (await (await pedirCard()).json()) as Record<string, unknown>;
    expect(impressaoDigital(normalizarSuperficie(superficieDoCard(card)))).toBe(declarada!.sha256);
  });

  it("authentication.required segue a medição semToken de produção", async () => {
    const trava = JSON.parse(readFileSync(caminhoTrava, "utf8")) as {
      semToken?: { conteudo?: Record<string, Record<string, Record<string, boolean>>> };
    };
    const abertoEmProducao = trava.semToken?.conteudo?.["apiKeyAusente"]?.["POST /mcp"]?.["tools/list"];
    // Produção serve tools/list sem token — se isso mudar, o card muda junto.
    expect(abertoEmProducao).toBe(true);
    const card = (await (await pedirCard()).json()) as { authentication?: { required?: unknown } };
    expect(card.authentication?.required).toBe(false);
  });
});
