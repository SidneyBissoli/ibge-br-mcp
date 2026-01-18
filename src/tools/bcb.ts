import { z } from "zod";
import { BCB_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable, createKeyValueTable, formatNumber } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";

// Known series codes
const SERIES_CONHECIDAS: Record<
  string,
  { codigo: number; nome: string; descricao: string; unidade: string }
> = {
  selic: {
    codigo: 432,
    nome: "Taxa SELIC",
    descricao: "Taxa de juros SELIC acumulada no mês",
    unidade: "% a.a.",
  },
  selic_meta: {
    codigo: 432,
    nome: "Meta SELIC",
    descricao: "Meta para a taxa SELIC definida pelo COPOM",
    unidade: "% a.a.",
  },
  ipca: {
    codigo: 433,
    nome: "IPCA",
    descricao: "Índice de Preços ao Consumidor Amplo - variação mensal",
    unidade: "%",
  },
  ipca_acum: {
    codigo: 13522,
    nome: "IPCA Acumulado 12 meses",
    descricao: "IPCA acumulado nos últimos 12 meses",
    unidade: "%",
  },
  igpm: {
    codigo: 189,
    nome: "IGP-M",
    descricao: "Índice Geral de Preços - Mercado",
    unidade: "%",
  },
  inpc: {
    codigo: 188,
    nome: "INPC",
    descricao: "Índice Nacional de Preços ao Consumidor",
    unidade: "%",
  },
  pib_mensal: {
    codigo: 4380,
    nome: "PIB Mensal",
    descricao: "PIB valores correntes",
    unidade: "R$ milhões",
  },
  dolar_compra: {
    codigo: 1,
    nome: "Dólar (compra)",
    descricao: "Taxa de câmbio - Dólar comercial compra - média",
    unidade: "R$/US$",
  },
  dolar_venda: {
    codigo: 10813,
    nome: "Dólar (venda)",
    descricao: "Taxa de câmbio - Dólar comercial venda - média",
    unidade: "R$/US$",
  },
  euro: {
    codigo: 21619,
    nome: "Euro",
    descricao: "Taxa de câmbio - Euro - venda",
    unidade: "R$/EUR",
  },
  desemprego: {
    codigo: 24369,
    nome: "Taxa de Desemprego",
    descricao: "Taxa de desocupação - PNAD Contínua",
    unidade: "%",
  },
  divida_pib: {
    codigo: 13762,
    nome: "Dívida/PIB",
    descricao: "Dívida líquida do setor público em % do PIB",
    unidade: "% PIB",
  },
  reservas: {
    codigo: 3546,
    nome: "Reservas Internacionais",
    descricao: "Reservas internacionais - conceito liquidez",
    unidade: "US$ milhões",
  },
  cdi: {
    codigo: 12,
    nome: "CDI",
    descricao: "Taxa CDI",
    unidade: "% a.a.",
  },
  tr: {
    codigo: 226,
    nome: "TR",
    descricao: "Taxa Referencial",
    unidade: "% a.m.",
  },
};

// Schema for the tool input
export const bcbSchema = z.object({
  indicador: z.string().describe(`Indicador ou código da série BCB. Indicadores conhecidos:
- selic: Taxa SELIC
- ipca: IPCA mensal
- ipca_acum: IPCA acumulado 12 meses
- igpm: IGP-M
- inpc: INPC
- dolar_compra/dolar_venda: Câmbio dólar
- euro: Câmbio euro
- desemprego: Taxa de desemprego
- divida_pib: Dívida pública/PIB
- cdi: Taxa CDI
- tr: Taxa Referencial
- listar: Lista indicadores disponíveis
- Ou código numérico da série SGS`),
  dataInicio: z.string().optional().describe("Data inicial no formato DD/MM/AAAA"),
  dataFim: z.string().optional().describe("Data final no formato DD/MM/AAAA"),
  ultimos: z.number().optional().describe("Retornar apenas os últimos N valores"),
  formato: z.enum(["tabela", "json"]).optional().default("tabela").describe("Formato de saída"),
});

export type BcbInput = z.infer<typeof bcbSchema>;

/**
 * Fetches data from BCB (Banco Central do Brasil) APIs
 */
export async function ibgeBcb(input: BcbInput): Promise<string> {
  return withMetrics("ibge_bcb", "bcb", async () => {
    // List available indicators
    if (input.indicador === "listar") {
      return listIndicators();
    }

    try {
      // Get series code
      const serieInfo = SERIES_CONHECIDAS[input.indicador.toLowerCase()];
      let codigo: number;
      let nome: string;
      let unidade: string;

      if (serieInfo) {
        codigo = serieInfo.codigo;
        nome = serieInfo.nome;
        unidade = serieInfo.unidade;
      } else if (/^\d+$/.test(input.indicador)) {
        codigo = parseInt(input.indicador);
        nome = `Série ${codigo}`;
        unidade = "";
      } else {
        return (
          `Indicador "${input.indicador}" não encontrado.\n\n` +
          `Use indicador="listar" para ver indicadores disponíveis ou informe o código numérico da série SGS.`
        );
      }

      // Build URL
      let url = `${BCB_API.SGS}.${codigo}/dados`;
      const params: string[] = [];

      if (input.dataInicio) {
        params.push(`dataInicial=${encodeURIComponent(input.dataInicio)}`);
      }
      if (input.dataFim) {
        params.push(`dataFinal=${encodeURIComponent(input.dataFim)}`);
      }
      if (input.ultimos) {
        params.push(`ultimos=${input.ultimos}`);
      }

      params.push("formato=json");

      if (params.length > 0) {
        url += "?" + params.join("&");
      }

      // Fetch data
      const key = cacheKey(url);
      const data = await cachedFetch<BcbSgsData[]>(url, key, CACHE_TTL.SHORT);

      if (!data || data.length === 0) {
        return `Nenhum dado encontrado para ${nome}.`;
      }

      return formatResponse(data, nome, unidade, input);
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(error, "bcb", { indicador: input.indicador });
      }
      return ValidationErrors.emptyResult("bcb");
    }
  });
}

interface BcbSgsData {
  data: string;
  valor: string;
}

function listIndicators(): string {
  let output = "## Indicadores do Banco Central do Brasil (BCB)\n\n";

  const headers = ["Indicador", "Código", "Descrição"];

  output += "### Taxas de Juros\n\n";
  output += createMarkdownTable(
    headers,
    [
      ["`selic`", "432", SERIES_CONHECIDAS.selic.descricao],
      ["`cdi`", "12", SERIES_CONHECIDAS.cdi.descricao],
      ["`tr`", "226", SERIES_CONHECIDAS.tr.descricao],
    ],
    { alignment: ["left", "center", "left"] }
  );

  output += "\n### Inflação\n\n";
  output += createMarkdownTable(
    headers,
    [
      ["`ipca`", "433", SERIES_CONHECIDAS.ipca.descricao],
      ["`ipca_acum`", "13522", SERIES_CONHECIDAS.ipca_acum.descricao],
      ["`igpm`", "189", SERIES_CONHECIDAS.igpm.descricao],
      ["`inpc`", "188", SERIES_CONHECIDAS.inpc.descricao],
    ],
    { alignment: ["left", "center", "left"] }
  );

  output += "\n### Câmbio\n\n";
  output += createMarkdownTable(
    headers,
    [
      ["`dolar_compra`", "1", SERIES_CONHECIDAS.dolar_compra.descricao],
      ["`dolar_venda`", "10813", SERIES_CONHECIDAS.dolar_venda.descricao],
      ["`euro`", "21619", SERIES_CONHECIDAS.euro.descricao],
    ],
    { alignment: ["left", "center", "left"] }
  );

  output += "\n### Indicadores Macroeconômicos\n\n";
  output += createMarkdownTable(
    headers,
    [
      ["`desemprego`", "24369", SERIES_CONHECIDAS.desemprego.descricao],
      ["`divida_pib`", "13762", SERIES_CONHECIDAS.divida_pib.descricao],
      ["`reservas`", "3546", SERIES_CONHECIDAS.reservas.descricao],
    ],
    { alignment: ["left", "center", "left"] }
  );

  output += "\n### Exemplos de Uso\n\n";
  output += "```\n";
  output += "# SELIC atual (últimos 12 meses)\n";
  output += 'bcb(indicador="selic", ultimos=12)\n\n';
  output += "# IPCA de 2023\n";
  output += 'bcb(indicador="ipca", dataInicio="01/01/2023", dataFim="31/12/2023")\n\n';
  output += "# Dólar últimos 30 dias\n";
  output += 'bcb(indicador="dolar_venda", ultimos=30)\n\n';
  output += "# Série por código\n";
  output += 'bcb(indicador="432", ultimos=10)\n';
  output += "```\n\n";

  output += "### Sistema Gerenciador de Séries (SGS)\n\n";
  output += "Você pode consultar qualquer série do SGS informando o código numérico.\n";
  output += "Catálogo completo: https://www3.bcb.gov.br/sgspub/\n";

  return output;
}

function formatResponse(
  data: BcbSgsData[],
  nome: string,
  unidade: string,
  input: BcbInput
): string {
  let output = `## ${nome}\n\n`;

  // Summary
  const valores = data.map((d) => parseFloat(d.valor.replace(",", "."))).filter((v) => !isNaN(v));

  if (valores.length > 0) {
    const ultimo = valores[valores.length - 1];
    const primeiro = valores[0];
    const maximo = Math.max(...valores);
    const minimo = Math.min(...valores);
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;

    output += "### Resumo\n\n";
    output += createKeyValueTable(
      {
        "**Último valor**": `${formatNumber(ultimo, { maximumFractionDigits: 4 })} ${unidade}`,
        "**Primeiro valor**": `${formatNumber(primeiro, { maximumFractionDigits: 4 })} ${unidade}`,
        "**Máximo**": `${formatNumber(maximo, { maximumFractionDigits: 4 })} ${unidade}`,
        "**Mínimo**": `${formatNumber(minimo, { maximumFractionDigits: 4 })} ${unidade}`,
        "**Média**": `${formatNumber(media, { maximumFractionDigits: 4 })} ${unidade}`,
        "**Período**": `${data[0].data} a ${data[data.length - 1].data}`,
        "**Registros**": data.length,
      },
      { keyHeader: "Estatística", valueHeader: "Valor" }
    );
    output += "\n";
  }

  // Format output
  if (input.formato === "json") {
    output += "### Dados\n\n```json\n";
    output += JSON.stringify(data, null, 2);
    output += "\n```\n";
  } else {
    // Table format
    output += "### Dados\n\n";

    // Show last 30 or all if less
    const displayData = data.slice(-30);
    const rows: (string | number)[][] = [];

    if (data.length > 30) {
      rows.push(["...", `_${data.length - 30} registros anteriores_`]);
    }

    for (const d of displayData) {
      const valor = parseFloat(d.valor.replace(",", "."));
      rows.push([d.data, formatNumber(valor, { maximumFractionDigits: 4 })]);
    }

    output += createMarkdownTable(["Data", `Valor ${unidade ? `(${unidade})` : ""}`], rows, {
      alignment: ["left", "right"],
    });
  }

  return output;
}

// Tool definition
export const bcbTool = {
  name: "bcb",
  description: `Consulta dados do Banco Central do Brasil (BCB) - taxas de juros, câmbio, inflação.

Indicadores disponíveis:
- selic: Taxa SELIC
- ipca/ipca_acum: Inflação IPCA
- igpm/inpc: Outros índices de preços
- dolar_compra/dolar_venda: Câmbio dólar
- euro: Câmbio euro
- desemprego: Taxa de desemprego
- divida_pib: Dívida pública/PIB
- cdi/tr: Outras taxas
- listar: Lista todos os indicadores

Também aceita códigos numéricos do Sistema SGS do BCB.

Exemplos:
- SELIC últimos 12 meses: indicador="selic", ultimos=12
- IPCA de 2023: indicador="ipca", dataInicio="01/01/2023", dataFim="31/12/2023"
- Dólar recente: indicador="dolar_venda", ultimos=30`,
  inputSchema: bcbSchema,
  handler: ibgeBcb,
};
