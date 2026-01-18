import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, truncate } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";

// Schema for the tool input
export const sidraTabelasSchema = z.object({
  busca: z.string().optional().describe("Termo para buscar no nome das tabelas/agregados"),
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
export async function ibgeSidraTabelas(input: SidraTabelasInput): Promise<string> {
  return withMetrics("ibge_sidra_tabelas", "agregados", async () => {
    try {
      const url = IBGE_API.AGREGADOS;

      // Use cache for SIDRA tables (24 hours TTL - static data)
      const key = cacheKey(url);
      const data = await cachedFetch<PesquisaComAgregados[]>(url, key, CACHE_TTL.STATIC);

      // Filter by pesquisa if specified
      let filteredData = data;
      if (input.pesquisa) {
        const searchTerm = input.pesquisa.toLowerCase();
        filteredData = data.filter(
          (p) =>
            p.id.toLowerCase().includes(searchTerm) || p.nome.toLowerCase().includes(searchTerm)
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

      // Filter by busca term if specified
      if (input.busca) {
        const searchTerm = input.busca.toLowerCase();
        allAgregados = allAgregados.filter(
          (a) => a.id.includes(searchTerm) || a.nome.toLowerCase().includes(searchTerm)
        );
      }

      // Apply limit
      const limited = allAgregados.slice(0, input.limite);

      if (limited.length === 0) {
        return input.busca || input.pesquisa
          ? `Nenhuma tabela encontrada para os critérios especificados.`
          : "Nenhuma tabela encontrada.";
      }

      return formatTabelasResponse(limited, allAgregados.length, input);
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(error, "ibge_sidra_tabelas", {
          busca: input.busca,
          pesquisa: input.pesquisa,
        });
      }
      return ValidationErrors.emptyResult("ibge_sidra_tabelas");
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
  input: SidraTabelasInput
): string {
  let output = `## Tabelas SIDRA (Agregados)\n\n`;

  if (input.busca) {
    output += `**Busca:** "${input.busca}"\n`;
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

// Tool definition for MCP
export const sidraTabelasTool = {
  name: "ibge_sidra_tabelas",
  description: `Lista e busca tabelas disponíveis no SIDRA (Sistema IBGE de Recuperação Automática).

Funcionalidades:
- Lista todas as tabelas (agregados) do SIDRA
- Busca por termo no nome da tabela
- Filtra por pesquisa (Censo, PNAD, PIB, etc.)
- Mostra o código e nome de cada tabela

O SIDRA contém dados de diversas pesquisas:
- Censo Demográfico
- PNAD Contínua (emprego, renda)
- Contas Nacionais (PIB)
- Pesquisa Industrial
- Pesquisa Agrícola
- E muitas outras

Exemplos de uso:
- Listar tabelas: (sem parâmetros)
- Buscar tabelas de população: busca="população"
- Tabelas do Censo: pesquisa="censo"
- Tabelas de emprego: busca="desocupação"`,
  inputSchema: sidraTabelasSchema,
  handler: ibgeSidraTabelas,
};
