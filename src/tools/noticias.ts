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
import type { StructuredToolResult } from "../structured.js";

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

/** Structured output payload (validated against this schema by the MCP SDK). */
export const noticiasOutputSchema = z.object({
  noticias: z
    .array(
      z.object({
        titulo: z.string().describe("Título da notícia ou release"),
        tipo: z.string().describe("Tipo de publicação (ex: 'Release' ou 'Notícia')"),
        dataPublicacao: z.string().describe("Data de publicação (formato original da API)"),
        editorias: z.string().optional().describe("Editoria(s) associada(s) à publicação"),
        produtos: z.string().optional().describe("Produtos do IBGE relacionados à publicação"),
        destaque: z.boolean().optional().describe("Indica se a publicação está em destaque"),
        introducao: z.string().optional().describe("Introdução/resumo da publicação (texto limpo)"),
        link: z.string().describe("URL para a publicação completa"),
      })
    )
    .describe("Lista de notícias retornadas"),
  total: z.number().describe("Total de notícias encontradas na consulta"),
  pagina: z.number().describe("Página atual"),
  totalPaginas: z.number().describe("Número total de páginas"),
  busca: z.string().optional().describe("Termo de busca aplicado, se houver"),
});

/**
 * Fetches news from IBGE API
 */
export async function ibgeNoticias(input: NoticiasInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_noticias", "noticias", async () => {
    try {
      let de: string | undefined;
      if (input.de) {
        const parsed = parseUserDate(input.de);
        if (!parsed) {
          return { markdown: ValidationErrors.invalidDate(input.de, "ibge_noticias"), isError: true };
        }
        de = toIbgeApiDate(parsed);
      }

      let ate: string | undefined;
      if (input.ate) {
        const parsed = parseUserDate(input.ate);
        if (!parsed) {
          return {
            markdown: ValidationErrors.invalidDate(input.ate, "ibge_noticias"),
            isError: true,
          };
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
        return {
          markdown: input.busca
            ? `Nenhuma notícia encontrada para: "${input.busca}"`
            : "Nenhuma notícia encontrada.",
          isError: true,
        };
      }

      const noticias = data.items.map((noticia) => ({
        titulo: noticia.titulo,
        tipo: noticia.tipo,
        dataPublicacao: noticia.data_publicacao,
        ...(noticia.editorias ? { editorias: noticia.editorias } : {}),
        ...(noticia.produtos && noticia.produtos !== "null" ? { produtos: noticia.produtos } : {}),
        ...(noticia.destaque !== undefined ? { destaque: noticia.destaque } : {}),
        ...(noticia.introducao
          ? { introducao: decodeHtmlEntities(noticia.introducao) }
          : {}),
        link: noticia.link,
      }));

      return {
        markdown: formatNoticiasResponse(data, input),
        structured: {
          noticias,
          total: data.count,
          pagina: data.page,
          totalPaginas: data.totalPages,
          ...(input.busca ? { busca: input.busca } : {}),
        },
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: parseHttpError(error, "ibge_noticias", { busca: input.busca }, [
            "ibge_calendario",
          ]),
          isError: true,
        };
      }
      return { markdown: ValidationErrors.emptyResult("ibge_noticias"), isError: true };
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
