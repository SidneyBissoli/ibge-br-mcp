#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

/**
 * Entry point: build the IBGE MCP Server and serve it over STDIO.
 *
 * Server construction lives in `server.ts` (side-effect-free, testable); this
 * file only wires it to the STDIO transport. `serveStdio` owns the connection:
 * it pins one server instance from the factory per connection and serves both
 * the modern and the 2025-era protocol openings. stdout is the MCP protocol
 * channel, so all logging goes to stderr.
 */
serveStdio(() => createServer(), {
  onerror: (error) => console.error("Transport error:", error),
});

console.error(`${SERVER_NAME} v${SERVER_VERSION} started`);
