import { describe, it, expect } from "vitest";
import { cidadesSchema, CidadesInput } from "../src/tools/cidades.js";

describe("cidadesSchema", () => {
  describe("tipo parameter", () => {
    it("should accept valid tipo values", () => {
      const validTypes = ["panorama", "indicador", "pesquisas", "historico"];
      for (const tipo of validTypes) {
        const result = cidadesSchema.safeParse({ tipo });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.tipo).toBe(tipo);
        }
      }
    });

    it("should default to 'panorama' when tipo is not provided", () => {
      const result = cidadesSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tipo).toBe("panorama");
      }
    });

    it("should reject invalid tipo values", () => {
      const result = cidadesSchema.safeParse({ tipo: "invalid" });
      expect(result.success).toBe(false);
    });
  });

  describe("municipio parameter", () => {
    it("should accept valid IBGE municipality codes (7 digits)", () => {
      const validCodes = ["3550308", "3304557", "1100205", "5300108"];
      for (const municipio of validCodes) {
        const result = cidadesSchema.safeParse({ tipo: "panorama", municipio });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.municipio).toBe(municipio);
        }
      }
    });

    it("should be optional", () => {
      const result = cidadesSchema.safeParse({ tipo: "pesquisas" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.municipio).toBeUndefined();
      }
    });
  });

  describe("uf parameter", () => {
    it("should accept UF codes", () => {
      const ufCodes = ["35", "33", "31", "53"];
      for (const uf of ufCodes) {
        const result = cidadesSchema.safeParse({ tipo: "indicador", uf });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.uf).toBe(uf);
        }
      }
    });

    it("should accept UF abbreviations", () => {
      const ufSiglas = ["SP", "RJ", "MG", "DF"];
      for (const uf of ufSiglas) {
        const result = cidadesSchema.safeParse({ tipo: "indicador", uf });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.uf).toBe(uf);
        }
      }
    });

    it("should be optional", () => {
      const result = cidadesSchema.safeParse({ tipo: "panorama" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.uf).toBeUndefined();
      }
    });
  });

  describe("indicador parameter", () => {
    it("should accept indicator aliases", () => {
      const aliases = [
        "populacao",
        "densidade",
        "pib_per_capita",
        "idh",
        "escolarizacao",
        "mortalidade",
        "salario_medio",
        "area",
      ];
      for (const indicador of aliases) {
        const result = cidadesSchema.safeParse({
          tipo: "indicador",
          indicador,
          municipio: "3550308",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.indicador).toBe(indicador);
        }
      }
    });

    it("should accept numeric indicator IDs", () => {
      const result = cidadesSchema.safeParse({
        tipo: "indicador",
        indicador: "29171",
        municipio: "3550308",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.indicador).toBe("29171");
      }
    });

    it("should be optional", () => {
      const result = cidadesSchema.safeParse({ tipo: "panorama" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.indicador).toBeUndefined();
      }
    });
  });

  describe("pesquisa parameter", () => {
    it("should accept research IDs", () => {
      const pesquisaIds = ["33", "37", "38", "39", "40"];
      for (const pesquisa of pesquisaIds) {
        const result = cidadesSchema.safeParse({ tipo: "pesquisas", pesquisa });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.pesquisa).toBe(pesquisa);
        }
      }
    });

    it("should be optional", () => {
      const result = cidadesSchema.safeParse({ tipo: "pesquisas" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pesquisa).toBeUndefined();
      }
    });
  });

  describe("combined parameters", () => {
    it("should accept panorama with municipio", () => {
      const input = {
        tipo: "panorama",
        municipio: "3550308",
      };
      const result = cidadesSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tipo).toBe("panorama");
        expect(result.data.municipio).toBe("3550308");
      }
    });

    it("should accept historico with municipio and indicador", () => {
      const input = {
        tipo: "historico",
        municipio: "3550308",
        indicador: "populacao",
      };
      const result = cidadesSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tipo).toBe("historico");
        expect(result.data.municipio).toBe("3550308");
        expect(result.data.indicador).toBe("populacao");
      }
    });

    it("should accept indicador with all parameters", () => {
      const input: CidadesInput = {
        tipo: "indicador",
        municipio: "3550308",
        uf: "SP",
        indicador: "idh",
      };
      const result = cidadesSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tipo).toBe("indicador");
        expect(result.data.municipio).toBe("3550308");
        expect(result.data.uf).toBe("SP");
        expect(result.data.indicador).toBe("idh");
      }
    });
  });
});

describe("CidadesInput type", () => {
  it("should be correctly inferred from schema", () => {
    // Type check - will fail at compile time if types don't match
    const input: CidadesInput = {
      tipo: "panorama",
      municipio: "3550308",
      uf: "SP",
      indicador: "populacao",
      pesquisa: "33",
    };
    expect(input.tipo).toBe("panorama");
  });
});

describe("municipality codes validation", () => {
  it("should accept São Paulo code", () => {
    const result = cidadesSchema.safeParse({
      tipo: "panorama",
      municipio: "3550308",
    });
    expect(result.success).toBe(true);
  });

  it("should accept Rio de Janeiro code", () => {
    const result = cidadesSchema.safeParse({
      tipo: "panorama",
      municipio: "3304557",
    });
    expect(result.success).toBe(true);
  });

  it("should accept Brasília code", () => {
    const result = cidadesSchema.safeParse({
      tipo: "panorama",
      municipio: "5300108",
    });
    expect(result.success).toBe(true);
  });

  it("should accept Porto Velho code", () => {
    const result = cidadesSchema.safeParse({
      tipo: "panorama",
      municipio: "1100205",
    });
    expect(result.success).toBe(true);
  });
});
