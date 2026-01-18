import { describe, it, expect } from "vitest";
import { paisesSchema, PaisesInput } from "../src/tools/paises.js";

describe("paisesSchema", () => {
  describe("tipo parameter", () => {
    it("should accept valid tipo values", () => {
      const validTypes = ["listar", "detalhes", "indicadores", "buscar"];
      for (const tipo of validTypes) {
        const result = paisesSchema.safeParse({ tipo });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.tipo).toBe(tipo);
        }
      }
    });

    it("should default to 'listar' when tipo is not provided", () => {
      const result = paisesSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tipo).toBe("listar");
      }
    });

    it("should reject invalid tipo values", () => {
      const result = paisesSchema.safeParse({ tipo: "invalid" });
      expect(result.success).toBe(false);
    });
  });

  describe("pais parameter", () => {
    it("should accept ISO-ALPHA-2 country codes", () => {
      const codes = ["BR", "US", "AR", "PT", "JP", "CN"];
      for (const pais of codes) {
        const result = paisesSchema.safeParse({ tipo: "detalhes", pais });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.pais).toBe(pais);
        }
      }
    });

    it("should accept lowercase country codes", () => {
      const result = paisesSchema.safeParse({ tipo: "detalhes", pais: "br" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pais).toBe("br");
      }
    });

    it("should be optional", () => {
      const result = paisesSchema.safeParse({ tipo: "listar" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pais).toBeUndefined();
      }
    });
  });

  describe("busca parameter", () => {
    it("should accept search terms", () => {
      const searchTerms = ["Brasil", "United", "Argentina", "Japão"];
      for (const busca of searchTerms) {
        const result = paisesSchema.safeParse({ tipo: "buscar", busca });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.busca).toBe(busca);
        }
      }
    });

    it("should be optional", () => {
      const result = paisesSchema.safeParse({ tipo: "listar" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.busca).toBeUndefined();
      }
    });
  });

  describe("regiao parameter", () => {
    it("should accept valid region names", () => {
      const regions = ["americas", "europa", "africa", "asia", "oceania"];
      for (const regiao of regions) {
        const result = paisesSchema.safeParse({ tipo: "listar", regiao });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.regiao).toBe(regiao);
        }
      }
    });

    it("should be optional", () => {
      const result = paisesSchema.safeParse({ tipo: "listar" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.regiao).toBeUndefined();
      }
    });
  });

  describe("indicadores parameter", () => {
    it("should accept indicator IDs", () => {
      const result = paisesSchema.safeParse({ indicadores: "77819|77820" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.indicadores).toBe("77819|77820");
      }
    });

    it("should accept single indicator", () => {
      const result = paisesSchema.safeParse({ indicadores: "77819" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.indicadores).toBe("77819");
      }
    });
  });

  describe("combined parameters", () => {
    it("should accept all parameters together", () => {
      const input: PaisesInput = {
        tipo: "buscar",
        busca: "Brazil",
        regiao: "americas",
      };
      const result = paisesSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tipo).toBe("buscar");
        expect(result.data.busca).toBe("Brazil");
        expect(result.data.regiao).toBe("americas");
      }
    });

    it("should accept detalhes with pais", () => {
      const input = { tipo: "detalhes", pais: "BR" };
      const result = paisesSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tipo).toBe("detalhes");
        expect(result.data.pais).toBe("BR");
      }
    });
  });
});

describe("PaisesInput type", () => {
  it("should be correctly inferred from schema", () => {
    // Type check - will fail at compile time if types don't match
    const input: PaisesInput = {
      tipo: "listar",
      pais: "BR",
      busca: "test",
      indicadores: "77819",
      regiao: "americas",
    };
    expect(input.tipo).toBe("listar");
  });
});
