import { z } from "zod";
import { IBGE_API, Pais, PaisIndicadorResultado } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, formatNumber } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";

// Schema for the tool input
export const paisesSchema = z.object({
  tipo: z
    .enum(["listar", "detalhes", "indicadores", "buscar"])
    .optional()
    .default("listar")
    .describe("Tipo de consulta: listar (todos), detalhes (de um país), indicadores, buscar"),
  pais: z.string().optional().describe("Código ISO-ALPHA-2 do país (ex: BR, US, AR) ou código M49"),
  busca: z.string().optional().describe("Termo de busca para filtrar países pelo nome"),
  indicadores: z
    .string()
    .optional()
    .describe("IDs dos indicadores separados por | (ex: 77819|77820)"),
  regiao: z
    .string()
    .optional()
    .describe("Filtrar por região/continente: americas, europa, africa, asia, oceania"),
});

export type PaisesInput = z.infer<typeof paisesSchema>;

// Mapeamento de regiões M49
const REGIOES_M49: Record<string, number> = {
  africa: 2,
  americas: 19,
  asia: 142,
  europa: 150,
  oceania: 9,
};

// Indicadores comuns de países
const INDICADORES_PAISES: Record<string, { id: number; nome: string }> = {
  populacao: { id: 77827, nome: "População total" },
  area: { id: 77819, nome: "Área territorial" },
  densidade: { id: 77828, nome: "Densidade demográfica" },
  pib: { id: 77821, nome: "PIB" },
  pib_per_capita: { id: 77823, nome: "PIB per capita" },
  idh: { id: 77830, nome: "IDH" },
  expectativa_vida: { id: 77831, nome: "Expectativa de vida" },
  mortalidade_infantil: { id: 77832, nome: "Mortalidade infantil" },
};

/**
 * Consulta dados de países via IBGE API
 */
export async function ibgePaises(input: PaisesInput): Promise<string> {
  return withMetrics("ibge_paises", "paises", async () => {
    try {
      switch (input.tipo) {
        case "listar":
          return await listarPaises(input.busca, input.regiao);
        case "detalhes":
          if (!input.pais) {
            return ValidationErrors.invalidCode(
              "",
              "ibge_paises",
              "Informe o código ISO-ALPHA-2 do país (ex: BR, US, AR)"
            );
          }
          return await detalhesPais(input.pais);
        case "indicadores":
          return await listarIndicadores();
        case "buscar":
          if (!input.busca) {
            return ValidationErrors.emptyResult(
              "ibge_paises",
              "Informe um termo de busca para encontrar países"
            );
          }
          return await listarPaises(input.busca, input.regiao);
        default:
          return await listarPaises(input.busca, input.regiao);
      }
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(error, "ibge_paises", {
          tipo: input.tipo,
          pais: input.pais,
          busca: input.busca,
        });
      }
      return ValidationErrors.emptyResult("ibge_paises");
    }
  });
}

async function listarPaises(busca?: string, regiao?: string): Promise<string> {
  const url = `${IBGE_API.PAISES}`;
  const key = cacheKey(url);

  const paises = await cachedFetch<Pais[]>(url, key, CACHE_TTL.STATIC);

  if (!paises || paises.length === 0) {
    return ValidationErrors.emptyResult("ibge_paises");
  }

  let resultado = paises;

  // Filtrar por região se especificado
  if (regiao) {
    const regiaoNormalizada = regiao.toLowerCase();
    const regiaoId = REGIOES_M49[regiaoNormalizada];
    if (regiaoId) {
      resultado = resultado.filter((p) => p.localizacao?.regiao?.id === regiaoId);
    }
  }

  // Filtrar por busca se especificado
  if (busca) {
    const buscaNormalizada = busca.toLowerCase();
    resultado = resultado.filter((p) => p.nome.toLowerCase().includes(buscaNormalizada));
  }

  if (resultado.length === 0) {
    return ValidationErrors.emptyResult(
      "ibge_paises",
      busca ? `Nenhum país encontrado para "${busca}"` : "Nenhum país encontrado"
    );
  }

  let output = `## Países${busca ? ` - Busca: "${busca}"` : ""}${regiao ? ` - Região: ${regiao}` : ""}\n\n`;
  output += `**Total:** ${resultado.length} países\n\n`;

  const rows = resultado
    .slice(0, 50)
    .map((p) => [
      p.id["ISO-ALPHA-2"] || "-",
      p.nome,
      p.localizacao?.regiao?.nome || "-",
      p.localizacao?.["sub-regiao"]?.nome || "-",
    ]);

  output += createMarkdownTable(["Código", "País", "Região", "Sub-região"], rows, {
    alignment: ["center", "left", "left", "left"],
  });

  if (resultado.length > 50) {
    output += `\n_Mostrando 50 de ${resultado.length} países. Use o parâmetro 'busca' para filtrar._\n`;
  }

  return output;
}

async function detalhesPais(codigoPais: string): Promise<string> {
  const url = `${IBGE_API.PAISES}/${codigoPais.toUpperCase()}`;
  const key = cacheKey(url);

  const paises = await cachedFetch<Pais[]>(url, key, CACHE_TTL.STATIC);

  if (!paises || paises.length === 0) {
    return ValidationErrors.notFound(
      `País com código "${codigoPais}"`,
      "ibge_paises",
      "ibge_paises tipo='listar'"
    );
  }

  const pais = paises[0];

  let output = `## ${pais.nome}\n\n`;

  output += "### Identificação\n\n";
  output += `- **Código M49:** ${pais.id.M49}\n`;
  output += `- **ISO Alpha-2:** ${pais.id["ISO-ALPHA-2"]}\n`;
  output += `- **ISO Alpha-3:** ${pais.id["ISO-ALPHA-3"]}\n\n`;

  if (pais.localizacao) {
    output += "### Localização\n\n";
    output += `- **Região:** ${pais.localizacao.regiao?.nome || "-"}\n`;
    if (pais.localizacao["sub-regiao"]) {
      output += `- **Sub-região:** ${pais.localizacao["sub-regiao"].nome}\n`;
    }
    if (pais.localizacao["regiao-intermediaria"]) {
      output += `- **Região Intermediária:** ${pais.localizacao["regiao-intermediaria"].nome}\n`;
    }
    output += "\n";
  }

  if (pais.area?.total) {
    output += "### Área\n\n";
    output += `- **Área total:** ${formatNumber(parseFloat(pais.area.total))} km²\n\n`;
  }

  if (pais.linguas && pais.linguas.length > 0) {
    output += "### Línguas\n\n";
    pais.linguas.forEach((lingua) => {
      output += `- ${lingua.nome}\n`;
    });
    output += "\n";
  }

  if (pais["unidades-monetarias"] && pais["unidades-monetarias"].length > 0) {
    output += "### Moeda\n\n";
    pais["unidades-monetarias"].forEach((moeda) => {
      output += `- ${moeda.nome} (${moeda.id})\n`;
    });
    output += "\n";
  }

  if (pais.historico) {
    output += "### Histórico\n\n";
    output += pais.historico + "\n\n";
  }

  // Tentar buscar indicadores principais
  try {
    const indicadoresUrl = `${IBGE_API.PAISES}/${codigoPais.toUpperCase()}/indicadores/77827|77821|77823|77830`;
    const indicadoresKey = cacheKey(indicadoresUrl);
    const indicadores = await cachedFetch<PaisIndicadorResultado[]>(
      indicadoresUrl,
      indicadoresKey,
      CACHE_TTL.MEDIUM
    );

    if (indicadores && indicadores.length > 0) {
      output += "### Indicadores\n\n";
      for (const ind of indicadores) {
        if (ind.series && ind.series.length > 0) {
          const serie = ind.series[0].serie;
          const anos = Object.keys(serie).sort().reverse();
          const ultimoAno = anos[0];
          const valor = serie[ultimoAno];
          if (valor !== null && valor !== undefined && valor !== "-") {
            output += `- **${ind.indicador}:** ${valor} (${ultimoAno})\n`;
          }
        }
      }
      output += "\n";
    }
  } catch {
    // Ignorar erro ao buscar indicadores
  }

  output += "### Ferramentas Relacionadas\n\n";
  output += "- Use `ibge_paises tipo='indicadores'` para ver indicadores disponíveis\n";
  output += "- Use `ibge_paises tipo='listar' regiao='americas'` para ver países da mesma região\n";

  return output;
}

async function listarIndicadores(): Promise<string> {
  let output = "## Indicadores de Países Disponíveis\n\n";
  output += "Os seguintes indicadores podem ser consultados para qualquer país:\n\n";

  const rows = Object.entries(INDICADORES_PAISES).map(([key, info]) => [
    String(info.id),
    info.nome,
    key,
  ]);

  output += createMarkdownTable(["ID", "Indicador", "Alias"], rows, {
    alignment: ["center", "left", "left"],
  });

  output += "\n### Exemplo de Uso\n\n";
  output += "```\n";
  output += 'ibge_paises tipo="detalhes" pais="BR"\n';
  output += 'ibge_paises tipo="listar" regiao="americas"\n';
  output += 'ibge_paises tipo="buscar" busca="Argentina"\n';
  output += "```\n";

  return output;
}

// Tool definition for MCP
export const paisesTool = {
  name: "ibge_paises",
  description: `Consulta dados de países e territórios internacionais via IBGE.

Funcionalidades:
- Lista todos os países (seguindo metodologia M49 da ONU)
- Detalhes de um país específico (área, línguas, moeda, localização)
- Busca países por nome
- Filtra por região/continente

Regiões disponíveis: americas, europa, africa, asia, oceania

Códigos de países: Use ISO-ALPHA-2 (ex: BR, US, AR, PT, JP)

Exemplos:
- Listar todos: tipo="listar"
- Detalhes do Brasil: tipo="detalhes", pais="BR"
- Buscar: tipo="buscar", busca="Argentina"
- Países da América: tipo="listar", regiao="americas"`,
  inputSchema: paisesSchema,
  handler: ibgePaises,
};
