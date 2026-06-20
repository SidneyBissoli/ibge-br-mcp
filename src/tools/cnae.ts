import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, truncate } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";
import { isValidCnaeCode, formatValidationError } from "../validation.js";
import type { StructuredToolResult } from "../structured.js";

// Types for CNAE data
interface CnaeSecao {
  id: string;
  descricao: string;
  observacoes?: string[];
}

interface CnaeDivisao {
  id: string;
  descricao: string;
  secao: CnaeSecao;
  observacoes?: string[];
}

interface CnaeGrupo {
  id: string;
  descricao: string;
  divisao: CnaeDivisao;
  observacoes?: string[];
}

interface CnaeClasse {
  id: string;
  descricao: string;
  grupo: CnaeGrupo;
  observacoes?: string[];
}

interface CnaeSubclasse {
  id: string;
  descricao: string;
  classe: CnaeClasse;
  observacoes?: string[];
}

export const cnaeSchema = z.object({
  codigo: z.string().optional()
    .describe(`Código CNAE para buscar (seção, divisão, grupo, classe ou subclasse).
Exemplos:
- Seção: "A" (agricultura)
- Divisão: "01" (agricultura e pecuária)
- Grupo: "01.1" (produção de lavouras)
- Classe: "01.11" (cultivo de cereais)
- Subclasse: "0111-3/01" (cultivo de arroz)`),
  busca: z
    .string()
    .optional()
    .describe(
      "Termo para buscar na descrição das atividades (ex: 'software', 'restaurante', 'comércio')"
    ),
  nivel: z
    .enum(["secoes", "divisoes", "grupos", "classes", "subclasses"])
    .optional()
    .describe("Nível hierárquico para listar (padrão: mostra todos os níveis relevantes)"),
  limite: z.number().optional().default(20).describe("Número máximo de resultados (padrão: 20)"),
});

export type CnaeInput = z.infer<typeof cnaeSchema>;

/** Structured output payload (validated against this schema by the MCP SDK). */
export const cnaeOutputSchema = z.object({
  modo: z
    .enum(["busca", "codigo", "lista", "estrutura"])
    .describe("Modo de resposta que gerou os dados"),
  busca: z
    .object({
      termo: z.string().describe("Termo pesquisado"),
      nivel: z.string().describe("Nível hierárquico pesquisado (ex: subclasses, classes)"),
      total: z.number().describe("Quantidade de resultados retornados"),
      resultados: z
        .array(
          z.object({
            id: z.string().describe("Código CNAE da atividade"),
            descricao: z.string().describe("Descrição da atividade"),
          })
        )
        .describe("Atividades encontradas para o termo"),
    })
    .optional()
    .describe("Presente no modo de busca por termo"),
  codigo: z
    .object({
      id: z.string().describe("Código CNAE consultado"),
      descricao: z.string().describe("Descrição do código"),
      nivel: z
        .string()
        .describe("Nível do código (secao, divisao, grupo, classe ou subclasse)"),
      hierarquia: z
        .array(
          z.object({
            nivel: z.string().describe("Nível hierárquico (Seção, Divisão, Grupo, Classe, Subclasse)"),
            id: z.string().describe("Código do nível"),
            descricao: z.string().describe("Descrição do nível"),
          })
        )
        .optional()
        .describe("Cadeia hierárquica do código (do mais geral ao mais específico)"),
      observacoes: z
        .array(z.string())
        .optional()
        .describe("Observações/notas explicativas do código"),
    })
    .optional()
    .describe("Presente no modo de consulta por código"),
  lista: z
    .object({
      nivel: z.string().describe("Nível hierárquico listado"),
      total: z.number().describe("Total de registros existentes no nível"),
      exibidos: z.number().describe("Quantidade de registros exibidos (limitada por 'limite')"),
      registros: z
        .array(
          z.object({
            id: z.string().describe("Código CNAE do registro"),
            descricao: z.string().describe("Descrição do registro"),
          })
        )
        .describe("Registros do nível listado"),
    })
    .optional()
    .describe("Presente no modo de listagem por nível"),
});

/**
 * Fetches CNAE data from IBGE API
 */
export async function ibgeCnae(input: CnaeInput): Promise<StructuredToolResult> {
  return withMetrics("ibge_cnae", "cnae", async () => {
    try {
      // Search by term
      if (input.busca) {
        return await searchCnae(input.busca, input.nivel, input.limite || 20);
      }

      // Get specific code
      if (input.codigo) {
        return await getCnaeByCode(input.codigo);
      }

      // List by level
      if (input.nivel) {
        return await listCnaeByLevel(input.nivel, input.limite || 20);
      }

      // Default: show structure overview
      return showCnaeStructure();
    } catch (error) {
      if (error instanceof Error) {
        return {
          markdown: parseHttpError(error, "ibge_cnae", {
            codigo: input.codigo,
            busca: input.busca,
          }),
          isError: true,
        };
      }
      return { markdown: ValidationErrors.emptyResult("ibge_cnae"), isError: true };
    }
  });
}

async function getCnaeByCode(codigo: string): Promise<StructuredToolResult> {
  // Normalize code
  const normalized = codigo.replace(/[.\-/]/g, "").toUpperCase();

  // Validate code format using centralized validation
  if (!isValidCnaeCode(codigo)) {
    return {
      markdown: formatValidationError(
        "codigo",
        codigo,
        "Seção (A-U), Divisão (2 dígitos), Grupo (3 dígitos), Classe (4-5 dígitos) ou Subclasse (7 dígitos)"
      ),
      isError: true,
    };
  }

  // Determine the level based on code format
  let endpoint: string;
  let level: string;

  if (/^[A-U]$/.test(normalized)) {
    endpoint = `${IBGE_API.CNAE}/secoes/${normalized}`;
    level = "secao";
  } else if (/^\d{2}$/.test(normalized)) {
    endpoint = `${IBGE_API.CNAE}/divisoes/${normalized}`;
    level = "divisao";
  } else if (/^\d{3}$/.test(normalized)) {
    endpoint = `${IBGE_API.CNAE}/grupos/${normalized}`;
    level = "grupo";
  } else if (/^\d{4,5}$/.test(normalized)) {
    // Class can be 4 or 5 digits (with check digit)
    const classCode = normalized.slice(0, 4);
    endpoint = `${IBGE_API.CNAE}/classes/${classCode}`;
    level = "classe";
  } else {
    // Subclass is 7 digits
    endpoint = `${IBGE_API.CNAE}/subclasses/${normalized}`;
    level = "subclasse";
  }

  const key = cacheKey("cnae", { codigo: normalized });
  const data = await cachedFetch<CnaeSecao | CnaeDivisao | CnaeGrupo | CnaeClasse | CnaeSubclasse>(
    endpoint,
    key,
    CACHE_TTL.STATIC
  );

  return {
    markdown: formatCnaeDetail(data, level),
    structured: { modo: "codigo", codigo: buildCnaeCodeStructured(data, level) },
  };
}

/** Builds the structured payload for a single CNAE code lookup. */
function buildCnaeCodeStructured(
  data: CnaeSecao | CnaeDivisao | CnaeGrupo | CnaeClasse | CnaeSubclasse,
  level: string
): Record<string, unknown> {
  const hierarquia: Array<{ nivel: string; id: string; descricao: string }> = [];

  if (level === "subclasse") {
    const sub = data as CnaeSubclasse;
    hierarquia.push(
      { nivel: "Seção", id: sub.classe.grupo.divisao.secao.id, descricao: sub.classe.grupo.divisao.secao.descricao },
      { nivel: "Divisão", id: sub.classe.grupo.divisao.id, descricao: sub.classe.grupo.divisao.descricao },
      { nivel: "Grupo", id: sub.classe.grupo.id, descricao: sub.classe.grupo.descricao },
      { nivel: "Classe", id: sub.classe.id, descricao: sub.classe.descricao },
      { nivel: "Subclasse", id: sub.id, descricao: sub.descricao }
    );
  } else if (level === "classe") {
    const cls = data as CnaeClasse;
    hierarquia.push(
      { nivel: "Seção", id: cls.grupo.divisao.secao.id, descricao: cls.grupo.divisao.secao.descricao },
      { nivel: "Divisão", id: cls.grupo.divisao.id, descricao: cls.grupo.divisao.descricao },
      { nivel: "Grupo", id: cls.grupo.id, descricao: cls.grupo.descricao },
      { nivel: "Classe", id: cls.id, descricao: cls.descricao }
    );
  } else if (level === "grupo") {
    const grp = data as CnaeGrupo;
    hierarquia.push(
      { nivel: "Seção", id: grp.divisao.secao.id, descricao: grp.divisao.secao.descricao },
      { nivel: "Divisão", id: grp.divisao.id, descricao: grp.divisao.descricao },
      { nivel: "Grupo", id: grp.id, descricao: grp.descricao }
    );
  } else if (level === "divisao") {
    const div = data as CnaeDivisao;
    hierarquia.push(
      { nivel: "Seção", id: div.secao.id, descricao: div.secao.descricao },
      { nivel: "Divisão", id: div.id, descricao: div.descricao }
    );
  }

  const codigo: Record<string, unknown> = {
    id: (data as { id: string }).id,
    descricao: data.descricao,
    nivel: level,
  };
  if (hierarquia.length > 0) {
    codigo.hierarquia = hierarquia;
  }
  if (data.observacoes && data.observacoes.length > 0) {
    codigo.observacoes = data.observacoes;
  }
  return codigo;
}

async function searchCnae(
  termo: string,
  nivel?: string,
  limite: number = 20
): Promise<StructuredToolResult> {
  // Determine which endpoint to use
  const searchLevel = nivel || "subclasses";
  const endpoint = `${IBGE_API.CNAE}/${searchLevel}`;

  const key = cacheKey("cnae-list", { nivel: searchLevel });
  const allData = await cachedFetch<
    CnaeSubclasse[] | CnaeClasse[] | CnaeGrupo[] | CnaeDivisao[] | CnaeSecao[]
  >(endpoint, key, CACHE_TTL.STATIC);

  // Filter by search term
  const termoLower = termo.toLowerCase();
  const filtered = allData
    .filter((item: { descricao: string }) => item.descricao.toLowerCase().includes(termoLower))
    .slice(0, limite);

  if (filtered.length === 0) {
    return {
      markdown:
        `Nenhuma atividade encontrada para "${termo}".\n\n` +
        `Dicas:\n` +
        `- Tente termos mais genéricos\n` +
        `- Use ibge_cnae(nivel="secoes") para ver as categorias principais`,
      isError: true,
    };
  }

  let output = `## Busca CNAE: "${termo}"\n\n`;
  output += `Encontrados ${filtered.length} resultados (nível: ${searchLevel}):\n\n`;

  const rows = filtered.map((item) => [(item as { id: string }).id, truncate(item.descricao, 80)]);
  output += createMarkdownTable(["Código", "Descrição"], rows, {
    alignment: ["left", "left"],
  });

  if (filtered.length === limite) {
    output += `\n_Mostrando primeiros ${limite} resultados. Use limite maior para ver mais._\n`;
  }

  const resultados = filtered.map((item) => ({
    id: (item as { id: string }).id,
    descricao: item.descricao,
  }));

  return {
    markdown: output,
    structured: {
      modo: "busca",
      busca: {
        termo,
        nivel: searchLevel,
        total: filtered.length,
        resultados,
      },
    },
  };
}

async function listCnaeByLevel(nivel: string, limite: number): Promise<StructuredToolResult> {
  const endpoint = `${IBGE_API.CNAE}/${nivel}`;
  const key = cacheKey("cnae-list", { nivel });

  const data = await cachedFetch<Array<{ id: string; descricao: string }>>(
    endpoint,
    key,
    CACHE_TTL.STATIC
  );

  const nivelNames: Record<string, string> = {
    secoes: "Seções",
    divisoes: "Divisões",
    grupos: "Grupos",
    classes: "Classes",
    subclasses: "Subclasses",
  };

  let output = `## CNAE - ${nivelNames[nivel]}\n\n`;
  output += `Total: ${data.length} registros\n\n`;

  const display = data.slice(0, limite);
  const rows = display.map((item) => [item.id, truncate(item.descricao, 80)]);
  output += createMarkdownTable(["Código", "Descrição"], rows, {
    alignment: ["left", "left"],
  });

  if (data.length > limite) {
    output += `\n_Mostrando ${limite} de ${data.length} registros._\n`;
  }

  return {
    markdown: output,
    structured: {
      modo: "lista",
      lista: {
        nivel,
        total: data.length,
        exibidos: display.length,
        registros: display.map((item) => ({ id: item.id, descricao: item.descricao })),
      },
    },
  };
}

function showCnaeStructure(): StructuredToolResult {
  const markdown = `## CNAE - Classificação Nacional de Atividades Econômicas

A CNAE é a classificação oficial para identificar atividades econômicas no Brasil.

### Estrutura Hierárquica

| Nível | Formato | Exemplo | Descrição |
|:------|:--------|:--------|:----------|
| Seção | 1 letra | A | Agricultura, Pecuária, etc. |
| Divisão | 2 dígitos | 01 | Agricultura, pecuária e serviços relacionados |
| Grupo | 3 dígitos | 01.1 | Produção de lavouras temporárias |
| Classe | 4-5 dígitos | 01.11-3 | Cultivo de cereais |
| Subclasse | 7 dígitos | 0111-3/01 | Cultivo de arroz |

### Seções (21 categorias principais)

| Seção | Descrição |
|:-----:|:----------|
| A | Agricultura, pecuária, produção florestal, pesca e aquicultura |
| B | Indústrias extrativas |
| C | Indústrias de transformação |
| D | Eletricidade e gás |
| E | Água, esgoto, atividades de gestão de resíduos |
| F | Construção |
| G | Comércio; reparação de veículos |
| H | Transporte, armazenagem e correio |
| I | Alojamento e alimentação |
| J | Informação e comunicação |
| K | Atividades financeiras, seguros |
| L | Atividades imobiliárias |
| M | Atividades profissionais, científicas e técnicas |
| N | Atividades administrativas e serviços complementares |
| O | Administração pública, defesa e seguridade social |
| P | Educação |
| Q | Saúde humana e serviços sociais |
| R | Artes, cultura, esporte e recreação |
| S | Outras atividades de serviços |
| T | Serviços domésticos |
| U | Organismos internacionais |

### Exemplos de uso

\`\`\`
# Buscar atividades de software
ibge_cnae(busca="software")

# Detalhes de uma seção
ibge_cnae(codigo="J")

# Detalhes de um código específico
ibge_cnae(codigo="6201-5/01")

# Listar todas as divisões
ibge_cnae(nivel="divisoes", limite=50)

# Buscar em classes
ibge_cnae(busca="restaurante", nivel="classes")
\`\`\``;

  return { markdown, structured: { modo: "estrutura" } };
}

function formatCnaeDetail(
  data: CnaeSecao | CnaeDivisao | CnaeGrupo | CnaeClasse | CnaeSubclasse,
  level: string
): string {
  let output = `## CNAE ${(data as { id: string }).id}\n\n`;
  output += `**Descrição:** ${data.descricao}\n`;
  output += `**Nível:** ${level.charAt(0).toUpperCase() + level.slice(1)}\n\n`;

  // Show hierarchy
  if (level === "subclasse") {
    const sub = data as CnaeSubclasse;
    output += "### Hierarquia\n\n";
    output += `- **Seção:** ${sub.classe.grupo.divisao.secao.id} - ${sub.classe.grupo.divisao.secao.descricao}\n`;
    output += `- **Divisão:** ${sub.classe.grupo.divisao.id} - ${sub.classe.grupo.divisao.descricao}\n`;
    output += `- **Grupo:** ${sub.classe.grupo.id} - ${sub.classe.grupo.descricao}\n`;
    output += `- **Classe:** ${sub.classe.id} - ${sub.classe.descricao}\n`;
    output += `- **Subclasse:** ${sub.id} - ${sub.descricao}\n`;
  } else if (level === "classe") {
    const cls = data as CnaeClasse;
    output += "### Hierarquia\n\n";
    output += `- **Seção:** ${cls.grupo.divisao.secao.id} - ${cls.grupo.divisao.secao.descricao}\n`;
    output += `- **Divisão:** ${cls.grupo.divisao.id} - ${cls.grupo.divisao.descricao}\n`;
    output += `- **Grupo:** ${cls.grupo.id} - ${cls.grupo.descricao}\n`;
    output += `- **Classe:** ${cls.id} - ${cls.descricao}\n`;
  } else if (level === "grupo") {
    const grp = data as CnaeGrupo;
    output += "### Hierarquia\n\n";
    output += `- **Seção:** ${grp.divisao.secao.id} - ${grp.divisao.secao.descricao}\n`;
    output += `- **Divisão:** ${grp.divisao.id} - ${grp.divisao.descricao}\n`;
    output += `- **Grupo:** ${grp.id} - ${grp.descricao}\n`;
  } else if (level === "divisao") {
    const div = data as CnaeDivisao;
    output += "### Hierarquia\n\n";
    output += `- **Seção:** ${div.secao.id} - ${div.secao.descricao}\n`;
    output += `- **Divisão:** ${div.id} - ${div.descricao}\n`;
  }

  // Show observations if available
  if (data.observacoes && data.observacoes.length > 0) {
    output += "\n### Observações\n\n";
    for (const obs of data.observacoes) {
      output += `- ${obs}\n`;
    }
  }

  return output;
}
