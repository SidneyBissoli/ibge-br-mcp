/**
 * Standardized error handling for IBGE MCP Server
 */

// Common IBGE API error codes and their meanings
export const IBGE_ERROR_CODES: Record<number, { message: string; suggestion: string }> = {
  400: {
    message: "Parâmetros inválidos",
    suggestion: "Verifique se os parâmetros estão no formato correto.",
  },
  404: {
    message: "Recurso não encontrado",
    suggestion: "Verifique se o código ou identificador existe.",
  },
  500: {
    message: "Erro interno do servidor IBGE",
    suggestion: "Tente novamente em alguns minutos.",
  },
  502: {
    message: "Serviço IBGE temporariamente indisponível",
    suggestion: "Tente novamente em alguns minutos.",
  },
  503: {
    message: "Serviço IBGE em manutenção",
    suggestion: "Tente novamente mais tarde.",
  },
};

export interface IbgeError {
  code?: number;
  message: string;
  tool: string;
  params?: Record<string, unknown>;
  suggestion?: string;
  relatedTools?: string[];
}

/**
 * Format a standardized error message
 */
export function formatError(error: IbgeError): string {
  const errorInfo = error.code ? IBGE_ERROR_CODES[error.code] : null;

  let output = `## Erro: ${error.tool}\n\n`;

  if (error.code) {
    output += `**Código HTTP:** ${error.code}\n`;
  }

  output += `**Mensagem:** ${errorInfo?.message || error.message}\n\n`;

  if (error.params && Object.keys(error.params).length > 0) {
    output += `### Parâmetros utilizados\n\n`;
    for (const [key, value] of Object.entries(error.params)) {
      if (value !== undefined) {
        output += `- **${key}:** ${value}\n`;
      }
    }
    output += "\n";
  }

  const suggestion = error.suggestion || errorInfo?.suggestion;
  if (suggestion) {
    output += `### Sugestão\n\n${suggestion}\n\n`;
  }

  if (error.relatedTools && error.relatedTools.length > 0) {
    output += `### Ferramentas relacionadas\n\n`;
    for (const tool of error.relatedTools) {
      output += `- \`${tool}\`\n`;
    }
  }

  return output;
}

/**
 * Parse HTTP error and return formatted message
 */
export function parseHttpError(
  error: Error,
  tool: string,
  params?: Record<string, unknown>,
  relatedTools?: string[]
): string {
  // Extract HTTP code from error message if present
  const httpMatch = error.message.match(/HTTP (\d+)/);
  const code = httpMatch ? parseInt(httpMatch[1]) : undefined;

  return formatError({
    code,
    message: error.message,
    tool,
    params,
    relatedTools,
  });
}

/**
 * Common validation errors
 */
export const ValidationErrors = {
  invalidCode: (code: string, tool: string, validFormats: string): string =>
    formatError({
      message: `Código inválido: "${code}"`,
      tool,
      suggestion: `Formatos aceitos:\n${validFormats}`,
    }),

  notFound: (item: string, tool: string, searchTool?: string): string =>
    formatError({
      message: `${item} não encontrado`,
      tool,
      suggestion: searchTool
        ? `Use ${searchTool} para buscar o item correto.`
        : "Verifique se o identificador está correto.",
    }),

  emptyResult: (tool: string, suggestion?: string): string =>
    formatError({
      message: "Nenhum dado encontrado",
      tool,
      suggestion: suggestion || "Tente ajustar os parâmetros de busca.",
    }),

  invalidPeriod: (period: string, tool: string, validPeriods?: string): string =>
    formatError({
      message: `Período inválido: "${period}"`,
      tool,
      suggestion: validPeriods
        ? `Períodos válidos: ${validPeriods}`
        : "Use 'last' para o último período disponível ou especifique um ano.",
    }),

  invalidTerritory: (level: string, tool: string): string =>
    formatError({
      message: `Nível territorial inválido: "${level}"`,
      tool,
      suggestion: `Níveis válidos: 1 (Brasil), 2 (Região), 3 (UF), 6 (Município), etc.
Use ibge_sidra_metadados para ver os níveis disponíveis para cada tabela.`,
    }),
};

/**
 * Timeout error handler
 */
export function timeoutError(tool: string, timeoutMs: number): string {
  return formatError({
    message: "Tempo de resposta excedido",
    tool,
    suggestion: `A requisição demorou mais de ${timeoutMs / 1000} segundos.
Tente novamente ou reduza o escopo da consulta (menos localidades ou períodos).`,
  });
}

/**
 * Network error handler
 */
export function networkError(tool: string): string {
  return formatError({
    message: "Erro de conexão",
    tool,
    suggestion: `Não foi possível conectar à API do IBGE.
Verifique sua conexão com a internet e tente novamente.`,
  });
}
