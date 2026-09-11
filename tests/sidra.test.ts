import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeSidra, listSidraTables, sidraOutputSchema } from "../src/tools/sidra.js";
import { cache } from "../src/cache.js";
import { mockResponse, sidraResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const popByUf = sidraResponse(
  { D1N: "Unidade da Federação", D2N: "Ano", V: "Valor" },
  { D1N: "São Paulo", D2N: "2022", V: "44411238" },
  { D1N: "Rio de Janeiro", D2N: "2022", V: "16055174" }
);

/** Builds a SIDRA response with `n` data rows after the header. */
function bigSidra(n: number) {
  const header = { D1N: "Município", V: "Valor" };
  const rows = Array.from({ length: n }, (_, i) => ({ D1N: `Mun ${i + 1}`, V: String(1000 + i) }));
  return sidraResponse(header, ...rows);
}

function lastUrl(): string {
  return String(mockFetch.mock.calls.at(-1)?.[0]);
}

describe("ibge_sidra", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the SIDRA path /t/{tabela}/n{nivel}/{loc}/v/{var}/p/{per}", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    await ibgeSidra({
      tabela: "6579",
      nivel_territorial: "3",
      localidades: "35,33",
      variaveis: "9324",
      periodos: "2022",
    });

    const url = lastUrl();
    expect(url).toContain("/t/6579");
    expect(url).toContain("/n3/35,33");
    expect(url).toContain("/v/9324");
    expect(url).toContain("/p/2022");
  });

  it("renders a Markdown table using the header row labels and known table name", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    const { markdown } = await ibgeSidra({ tabela: "6579", nivel_territorial: "3" });

    expect(markdown).toContain("SIDRA - Estimativas de população");
    expect(markdown).toContain("Unidade da Federação");
    expect(markdown).toContain("São Paulo");
    // value formatted with thousand separators
    expect(markdown).toContain("44.411.238");
  });

  it("returns a typed structured payload alongside the markdown", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    const result = await ibgeSidra({ tabela: "6579", nivel_territorial: "3" });

    expect(result.isError).toBeFalsy();
    expect(result.structured).toBeDefined();
    const s = result.structured as Record<string, unknown>;
    expect(s.tabela).toBe("6579");
    expect(s.nome).toBe("Estimativas de população");
    expect(s.totalRegistros).toBe(2);
    expect(s.colunas).toEqual(["Unidade da Federação", "Ano", "Valor"]);
    const registros = s.registros as Record<string, string>[];
    expect(registros[0]).toEqual({
      "Unidade da Federação": "São Paulo",
      Ano: "2022",
      Valor: "44411238",
    });
    expect(s.paginacao).toEqual({ pagina: 1, porPagina: 100, totalPaginas: 1, temMais: false });
    // The payload must satisfy the declared outputSchema (what the MCP SDK validates).
    expect(sidraOutputSchema.safeParse(result.structured).success).toBe(true);
  });

  it("paginates large results (100 rows per page) with continuation guidance", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(bigSidra(150)));

    const page1 = await ibgeSidra({ tabela: "6579", pagina: 1 });
    const s1 = page1.structured as Record<string, unknown>;
    expect(s1.totalRegistros).toBe(150);
    expect((s1.registros as unknown[]).length).toBe(100);
    expect(s1.paginacao).toMatchObject({ pagina: 1, totalPaginas: 2, temMais: true });
    expect(page1.markdown).toContain("Use pagina=2");

    cache.clear();
    mockFetch.mockResolvedValueOnce(mockResponse(bigSidra(150)));
    const page2 = await ibgeSidra({ tabela: "6579", pagina: 2 });
    const s2 = page2.structured as Record<string, unknown>;
    expect((s2.registros as unknown[]).length).toBe(50);
    expect(s2.paginacao).toMatchObject({ pagina: 2, temMais: false });
  });

  it("formato='json' returns the structured payload as JSON text plus structured", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    const result = await ibgeSidra({ tabela: "6579", formato: "json" });

    expect(result.markdown.trim().startsWith("{")).toBe(true);
    const parsed = JSON.parse(result.markdown);
    expect(parsed.registros).toHaveLength(2);
    expect(result.structured).toBeDefined();
  });

  it("field selection (campos) trims columns in both channels", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    const result = await ibgeSidra({ tabela: "6579", campos: "Valor" });

    const s = result.structured as Record<string, unknown>;
    expect(s.colunas).toEqual(["Valor"]);
    expect((s.registros as Record<string, string>[])[0]).toEqual({ Valor: "44411238" });
    // dropped columns absent from the Markdown table too
    expect(result.markdown).not.toContain("Unidade da Federação");
    expect(sidraOutputSchema.safeParse(result.structured).success).toBe(true);
  });

  it("appends classification path from 'id[categorias]'", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(popByUf));

    await ibgeSidra({ tabela: "6579", classificacoes: "2[6794]" });

    expect(lastUrl()).toContain("/c2/6794");
  });

  it("rejects an invalid territorial level without calling the API", async () => {
    const result = await ibgeSidra({ tabela: "6579", nivel_territorial: "999" });

    expect(result.isError).toBe(true);
    expect(result.markdown).toContain("Nível territorial inválido");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects an invalid period without calling the API", async () => {
    const result = await ibgeSidra({ tabela: "6579", periodos: "não-é-período" });

    expect(result.isError).toBe(true);
    expect(result.markdown).toContain("periodos");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("treats an empty result as success-empty (structured, not error)", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));

    const result = await ibgeSidra({ tabela: "6579" });

    expect(result.isError).toBeFalsy();
    expect(result.markdown).toContain("Nenhum dado encontrado");
    const s = result.structured as Record<string, unknown>;
    expect(s.totalRegistros).toBe(0);
    expect(s.registros).toEqual([]);
    // Empty is success (not error), so the structured payload must still validate.
    expect(sidraOutputSchema.safeParse(result.structured).success).toBe(true);
  });

  it("handles a header-only response (no data rows)", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sidraResponse({ D1N: "UF", V: "Valor" })));

    const result = await ibgeSidra({ tabela: "6579" });

    expect(result.isError).toBeFalsy();
    expect(result.markdown).toContain("Nenhum dado encontrado");
    const s = result.structured as Record<string, unknown>;
    expect(s.totalRegistros).toBe(0);
    // O cabeçalho veio: os RÓTULOS das colunas continuam na resposta, mesmo sem
    // uma linha de dado. É o que diz ao chamador o que a tabela tem.
    expect(s.colunas).toEqual(["UF", "Valor"]);
  });

  /**
   * Por que a consulta veio vazia — perguntado à fonte.
   *
   * `tabela=6579, nivel_territorial=3, periodos=2023` (população por UF em
   * 2023, a pergunta mais natural que existe) voltava vazia e calada: a série
   * de estimativas do IBGE pula 2007, 2010, 2022 e 2023, anos de Censo ou
   * Contagem. Sem dizer isso, "nenhum registro" vira fato do mundo dentro de um
   * relatório. Medido e reproduzido em 11/09/2026.
   */
  describe("diagnóstico do resultado vazio", () => {
    const periodosDaTabela = [
      { id: "2021" },
      { id: "2024" },
      { id: "2025" },
      { id: "2026" },
      { id: "2001" },
      { id: "2002" },
      { id: "2003" },
    ];

    function vazioMais(periodos: Array<{ id: string }>) {
      mockFetch
        .mockResolvedValueOnce(mockResponse(sidraResponse({ D1N: "UF", V: "Valor" })))
        .mockResolvedValueOnce(mockResponse(periodos));
    }

    it("nomeia o período que a tabela não publica e lista o que ela tem", async () => {
      vazioMais(periodosDaTabela);

      const { markdown, isError } = await ibgeSidra({ tabela: "6579", periodos: "2023" });

      expect(isError).toBeFalsy();
      expect(markdown).toContain("não publica o período 2023");
      // Em faixas, senão uma série longa vira um parágrafo de números.
      expect(markdown).toContain("2001-2003, 2021, 2024-2026");
    });

    it("no plural quando NENHUM dos períodos pedidos existe", async () => {
      vazioMais(periodosDaTabela);

      const { markdown } = await ibgeSidra({ tabela: "6579", periodos: "2022,2023" });

      expect(markdown).toContain("não publica os períodos 2022, 2023");
    });

    it("cala quando ALGUM dos períodos pedidos existe — a causa é outra", async () => {
      vazioMais(periodosDaTabela);

      const { markdown } = await ibgeSidra({ tabela: "6579", periodos: "2021,2023" });

      expect(markdown).not.toContain("não publica");
      expect(markdown).toContain("Nenhum dado encontrado");
    });

    it("não julga as palavras do SIDRA, e nem pergunta à fonte por causa delas", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(sidraResponse({ D1N: "UF", V: "Valor" })));

      const { markdown } = await ibgeSidra({ tabela: "6579", periodos: "last" });

      expect(markdown).toContain("Nenhum dado encontrado");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("diagnóstico é cortesia: fonte fora do ar não derruba a resposta", async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(sidraResponse({ D1N: "UF", V: "Valor" })))
        .mockRejectedValueOnce(new Error("HTTP 503"));

      const { markdown, isError } = await ibgeSidra({ tabela: "6579", periodos: "2023" });

      expect(isError).toBeFalsy();
      expect(markdown).toContain("Nenhum dado encontrado");
    });

    it("no modo estatísticas a causa é a MESMA, e não marcador de ausência", async () => {
      vazioMais(periodosDaTabela);

      const { markdown } = await ibgeSidra({
        tabela: "6579",
        periodos: "2023",
        estatisticas: true,
      });

      expect(markdown).toContain("não publica o período 2023");
      expect(markdown).not.toContain("marcador de ausência");
    });
  });

  it("surfaces an upstream HTTP error with isError and related tools", async () => {
    mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));

    const result = await ibgeSidra({ tabela: "6579" });

    expect(result.isError).toBe(true);
    expect(result.markdown).toContain("Erro");
    expect(result.markdown).toContain("ibge_sidra_metadados");
  });
});

describe("listSidraTables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  it("queries the aggregates endpoint filtered by pesquisa and returns JSON", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([{ id: "6579", nome: "Estimativas" }]));

    const result = await listSidraTables("33");

    expect(lastUrl()).toContain("?pesquisa=33");
    expect(JSON.parse(result)[0].id).toBe("6579");
  });
});
