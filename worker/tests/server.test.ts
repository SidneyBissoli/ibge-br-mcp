import { describe, expect, it, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { buildServer } from "../src/server.js";
import { cache } from "../../dist/cache.js";
import type { UsageKind } from "../src/usage-core.js";

/**
 * Superfície e instrumentação do Worker: o buildServer reutiliza o registerAll
 * do pacote pai (dist/), então aqui só se verifica que a superfície chega inteira
 * e que o hook de uso conta tool_call/tool_error. Sem rede: fetch mockado.
 */

function recorder() {
  const events: Array<{ kind: UsageKind; name?: string | undefined }> = [];
  return { events, record: (kind: UsageKind, name?: string) => events.push({ kind, name }) };
}

async function connect(server: McpServer) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "worker-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

afterEach(() => {
  vi.unstubAllGlobals();
  cache.clear();
});

describe("buildServer (worker)", () => {
  it("expõe a superfície completa do pacote pai (22 tools, 5 resources, 2 prompts)", async () => {
    const client = await connect(buildServer());
    const { tools } = await client.listTools();
    const { resources } = await client.listResources();
    const { prompts } = await client.listPrompts();
    expect(tools).toHaveLength(22);
    expect(resources).toHaveLength(5);
    expect(prompts).toHaveLength(2);
    await client.close();
  });

  it("registra tool_call em chamada bem-sucedida", async () => {
    const { events, record } = recorder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    );
    const client = await connect(buildServer(record));
    await client.callTool({ name: "ibge_estados", arguments: {} });
    expect(events).toContainEqual({ kind: "tool_call", name: "ibge_estados" });
    expect(events.filter((e) => e.kind === "tool_error")).toHaveLength(0);
    await client.close();
  });

  it("registra tool_error quando o upstream falha", async () => {
    const { events, record } = recorder();
    // 404: não-retryável (um 5xx acionaria o backoff exponencial do fetchWithRetry)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    const client = await connect(buildServer(record));
    const result = await client.callTool({ name: "ibge_estados", arguments: {} });
    expect(result.isError).toBe(true);
    expect(events).toContainEqual({ kind: "tool_call", name: "ibge_estados" });
    expect(events).toContainEqual({ kind: "tool_error", name: "ibge_estados" });
    await client.close();
  });
});
