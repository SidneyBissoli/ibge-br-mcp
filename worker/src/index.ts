/**
 * Cloudflare Worker entry — serves ibge-br-mcp over Streamable HTTP.
 *
 * Mirrors the stateless pattern used by senado-br-mcp: a fresh MCP server is
 * built per request and handled by the SDK's Web-standard Streamable HTTP
 * transport (Request → Response), so there is no session state and no Durable
 * Object — ideal for this read-only, public-data server.
 *
 * The tool/resource/prompt registrations are reused verbatim from the npm
 * package via `registerAll` (see `../../src/server.ts`), so the HTTP transport
 * and the STDIO transport always expose exactly the same surface.
 *
 * Requires the parent package to be built first (`npm run build` at the repo
 * root) so that `../../dist/server.js` exists.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { registerAll, SERVER_VERSION } from "../../dist/server.js";

const WEBSITE_URL = "https://github.com/SidneyBissoli/ibge-br-mcp";

/** Builds a fresh MCP server with the shared tool/resource/prompt surface. */
function buildServer(): McpServer {
  const server = new McpServer({
    name: "ibge-br-mcp",
    version: SERVER_VERSION,
    websiteUrl: WEBSITE_URL,
  });
  registerAll(server);
  return server;
}

/**
 * Static (per-deploy) server card for registry scanners (e.g. Smithery) that
 * read `/.well-known/mcp/server-card.json` instead of connecting to `/mcp`.
 * Built once by introspecting the real `registerAll` surface via an in-memory
 * client, so the advertised tools/resources/prompts never drift from /mcp.
 */
let serverCardCache: string | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRpcResult = any;

async function getServerCard(): Promise<string> {
  if (serverCardCache) return serverCardCache;

  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  // Talk to the server with raw JSON-RPC over the in-memory transport instead
  // of the SDK Client: the Client compiles tool outputSchemas with Ajv (via
  // `new Function`), which the Cloudflare Workers runtime forbids. The server
  // side of `*/list` does no such codegen, so raw requests are safe here.
  const pending = new Map<number, (msg: JsonRpcResult) => void>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientTransport.onmessage = (msg: any) => {
    if (msg && typeof msg.id === "number" && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    }
  };
  await clientTransport.start();

  let nextId = 1;
  const request = (method: string, params?: unknown): Promise<JsonRpcResult> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (msg) =>
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void clientTransport.send({ jsonrpc: "2.0", id, method, params } as any);
    });

  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "server-card-builder", version: SERVER_VERSION },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  void clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" } as any);

  const tools = (await request("tools/list")).tools;
  let resources: unknown[] = [];
  let prompts: unknown[] = [];
  try {
    resources = (await request("resources/list")).resources;
  } catch {
    /* server may not advertise resources */
  }
  try {
    prompts = (await request("prompts/list")).prompts;
  } catch {
    /* server may not advertise prompts */
  }
  await clientTransport.close();

  serverCardCache = JSON.stringify({
    name: "ibge-br-mcp",
    version: SERVER_VERSION,
    websiteUrl: WEBSITE_URL,
    protocolVersion: init.protocolVersion,
    capabilities: init.capabilities,
    instructions: init.instructions,
    tools,
    resources,
    prompts,
  });
  return serverCardCache;
}

interface Env {
  /** When set, the /mcp endpoint requires `Authorization: Bearer <API_KEY>`. */
  API_KEY?: string;
  /** CORS allow-origin (default "*"). */
  ALLOWED_ORIGIN?: string;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "*";

    // CORS preflight.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Liveness probe.
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } });
    }

    // MCP server card for registry scanners that read it instead of /mcp.
    if (url.pathname === "/.well-known/mcp/server-card.json") {
      try {
        return new Response(await getServerCard(), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      } catch (err) {
        console.error("server-card generation failed:", err);
        return new Response(JSON.stringify({ error: "server card unavailable" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }
    }

    // Glama connector descriptor (optional, for registry discovery).
    if (url.pathname === "/.well-known/glama.json") {
      return new Response(
        JSON.stringify({
          $schema: "https://glama.ai/mcp/schemas/connector.json",
          maintainers: [{ email: "sbissoli76@gmail.com" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        }
      );
    }

    // MCP endpoint.
    if (url.pathname === "/mcp") {
      // Optional bearer-token auth — only enforced when API_KEY is configured.
      if (env.API_KEY) {
        const auth = request.headers.get("Authorization");
        if (auth !== `Bearer ${env.API_KEY}`) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
          });
        }
      }

      // Stateless: a fresh server + transport per request (no session state).
      const server = buildServer();

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
      });
      await server.connect(transport);

      const response = await transport.handleRequest(request);

      // Re-attach CORS headers onto the transport's response.
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders(origin))) {
        headers.set(key, value);
      }
      return new Response(response.body, { status: response.status, headers });
    }

    return new Response("ibge-br-mcp — MCP endpoint at /mcp", { status: 404 });
  },
};
