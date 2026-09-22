import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ibgeCnae } from "../src/tools/cnae.js";
import { cache } from "../src/cache.js";
import { mockResponse } from "./helpers.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function lastUrl(): string {
  return String(mockFetch.mock.calls.at(-1)?.[0]);
}

// Os ids destas fixtures são os REAIS da CNAE 2.0, conferidos contra
// servicodados.ibge.gov.br/api/v2/cnae em 22/09/2026 — não uma forma plausível.
// A versão anterior usava `classe.id = "6201"` e `subclasse.id = "6201-5/01"`,
// formas que a API não emite (classe tem 5 dígitos, subclasse tem 7 sem
// pontuação), e era essa fixture que abençoava o `slice(0, 4)` defeituoso: o
// mock normalizava justamente a diferença que a API recusava.
const secao = { id: "J", descricao: "Informação e comunicação", observacoes: ["nota 1"] };

const divisao = {
  id: "62",
  descricao: "Atividades dos serviços de tecnologia da informação",
  secao,
};

const grupo = { id: "620", descricao: "Atividades dos serviços de TI", divisao };

const classe = {
  id: "62015",
  descricao: "Desenvolvimento de programas de computador sob encomenda",
  grupo,
};

const classesDoGrupo620 = [
  { id: "62015", descricao: "Desenvolvimento de programas de computador sob encomenda" },
  { id: "62023", descricao: "Desenvolvimento e licenciamento de programas customizáveis" },
];

const subclasse = {
  id: "6201501",
  descricao: "Desenvolvimento de programas de computador sob encomenda",
  classe,
};

const subclasseList = [
  { id: "6201501", descricao: "Desenvolvimento de programas de computador sob encomenda" },
  { id: "6202300", descricao: "Desenvolvimento e licenciamento de software customizável" },
  { id: "5611201", descricao: "Restaurantes e similares" },
];

describe("ibge_cnae", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("default structure overview", () => {
    it("shows the hierarchy overview without calling the API", async () => {
      const { markdown: result } = await ibgeCnae({ limite: 20 });
      expect(result).toContain("CNAE - Classificação Nacional de Atividades Econômicas");
      expect(result).toContain("Estrutura Hierárquica");
      expect(result).toContain("Subclasse");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("search by term", () => {
    it("filters subclasses by description and renders a table", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(subclasseList));

      const { markdown: result } = await ibgeCnae({ busca: "software", limite: 20 });

      expect(lastUrl()).toContain("/cnae/subclasses");
      expect(result).toContain('Busca CNAE: "software"');
      expect(result).toContain("Desenvolvimento e licenciamento");
      // restaurante row should be filtered out
      expect(result).not.toContain("Restaurantes e similares");
    });

    it("uses the provided nivel as the search endpoint", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(subclasseList));

      await ibgeCnae({ busca: "software", nivel: "classes", limite: 20 });

      expect(lastUrl()).toContain("/cnae/classes");
    });

    it("returns a no-results message when nothing matches", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(subclasseList));

      const { markdown: result } = await ibgeCnae({ busca: "inexistente-xyz", limite: 20 });

      expect(result).toContain("Nenhuma atividade encontrada");
      expect(result).toContain("ibge_cnae(nivel=");
    });

    it("notes truncation, and says how many actually match", async () => {
      // Até a 5.1.2 a nota dizia só "Mostrando primeiros N": o total real ficava
      // de fora, e `busca` achava tão pouco que quase nunca truncava. Com o
      // acento consertado "comercio" passa a casar 211 subclasses, e apresentar
      // as 20 exibidas como se fossem o total é resposta plausível e errada.
      mockFetch.mockResolvedValueOnce(mockResponse(subclasseList));

      const { markdown: result } = await ibgeCnae({ busca: "Desenvolvimento", limite: 1 });

      expect(result).toContain("Encontradas 2 atividades");
      expect(result).toContain("mostrando as 1 primeiras");
      expect(result).toContain("ver as outras 1");
    });
  });

  describe("get by code", () => {
    it("resolves a section code (single letter)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(secao));

      const { markdown: result } = await ibgeCnae({ codigo: "J", limite: 20 });

      expect(lastUrl()).toContain("/cnae/secoes/J");
      expect(result).toContain("CNAE J");
      expect(result).toContain("Informação e comunicação");
      expect(result).toContain("Observações");
    });

    it("resolves a division code (2 digits)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(divisao));

      const { markdown: result } = await ibgeCnae({ codigo: "62", limite: 20 });

      expect(lastUrl()).toContain("/cnae/divisoes/62");
      expect(result).toContain("Hierarquia");
      expect(result).toContain("**Divisão:**");
    });

    it("resolves a group code (3 digits)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(grupo));

      const { markdown: result } = await ibgeCnae({ codigo: "620", limite: 20 });

      expect(lastUrl()).toBe("https://servicodados.ibge.gov.br/api/v2/cnae/grupos/620");
      expect(result).toContain("**Grupo:**");
    });

    // `toBe` e não `toContain`: a URL defeituosa (`/classes/6201`) é PREFIXO da
    // correta (`/classes/62015`), então um `toContain("/cnae/classes/6201")`
    // passa nas duas — foi exatamente assim que a guarda anterior não viu o
    // defeito. Substring não distingue prefixo; igualdade distingue.
    it("resolves a 5-digit class code straight to the API id", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(classe));

      const { markdown: result } = await ibgeCnae({ codigo: "6201-5", limite: 20 });

      expect(lastUrl()).toBe("https://servicodados.ibge.gov.br/api/v2/cnae/classes/62015");
      expect(result).toContain("**Classe:**");
    });

    // Quatro dígitos é a classe sem o dígito verificador — como bases
    // cadastrais e gente escrevem. Resolve pela lista do grupo; NUNCA vai à URL
    // de quatro dígitos, que a API responde com `[]` e HTTP 200.
    it("resolves a 4-digit class code through the group listing", async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(classesDoGrupo620))
        .mockResolvedValueOnce(mockResponse(classe));

      const { markdown: result } = await ibgeCnae({ codigo: "6201", limite: 20 });

      const urls = mockFetch.mock.calls.map((c) => String(c[0]));
      expect(urls).toEqual([
        "https://servicodados.ibge.gov.br/api/v2/cnae/grupos/620/classes",
        "https://servicodados.ibge.gov.br/api/v2/cnae/classes/62015",
      ]);
      expect(result).toContain("**Classe:**");
    });

    // A saída da tool tem de ser entrada válida: a hierarquia que ela devolve
    // traz {"nivel":"Classe","id":"62015"}, e realimentar esse valor quebrava.
    it("accepts back the class id it emits in the hierarchy", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(subclasse));
      const { structured } = await ibgeCnae({ codigo: "6201501", limite: 20 });

      const hierarquia = (
        structured as { codigo: { hierarquia: Array<{ nivel: string; id: string }> } }
      ).codigo.hierarquia;
      const idDaClasse = hierarquia.find((h) => h.nivel === "Classe")?.id;
      expect(idDaClasse).toBe("62015");

      mockFetch.mockResolvedValueOnce(mockResponse(classe));
      const devolta = await ibgeCnae({ codigo: idDaClasse as string, limite: 20 });

      expect(devolta.isError).toBeFalsy();
      expect(lastUrl()).toBe(`https://servicodados.ibge.gov.br/api/v2/cnae/classes/${idDaClasse}`);
    });

    it("resolves a subclass code (7 digits) with full hierarchy", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(subclasse));

      const { markdown: result } = await ibgeCnae({ codigo: "6201-5/01", limite: 20 });

      expect(lastUrl()).toBe("https://servicodados.ibge.gov.br/api/v2/cnae/subclasses/6201501");
      expect(result).toContain("**Seção:**");
      expect(result).toContain("**Subclasse:**");
    });

    // O defeito medido em produção em 22/09/2026: a API do IBGE responde
    // identificador inexistente com `[]` e HTTP 200 (não 404), o array
    // atravessava a camada de rede com o tipo do chamador e o formatador lia
    // `data.grupo.divisao` -> "Cannot read properties of undefined".
    it("turns an empty-array 200 into a not-found, never a TypeError", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([]));

      const { markdown: result, isError } = await ibgeCnae({ codigo: "6201501", limite: 20 });

      expect(isError).toBe(true);
      expect(result).toContain("nenhum registro encontrado");
      expect(result).not.toContain("Cannot read properties");
    });

    it("rejects an invalid code format without calling the API", async () => {
      const { markdown: result } = await ibgeCnae({ codigo: "123456789", limite: 20 });

      expect(result).toContain("codigo");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("list by level", () => {
    it("lists divisoes and reports the total", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([divisao, { id: "01", descricao: "Agricultura" }]));

      const { markdown: result } = await ibgeCnae({ nivel: "divisoes", limite: 20 });

      expect(lastUrl()).toContain("/cnae/divisoes");
      expect(result).toContain("CNAE - Divisões");
      expect(result).toContain("Total: 2 registros");
    });

    it("notes truncation when more registers than the limit", async () => {
      const many = Array.from({ length: 5 }, (_, i) => ({
        id: String(i),
        descricao: `Item ${i}`,
      }));
      mockFetch.mockResolvedValueOnce(mockResponse(many));

      const { markdown: result } = await ibgeCnae({ nivel: "secoes", limite: 2 });

      expect(result).toContain("Mostrando 2 de 5 registros");
    });
  });

  describe("errors", () => {
    it("surfaces an upstream HTTP error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("HTTP 500: Internal Server Error"));

      const { markdown: result } = await ibgeCnae({ codigo: "J", limite: 20 });

      expect(result).toContain("Erro");
    });
  });
});
