import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, truncate } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import type { StructuredToolResult } from "../structured.js";
import { provenienciaIbge } from "../provenance.js";
import { casaBusca, expandirBusca, normalizar, notasDeVocabulario } from "../vocabulario.js";

// Schema for the tool input
export const sidraTabelasSchema = z.object({
  busca: z
    .string()
    .optional()
    .describe(
      "Termos para buscar no nome das tabelas/agregados (sem distinção de acento ou caixa; AND entre as palavras; a palavra de todo dia é traduzida para a do IBGE — renda→rendimento, desemprego→desocupação, cidade→município)"
    ),
  pesquisa: z
    .string()
    .optional()
    .describe("Filtrar por código ou nome da pesquisa (ex: 'censo', 'pnad', 'pib')"),
  limite: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe("Número máximo de resultados (padrão: 20)"),
});

export type SidraTabelasInput = z.infer<typeof sidraTabelasSchema>;

/** Structured output payload (validated against this schema by the MCP SDK). */
export const sidraTabelasOutputSchema = z.object({
  tabelas: z
    .array(
      z.object({
        codigo: z.string().describe("Código da tabela/agregado SIDRA"),
        nome: z.string().describe("Nome da tabela/agregado"),
        pesquisa: z.string().optional().describe("Pesquisa de origem (código - nome)"),
      })
    )
    .describe("Lista de tabelas SIDRA retornadas"),
  total: z.number().describe("Total de tabelas que correspondem aos critérios"),
  busca: z.string().optional().describe("Termo de busca aplicado, se houver"),
  pesquisa: z.string().optional().describe("Filtro de pesquisa aplicado, se houver"),
  notas_vocabulario: z
    .array(z.string())
    .optional()
    .describe(
      "Quando a busca foi ampliada para a palavra que o IBGE usa (renda→rendimento), diz qual"
    ),
});

interface AgregadoItem {
  id: string;
  nome: string;
}

interface PesquisaComAgregados {
  id: string;
  nome: string;
  agregados: AgregadoItem[];
}

/**
 * Lists and searches SIDRA tables (agregados)
 */
export async function ibgeSidraTabelas(input: SidraTabelasInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_sidra_tabelas", "agregados", async () => {
    try {
      const url = IBGE_API.AGREGADOS;

      // Use cache for SIDRA tables (24 hours TTL - static data)
      const key = cacheKey(url);
      const data = await cachedFetch<PesquisaComAgregados[]>(url, key, CACHE_TTL.STATIC);

      // Filter by pesquisa if specified (sem acento e caixa dos dois lados:
      // "censo" tem de achar "Censo Demográfico" e "populacao", "População").
      let filteredData = data;
      if (input.pesquisa) {
        const searchTerm = normalizar(input.pesquisa);
        filteredData = data.filter(
          (p) => normalizar(p.id).includes(searchTerm) || normalizar(p.nome).includes(searchTerm)
        );
      }

      // Collect all agregados with their pesquisa info
      let allAgregados: Array<{
        id: string;
        nome: string;
        pesquisaId: string;
        pesquisaNome: string;
      }> = [];

      for (const pesquisa of filteredData) {
        for (const agregado of pesquisa.agregados) {
          allAgregados.push({
            id: agregado.id,
            nome: agregado.nome,
            pesquisaId: pesquisa.id,
            pesquisaNome: pesquisa.nome,
          });
        }
      }

      // Filter by busca term if specified. Até a 5.0.1 era substring contígua,
      // sem tirar acento: "populacao" devolvia ZERO contra 520 nomes com
      // "população" (medido em 16/09/2026; src/vocabulario.ts). Agora os dois
      // lados são normalizados, as palavras casam em AND e cada uma vira um OR
      // das grafias que o IBGE usa para ela (renda → rendimento).
      const expandidos = input.busca ? expandirBusca(input.busca) : [];
      if (expandidos.length) {
        allAgregados = allAgregados.filter(
          (a) => casaBusca(normalizar(a.nome), expandidos) || casaBusca(a.id, expandidos)
        );
      }
      const notas = notasDeVocabulario(expandidos);

      // Apply limit
      const limited = allAgregados.slice(0, input.limite);

      if (limited.length === 0) {
        // Zero resultado sem explicação é beco sem saída: o catálogo é do IBGE
        // e usa o vocabulário dele. Dizer o que fazer em seguida é parte da resposta.
        return {
          markdown:
            input.busca || input.pesquisa
              ? `Nenhuma tabela encontrada para os critérios especificados.\n\n` +
                (notas.length ? notas.map((n) => `- ${n}\n`).join("") + "\n" : "") +
                "Todas as palavras precisam casar com o nome do agregado (acento e caixa não importam). " +
                "Tente menos palavras, ou a palavra que o IBGE usa: rendimento (não renda), desocupação " +
                "(não desemprego), domicílio (não moradia/casa), município (não cidade), sexo (não gênero), " +
                "cor ou raça (não negros), nascidos vivos (não natalidade), óbitos (não mortes), IPCA/INPC " +
                "(não inflação). Ou liste as pesquisas com `ibge_pesquisas` e filtre por `pesquisa`."
              : "Nenhuma tabela encontrada.",
          isError: true,
        };
      }

      const markdown = formatTabelasResponse(limited, allAgregados.length, input, notas);
      const structured: z.infer<typeof sidraTabelasOutputSchema> = {
        tabelas: limited.map((t) => ({
          codigo: t.id,
          nome: t.nome,
          pesquisa: `${t.pesquisaId} - ${t.pesquisaNome}`,
        })),
        total: allAgregados.length,
        ...(input.busca ? { busca: input.busca } : {}),
        ...(input.pesquisa ? { pesquisa: input.pesquisa } : {}),
        ...(notas.length ? { notas_vocabulario: notas } : {}),
      };

      return {
        markdown,
        structured,
        provenance: provenienciaIbge({
          fonte: "AGREGADOS",
          url,
          chaveCache: key,
          pesquisa: "API de Agregados (busca de tabelas SIDRA)",
        }),
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: parseHttpError(
            error,
            "ibge_sidra_tabelas",
            {
              busca: input.busca,
              pesquisa: input.pesquisa,
            },
            ["ibge_sidra_metadados", "ibge_sidra"]
          ),
          isError: true,
        };
      }
      return { markdown: ValidationErrors.emptyResult("ibge_sidra_tabelas"), isError: true };
    }
  });
}

function formatTabelasResponse(
  tabelas: Array<{
    id: string;
    nome: string;
    pesquisaId: string;
    pesquisaNome: string;
  }>,
  total: number,
  input: SidraTabelasInput,
  notas: readonly string[] = []
): string {
  let output = `## Tabelas SIDRA (Agregados)\n\n`;

  if (input.busca) {
    output += `**Busca:** "${input.busca}"\n`;
  }
  // A tradução de vocabulário é DITA: sem isto o resultado parece vir do que
  // o usuário escreveu.
  for (const nota of notas) {
    output += `**Vocabulário:** ${nota}\n`;
  }
  if (input.pesquisa) {
    output += `**Pesquisa:** "${input.pesquisa}"\n`;
  }

  output += `**Mostrando:** ${tabelas.length} de ${total} tabelas\n\n`;

  // Group by pesquisa
  const byPesquisa = new Map<string, typeof tabelas>();
  for (const t of tabelas) {
    const key = `${t.pesquisaId} - ${t.pesquisaNome}`;
    if (!byPesquisa.has(key)) {
      byPesquisa.set(key, []);
    }
    byPesquisa.get(key)?.push(t);
  }

  for (const [pesquisa, tabs] of byPesquisa) {
    output += `### ${pesquisa}\n\n`;

    const headers = ["Código", "Nome da Tabela"];
    const rows = tabs.map((t) => [t.id, truncate(t.nome, 70)]);

    output += createMarkdownTable(headers, rows, {
      alignment: ["right", "left"],
    });
    output += "\n";
  }

  output += "---\n\n";
  output += "_Use `ibge_sidra_metadados` com o código da tabela para ver detalhes._\n";
  output += "_Use `ibge_sidra` com o código da tabela para consultar os dados._\n";

  return output;
}
