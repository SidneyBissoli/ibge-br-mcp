import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, truncate } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";

// Schema for the tool input
export const pesquisasSchema = z.object({
  busca: z.string().optional().describe("Termo para buscar no nome ou ID da pesquisa"),
  detalhes: z
    .string()
    .optional()
    .describe("Código da pesquisa para ver detalhes e tabelas disponíveis"),
});

export type PesquisasInput = z.infer<typeof pesquisasSchema>;

interface AgregadoSimples {
  id: string;
  nome: string;
}

interface PesquisaCompleta {
  id: string;
  nome: string;
  agregados: AgregadoSimples[];
}

/**
 * Lists IBGE surveys (pesquisas)
 */
export async function ibgePesquisas(input: PesquisasInput): Promise<string> {
  return withMetrics("ibge_pesquisas", "agregados", async () => {
    try {
      const url = IBGE_API.AGREGADOS;

      // Use cache for surveys data (24 hours TTL - static data)
      const key = cacheKey(url);
      const data = await cachedFetch<PesquisaCompleta[]>(url, key, CACHE_TTL.STATIC);

      // If detalhes is specified, show details of a specific pesquisa
      if (input.detalhes) {
        const detalhes = input.detalhes;
        const pesquisa = data.find(
          (p) =>
            p.id.toLowerCase() === detalhes.toLowerCase() ||
            p.nome.toLowerCase().includes(detalhes.toLowerCase())
        );

        if (!pesquisa) {
          return `Pesquisa "${input.detalhes}" não encontrada. Use ibge_pesquisas() sem parâmetros para listar todas.`;
        }

        return formatPesquisaDetalhes(pesquisa);
      }

      // Filter by busca if specified
      let filtered = data;
      if (input.busca) {
        const searchTerm = input.busca.toLowerCase();
        filtered = data.filter(
          (p) =>
            p.id.toLowerCase().includes(searchTerm) || p.nome.toLowerCase().includes(searchTerm)
        );
      }

      if (filtered.length === 0) {
        return input.busca
          ? `Nenhuma pesquisa encontrada para: "${input.busca}"`
          : "Nenhuma pesquisa encontrada.";
      }

      return formatPesquisasLista(filtered, input);
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(error, "ibge_pesquisas", { busca: input.busca });
      }
      return ValidationErrors.emptyResult("ibge_pesquisas");
    }
  });
}

function formatPesquisasLista(pesquisas: PesquisaCompleta[], input: PesquisasInput): string {
  let output = `## Pesquisas do IBGE\n\n`;

  if (input.busca) {
    output += `**Busca:** "${input.busca}"\n`;
  }

  output += `**Total:** ${pesquisas.length} pesquisas\n\n`;

  // Summary table using createMarkdownTable
  const headers = ["Código", "Pesquisa", "Tabelas"];
  const rows = pesquisas.map((p) => [p.id, truncate(p.nome, 60), p.agregados.length]);

  output += createMarkdownTable(headers, rows, {
    alignment: ["left", "left", "right"],
  });

  output += "\n---\n\n";

  // Category groups (common prefixes)
  const categorias = categorizarPesquisas(pesquisas);
  if (Object.keys(categorias).length > 1) {
    output += "### Pesquisas por Categoria\n\n";
    for (const [categoria, items] of Object.entries(categorias)) {
      output += `**${categoria}:** ${items.length} pesquisas\n`;
    }
    output += "\n";
  }

  output += '_Use `ibge_pesquisas(detalhes="CODIGO")` para ver as tabelas de uma pesquisa._\n';
  output += '_Use `ibge_sidra_tabelas(pesquisa="CODIGO")` para buscar tabelas específicas._\n';

  return output;
}

function formatPesquisaDetalhes(pesquisa: PesquisaCompleta): string {
  let output = `## Pesquisa: ${pesquisa.nome}\n\n`;

  output += `**Código:** ${pesquisa.id}\n`;
  output += `**Total de tabelas:** ${pesquisa.agregados.length}\n\n`;

  // List all tables using createMarkdownTable
  output += "### Tabelas Disponíveis\n\n";

  const headers = ["Código", "Nome da Tabela"];
  const rows = pesquisa.agregados.map((ag) => [ag.id, truncate(ag.nome, 70)]);

  output += createMarkdownTable(headers, rows, {
    alignment: ["right", "left"],
  });

  output += "\n---\n\n";
  output += '_Use `ibge_sidra_metadados(tabela="CODIGO")` para ver detalhes de uma tabela._\n';
  output += '_Use `ibge_sidra(tabela="CODIGO")` para consultar os dados._\n';

  return output;
}

function categorizarPesquisas(pesquisas: PesquisaCompleta[]): Record<string, PesquisaCompleta[]> {
  const categorias: Record<string, PesquisaCompleta[]> = {};

  const keywords: Record<string, string[]> = {
    Censos: ["censo", "contagem"],
    "Trabalho e Renda": ["pnad", "trabalho", "emprego", "rendimento", "ocupação"],
    Economia: ["pib", "contas", "produção", "industrial", "comércio", "serviços"],
    Agropecuária: ["agrícola", "agropecuária", "pecuária", "safra", "abate"],
    Preços: ["preço", "inflação", "ipca", "inpc", "custo"],
    Saúde: ["saúde", "pns"],
    Educação: ["educação", "ensino"],
    Demografia: ["população", "natalidade", "mortalidade", "nupcialidade"],
    Outras: [],
  };

  for (const p of pesquisas) {
    const nomeLower = p.nome.toLowerCase();
    let categorized = false;

    for (const [cat, terms] of Object.entries(keywords)) {
      if (cat === "Outras") continue;
      if (terms.some((t) => nomeLower.includes(t))) {
        if (!categorias[cat]) categorias[cat] = [];
        categorias[cat].push(p);
        categorized = true;
        break;
      }
    }

    if (!categorized) {
      if (!categorias["Outras"]) categorias["Outras"] = [];
      categorias["Outras"].push(p);
    }
  }

  // Remove empty categories
  for (const key of Object.keys(categorias)) {
    if (categorias[key].length === 0) {
      delete categorias[key];
    }
  }

  return categorias;
}

// Tool definition for MCP
export const pesquisasTool = {
  name: "ibge_pesquisas",
  description: `Lista as pesquisas disponíveis no IBGE e suas tabelas.

Funcionalidades:
- Lista todas as pesquisas do IBGE (Censos, PNAD, PIB, etc.)
- Busca por nome ou código da pesquisa
- Mostra detalhes e tabelas de uma pesquisa específica
- Categoriza pesquisas por tema

Principais pesquisas:
- **Censos**: Demográfico, Agropecuário, MUNIC
- **PNAD Contínua**: Trabalho, renda, educação
- **Contas Nacionais**: PIB, investimentos
- **Pesquisas Econômicas**: Indústria, Comércio, Serviços
- **Pesquisas Agropecuárias**: Produção, safras, abate
- **Índices de Preços**: IPCA, INPC, custos

Exemplos de uso:
- Listar todas as pesquisas: (sem parâmetros)
- Buscar pesquisas de população: busca="população"
- Detalhes da PNAD: detalhes="pnad"
- Detalhes do Censo: detalhes="CD"`,
  inputSchema: pesquisasSchema,
  handler: ibgePesquisas,
};
