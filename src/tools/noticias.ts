import { z } from "zod";
import { IBGE_API, type NoticiasResponse, type Noticia } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import {
  decodeHtmlEntities,
  formatDate as formatDateUtil,
  buildQueryString,
} from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import { parseUserDate, toIbgeApiDate } from "../validation.js";

// Schema for the tool input
export const noticiasSchema = z.object({
  busca: z.string().optional().describe("Termo para buscar nas notícias"),
  quantidade: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(10)
    .describe("Quantidade de notícias a retornar (padrão: 10, máximo: 100)"),
  pagina: z.number().min(1).optional().default(1).describe("Número da página para paginação"),
  de: z.string().optional().describe("Data inicial no formato DD/MM/AAAA (ex: 01/01/2024)"),
  ate: z.string().optional().describe("Data final no formato DD/MM/AAAA (ex: 31/12/2024)"),
  tipo: z
    .enum(["release", "noticia"])
    .optional()
    .describe("Tipo de publicação: 'release' ou 'noticia'"),
  destaque: z.boolean().optional().describe("Filtrar apenas notícias em destaque"),
});

export type NoticiasInput = z.infer<typeof noticiasSchema>;

/**
 * Fetches news from IBGE API
 */
export async function ibgeNoticias(input: NoticiasInput): Promise<string> {
  return withMetrics("ibge_noticias", "noticias", async () => {
    try {
      let de: string | undefined;
      if (input.de) {
        const parsed = parseUserDate(input.de);
        if (!parsed) {
          return ValidationErrors.invalidDate(input.de, "ibge_noticias");
        }
        de = toIbgeApiDate(parsed);
      }

      let ate: string | undefined;
      if (input.ate) {
        const parsed = parseUserDate(input.ate);
        if (!parsed) {
          return ValidationErrors.invalidDate(input.ate, "ibge_noticias");
        }
        ate = toIbgeApiDate(parsed);
      }

      const queryString = buildQueryString({
        qtd: input.quantidade || 10,
        page: input.pagina || 1,
        busca: input.busca,
        de,
        ate,
        tipo: input.tipo,
        destaque: input.destaque !== undefined ? (input.destaque ? "1" : "0") : undefined,
      });

      const url = `${IBGE_API.NOTICIAS}?${queryString}`;

      // Use cache for news data (5 minutes TTL - news updates frequently)
      const key = cacheKey(url);
      const data = await cachedFetch<NoticiasResponse>(url, key, CACHE_TTL.SHORT);

      if (!data.items || data.items.length === 0) {
        return input.busca
          ? `Nenhuma notícia encontrada para: "${input.busca}"`
          : "Nenhuma notícia encontrada.";
      }

      return formatNoticiasResponse(data, input);
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(error, "ibge_noticias", { busca: input.busca }, ["ibge_calendario"]);
      }
      return ValidationErrors.emptyResult("ibge_noticias");
    }
  });
}

function formatNoticiasResponse(data: NoticiasResponse, input: NoticiasInput): string {
  let output = `## Notícias e Releases do IBGE\n\n`;

  if (input.busca) {
    output += `**Busca:** "${input.busca}"\n`;
  }

  output += `**Total:** ${data.count} notícias encontradas\n`;
  output += `**Página:** ${data.page} de ${data.totalPages}\n`;
  output += `**Mostrando:** ${data.showingFrom} a ${data.showingTo}\n\n`;

  output += "---\n\n";

  for (const noticia of data.items) {
    output += formatNoticia(noticia);
    output += "\n---\n\n";
  }

  // Pagination info
  if (data.totalPages > 1) {
    output += `_Página ${data.page} de ${data.totalPages}. `;
    if (data.nextPage) {
      output += `Use pagina=${data.nextPage} para a próxima página.`;
    }
    output += "_\n";
  }

  return output;
}

function formatNoticia(noticia: Noticia): string {
  let output = "";

  // Title with type badge
  const tipoBadge = noticia.tipo === "Release" ? "📢" : "📰";
  output += `### ${tipoBadge} ${noticia.titulo}\n\n`;

  // Publication date
  output += `**Data:** ${formatDateUtil(noticia.data_publicacao, { format: "long" })}\n`;

  // Category/editorias
  if (noticia.editorias) {
    output += `**Editoria:** ${noticia.editorias}\n`;
  }

  // Products
  if (noticia.produtos && noticia.produtos !== "null") {
    output += `**Produtos:** ${noticia.produtos}\n`;
  }

  // Highlight badge
  if (noticia.destaque) {
    output += `**⭐ Destaque**\n`;
  }

  output += "\n";

  // Introduction/summary
  if (noticia.introducao) {
    // Clean HTML tags and entities using centralized utility
    const intro = decodeHtmlEntities(noticia.introducao);
    output += `${intro}\n\n`;
  }

  // Link
  output += `🔗 [Leia mais](${noticia.link})\n`;

  return output;
}
