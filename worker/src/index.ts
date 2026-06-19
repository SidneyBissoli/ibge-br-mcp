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

import { registerAll, SERVER_VERSION } from "../../dist/server.js";

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
      const server = new McpServer({
        name: "ibge-br-mcp",
        version: SERVER_VERSION,
        websiteUrl: "https://github.com/SidneyBissoli/ibge-br-mcp",
      });
      registerAll(server);

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
