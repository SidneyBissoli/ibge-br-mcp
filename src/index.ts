#!/usr/bin/env node

import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { unknownCursorError } from "./pagination.js";
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
// O transporte é construído aqui, e não deixado a cargo do `serveStdio`, para
// que o guarda de cursor abaixo possa se pendurar nele.
const transport = new StdioServerTransport();

// Cursor de paginação inválido -> -32602, o MESMO guarda que o Worker aplica no
// POST. Substitui `onmessage` em vez de somar um ouvinte: só quem ESTÁ no lugar
// do `onmessage` pode interromper a entrega ao SDK, e é a interrupção que
// produz a recusa. A troca acontece depois do `serveStdio`, que é quem instala
// o `onmessage` do transporte.
serveStdio(() => createServer(), {
  transport,
  onerror: (error) => console.error("Transport error:", error),
});

const entregaAoServidor = transport.onmessage;
transport.onmessage = (message) => {
  const recusa = unknownCursorError(message);
  if (recusa) {
    void transport.send(recusa);
    return;
  }
  entregaAoServidor?.(message);
};

console.error(`${SERVER_NAME} v${SERVER_VERSION} started`);
