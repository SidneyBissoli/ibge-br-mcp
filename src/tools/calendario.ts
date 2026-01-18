import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, truncate, buildQueryString } from "../utils/index.js";

// Types for calendar data
interface CalendarioItem {
  id: number;
  titulo: string;
  descricao: string;
  data_inicio: string;
  data_fim: string;
  tipo_id: number;
  tipo: string;
  produto_id: number;
  produto: string;
  periodicidade_id: number;
  periodicidade: string;
  link: string;
}

interface CalendarioResponse {
  count: number;
  page: number;
  totalPages: number;
  items: CalendarioItem[];
}

export const calendarioSchema = z.object({
  de: z.string().optional().describe("Data inicial no formato MM-DD-AAAA (ex: '01-01-2024')"),
  ate: z.string().optional().describe("Data final no formato MM-DD-AAAA (ex: '12-31-2024')"),
  produto: z
    .string()
    .optional()
    .describe("Filtrar por produto/pesquisa (ex: 'IPCA', 'PNAD', 'PIB')"),
  tipo: z
    .enum(["divulgacao", "coleta", "todos"])
    .optional()
    .default("divulgacao")
    .describe(
      "Tipo de evento: 'divulgacao' (publicações), 'coleta' (pesquisas de campo), ou 'todos'"
    ),
  pagina: z.number().optional().default(1).describe("Número da página (padrão: 1)"),
  quantidade: z
    .number()
    .optional()
    .default(20)
    .describe("Quantidade de resultados por página (padrão: 20)"),
});

export type CalendarioInput = z.infer<typeof calendarioSchema>;

/**
 * Fetches IBGE release calendar
 */
export async function ibgeCalendario(input: CalendarioInput): Promise<string> {
  return withMetrics("ibge_calendario", "calendario", async () => {
    try {
      // Build URL with query parameters
      const tipoValue =
        input.tipo && input.tipo !== "todos"
          ? input.tipo === "divulgacao"
            ? "1"
            : "2"
          : undefined;

      const queryString = buildQueryString({
        de: input.de,
        ate: input.ate,
        busca: input.produto,
        tipo: tipoValue,
        page: input.pagina || 1,
        qtd: input.quantidade || 20,
      });

      const url = `${IBGE_API.CALENDARIO}?${queryString}`;
      const key = cacheKey("calendario", {
        de: input.de,
        ate: input.ate,
        produto: input.produto,
        tipo: input.tipo,
        pagina: input.pagina,
      });

      const data = await cachedFetch<CalendarioResponse>(url, key, CACHE_TTL.SHORT);

      if (!data.items || data.items.length === 0) {
        return formatNoResults(input);
      }

      return formatCalendarioResponse(data, input);
    } catch (error) {
      if (error instanceof Error) {
        return formatCalendarioError(error.message, input);
      }
      return "Erro desconhecido ao consultar calendário do IBGE.";
    }
  });
}

function formatCalendarioResponse(data: CalendarioResponse, input: CalendarioInput): string {
  let output = "## Calendário de Divulgações do IBGE\n\n";

  if (input.produto) {
    output += `**Filtro:** ${input.produto}\n`;
  }
  if (input.de || input.ate) {
    output += `**Período:** ${input.de || "início"} a ${input.ate || "atual"}\n`;
  }
  output += `**Total:** ${data.count} eventos | Página ${data.page} de ${data.totalPages}\n\n`;

  // Group by month for better readability
  const byMonth: Record<string, CalendarioItem[]> = {};

  for (const item of data.items) {
    const date = new Date(item.data_inicio);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[monthKey]) {
      byMonth[monthKey] = [];
    }
    byMonth[monthKey].push(item);
  }

  const monthNames: Record<string, string> = {
    "01": "Janeiro",
    "02": "Fevereiro",
    "03": "Março",
    "04": "Abril",
    "05": "Maio",
    "06": "Junho",
    "07": "Julho",
    "08": "Agosto",
    "09": "Setembro",
    "10": "Outubro",
    "11": "Novembro",
    "12": "Dezembro",
  };

  for (const [monthKey, items] of Object.entries(byMonth).sort()) {
    const [year, month] = monthKey.split("-");
    output += `### ${monthNames[month]} ${year}\n\n`;

    const rows = items.map((item) => {
      const startDate = new Date(item.data_inicio);
      const dateStr = `${String(startDate.getDate()).padStart(2, "0")}/${String(startDate.getMonth() + 1).padStart(2, "0")}`;
      const titulo = truncate(item.titulo, 40);
      const produto = item.produto || "-";
      const tipo = item.tipo === "Divulgação" ? "📊" : "📋";
      return [dateStr, produto, titulo, tipo];
    });

    output += createMarkdownTable(["Data", "Produto", "Título", "Tipo"], rows, {
      alignment: ["left", "left", "left", "left"],
    });
    output += "\n";
  }

  output += "---\n";
  output += "**Legenda:** 📊 Divulgação | 📋 Coleta\n";

  if (data.totalPages > data.page) {
    output += `\n_Use pagina=${data.page + 1} para ver mais resultados._\n`;
  }

  return output;
}

function formatNoResults(_input: CalendarioInput): string {
  let output = "## Calendário de Divulgações do IBGE\n\n";
  output += "Nenhum evento encontrado para os critérios informados.\n\n";

  output += "### Sugestões\n\n";
  output += "- Verifique o formato das datas (MM-DD-AAAA)\n";
  output += "- Tente um período maior\n";
  output += "- Remova o filtro de produto\n\n";

  output += "### Exemplos de uso\n\n";
  output += "```\n";
  output += "# Próximas divulgações\n";
  output += "ibge_calendario()\n\n";
  output += "# Divulgações do IPCA\n";
  output += 'ibge_calendario(produto="IPCA")\n\n';
  output += "# Calendário de 2024\n";
  output += 'ibge_calendario(de="01-01-2024", ate="12-31-2024")\n\n';
  output += "# Apenas coletas de campo\n";
  output += 'ibge_calendario(tipo="coleta")\n';
  output += "```\n";

  return output;
}

function formatCalendarioError(message: string, input: CalendarioInput): string {
  let output = "## Erro ao consultar calendário\n\n";
  output += `**Erro:** ${message}\n\n`;

  if (input.de || input.ate) {
    output += "**Dica:** Verifique se as datas estão no formato MM-DD-AAAA.\n";
  }

  return output;
}

// Tool definition for MCP
export const calendarioTool = {
  name: "ibge_calendario",
  description: `Consulta o calendário de divulgações e coletas do IBGE.

Funcionalidades:
- Lista próximas divulgações de pesquisas
- Filtra por produto (IPCA, PNAD, PIB, etc.)
- Filtra por período
- Diferencia divulgações e coletas de campo

Tipos de eventos:
- **Divulgação**: Publicação de resultados de pesquisas
- **Coleta**: Período de pesquisa de campo

Exemplos:
- Próximas divulgações: (sem parâmetros)
- Divulgações do IPCA: produto="IPCA"
- Calendário 2024: de="01-01-2024", ate="12-31-2024"
- Coletas de campo: tipo="coleta"`,
  inputSchema: calendarioSchema,
  handler: ibgeCalendario,
};
