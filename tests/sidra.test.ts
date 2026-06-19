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

    expect(result.markdown).toContain("Nenhum dado encontrado para os filtros aplicados");
    expect((result.structured as Record<string, unknown>).totalRegistros).toBe(0);
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
