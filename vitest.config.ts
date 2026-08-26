import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/tools/index.ts"],
      // PISO DE COBERTURA, não meta: `npm run test:coverage` (que o CI roda)
      // FALHA se a cobertura cair abaixo daqui. Existe para que o número do
      // README não possa apodrecer em silêncio — foi assim que o badge chegou
      // a anunciar 456 testes com 565 no repositório. Medido em 2026-08-26:
      // statements 88,53 · branches 74,61 · functions 91,95 · lines 88,80.
      // O piso fica pouco abaixo do medido, para variação normal não quebrar o
      // CI. Ao subir a cobertura de verdade, suba o piso E o badge do README
      // (os dois READMEs) na mesma passada — o badge espelha ESTES números.
      thresholds: {
        statements: 88,
        branches: 74,
        functions: 90,
        lines: 88,
      },
    },
    testTimeout: 10000,
  },
});
