import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, createKeyValueTable, truncate } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";

// Schema for the tool input
export const sidraMetadadosSchema = z.object({
  tabela: z.string().describe("Código da tabela/agregado SIDRA (ex: '6579', '9514', '4714')"),
  incluir_periodos: z
    .boolean()
    .optional()
    .default(true)
    .describe("Incluir lista de períodos disponíveis (padrão: true)"),
  incluir_localidades: z
    .boolean()
    .optional()
    .default(false)
    .describe("Incluir níveis territoriais disponíveis (padrão: false)"),
});

export type SidraMetadadosInput = z.infer<typeof sidraMetadadosSchema>;

interface Metadados {
  id: string;
  nome: string;
  URL: string;
  pesquisa: string;
  assunto: string;
  periodicidade: {
    frequencia: string;
    inicio: number;
    fim: number;
  };
  nivelTerritorial: {
    Administrativo?: string[];
    Especial?: string[];
    IBGE?: string[];
  };
  variaveis: VariavelMetadados[];
}

interface VariavelMetadados {
  id: number;
  nome: string;
  unidade: string;
  supimaId?: number;
  classificacoes?: ClassificacaoMetadados[];
}

interface ClassificacaoMetadados {
  id: number;
  nome: string;
  categorias: CategoriaMetadados[];
}

interface CategoriaMetadados {
  id: number;
  nome: string;
  unidade?: string;
  nivel?: number;
}

interface Periodo {
  id: string;
  literals: string[];
  modificacao: string;
}

/**
 * Fetches metadata for a SIDRA table
 */
export async function ibgeSidraMetadados(input: SidraMetadadosInput): Promise<string> {
  return withMetrics("ibge_sidra_metadados", "agregados", async () => {
    try {
      // Fetch main metadata with cache (24 hours TTL - static data)
      const metadadosUrl = `${IBGE_API.AGREGADOS}/${input.tabela}/metadados`;
      const metadadosKey = cacheKey(metadadosUrl);
      let metadados: Metadados;

      try {
        metadados = await cachedFetch<Metadados>(metadadosUrl, metadadosKey, CACHE_TTL.STATIC);
      } catch (error) {
        if (error instanceof Error && error.message.includes("404")) {
          return `Tabela ${input.tabela} não encontrada. Use ibge_sidra_tabelas para listar tabelas disponíveis.`;
        }
        throw error;
      }

      // Fetch periods if requested with cache
      let periodos: Periodo[] = [];
      if (input.incluir_periodos) {
        try {
          const periodosUrl = `${IBGE_API.AGREGADOS}/${input.tabela}/periodos`;
          const periodosKey = cacheKey(periodosUrl);
          periodos = await cachedFetch<Periodo[]>(periodosUrl, periodosKey, CACHE_TTL.STATIC);
        } catch {
          // Ignore period fetch errors
        }
      }

      return formatMetadadosResponse(metadados, periodos, input);
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(error, "ibge_sidra_metadados", { tabela: input.tabela }, [
          "ibge_sidra_tabelas",
        ]);
      }
      return ValidationErrors.emptyResult("ibge_sidra_metadados");
    }
  });
}

function formatMetadadosResponse(
  meta: Metadados,
  periodos: Periodo[],
  _input: SidraMetadadosInput
): string {
  let output = `## Metadados da Tabela ${meta.id}\n\n`;

  // Basic info
  output += `### Informações Gerais\n\n`;
  output += createKeyValueTable({
    "**Código**": meta.id,
    "**Nome**": truncate(meta.nome, 80),
    "**Pesquisa**": meta.pesquisa,
    "**Assunto**": meta.assunto,
    "**Periodicidade**": meta.periodicidade.frequencia,
    "**Período**": `${meta.periodicidade.inicio} a ${meta.periodicidade.fim}`,
    "**URL**": meta.URL,
  });
  output += "\n";

  // Territorial levels
  output += `### Níveis Territoriais Disponíveis\n\n`;

  const niveis: { [key: string]: string } = {
    N1: "Brasil",
    N2: "Grande Região",
    N3: "Unidade da Federação",
    N6: "Município",
    N7: "Região Metropolitana",
    N8: "Mesorregião",
    N9: "Microrregião",
    N10: "Distrito",
    N11: "Subdistrito",
    N13: "Região Metropolitana e RIDE",
    N14: "Região Integrada de Desenvolvimento",
    N15: "Aglomeração Urbana",
    N17: "Região Geográfica Imediata",
    N18: "Região Geográfica Intermediária",
    N101: "País do Mercosul, Bolívia e Chile",
    N102: "Município do Mercosul, Bolívia e Chile",
    N103: "UF do Mercosul, Bolívia e Chile",
    N104: "Aglomerado Subnormal",
    N105: "Macrorregião de Saúde",
    N106: "Região de Saúde",
    N107: "Bacia Hidrográfica",
    N108: "Sub-bacia Hidrográfica",
  };

  const allNiveis = [
    ...(meta.nivelTerritorial.Administrativo || []),
    ...(meta.nivelTerritorial.Especial || []),
    ...(meta.nivelTerritorial.IBGE || []),
  ];

  if (allNiveis.length > 0) {
    const rows = allNiveis.map((nivel) => [nivel, niveis[nivel] || nivel]);
    output += createMarkdownTable(["Código", "Nível"], rows, {
      alignment: ["left", "left"],
    });
    output += "\n";
  } else {
    output += "_Informação não disponível_\n\n";
  }

  // Variables
  output += `### Variáveis\n\n`;
  if (meta.variaveis && meta.variaveis.length > 0) {
    const variaveisRows = meta.variaveis.map((v) => [
      String(v.id),
      truncate(v.nome, 60),
      v.unidade || "-",
    ]);
    output += createMarkdownTable(["ID", "Nome", "Unidade"], variaveisRows, {
      alignment: ["right", "left", "left"],
    });
    output += "\n";

    // Classifications for each variable
    for (const v of meta.variaveis) {
      if (v.classificacoes && v.classificacoes.length > 0) {
        output += `#### Classificações da Variável ${v.id} (${truncate(v.nome, 40)})\n\n`;
        for (const c of v.classificacoes) {
          output += `**${c.id} - ${c.nome}:**\n`;
          if (c.categorias.length <= 20) {
            const catRows = c.categorias.map((cat) => [String(cat.id), truncate(cat.nome, 60)]);
            output += createMarkdownTable(["ID", "Categoria"], catRows, {
              alignment: ["right", "left"],
            });
          } else {
            output += `_${c.categorias.length} categorias disponíveis. Primeiras 10:_\n`;
            const catRows = c.categorias
              .slice(0, 10)
              .map((cat) => [String(cat.id), truncate(cat.nome, 60)]);
            catRows.push(["...", `_e mais ${c.categorias.length - 10} categorias_`]);
            output += createMarkdownTable(["ID", "Categoria"], catRows, {
              alignment: ["right", "left"],
            });
          }
          output += "\n";
        }
      }
    }
  } else {
    output += "_Nenhuma variável encontrada_\n\n";
  }

  // Periods
  if (periodos.length > 0) {
    output += `### Períodos Disponíveis\n\n`;

    // Show a summary if too many periods
    if (periodos.length > 20) {
      const first5 = periodos.slice(0, 5);
      const last5 = periodos.slice(-5);

      output += `_${periodos.length} períodos disponíveis:_\n\n`;
      output += "**Primeiros períodos:**\n";
      for (const p of first5) {
        output += `- ${p.id}: ${p.literals.join(", ")}\n`;
      }
      output += "\n**Últimos períodos:**\n";
      for (const p of last5) {
        output += `- ${p.id}: ${p.literals.join(", ")}\n`;
      }
    } else {
      for (const p of periodos) {
        output += `- ${p.id}: ${p.literals.join(", ")}\n`;
      }
    }
    output += "\n";
  }

  // Usage hint
  output += `---\n\n`;
  output += `### Como usar esta tabela\n\n`;
  output += "```\n";
  output += `ibge_sidra(\n`;
  output += `  tabela="${meta.id}",\n`;
  output += `  variaveis="allxp",           // todas as variáveis\n`;
  output += `  nivel_territorial="1",        // 1=Brasil, 3=UF, 6=Município\n`;
  output += `  localidades="all",            // todas do nível\n`;
  output += `  periodos="last"               // último período\n`;
  output += `)\n`;
  output += "```\n";

  return output;
}

// Tool definition for MCP
export const sidraMetadadosTool = {
  name: "ibge_sidra_metadados",
  description: `Retorna os metadados de uma tabela SIDRA específica.

Funcionalidades:
- Informações gerais (nome, pesquisa, assunto, periodicidade)
- Níveis territoriais disponíveis (Brasil, UF, município, etc.)
- Lista de variáveis com unidades
- Classificações e categorias de cada variável
- Períodos disponíveis

Use esta ferramenta para entender a estrutura de uma tabela
ANTES de consultar os dados com ibge_sidra.

Exemplos de uso:
- Metadados da tabela de população: tabela="6579"
- Metadados do Censo 2022: tabela="9514"
- Metadados da PNAD (desocupação): tabela="4714"
- Sem períodos: tabela="6579", incluir_periodos=false`,
  inputSchema: sidraMetadadosSchema,
  handler: ibgeSidraMetadados,
};
