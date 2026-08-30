import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Este repositório carrega DOIS TypeScript de propósito (2026-08-30):
 *
 *  - `typescript-7`, alias de typescript@^7, é o COMPILADOR: build e typecheck.
 *  - `typescript` é o shim @typescript/typescript6, que expõe a API da 6.
 *    typescript-eslint faz `require("typescript")` e RECUSA a 7 já no import
 *    (typescript-eslint#10940); sem o shim, `npm run lint` nem carrega. É o
 *    arranjo lado a lado que a própria equipe do TypeScript recomenda.
 *
 * A armadilha: o shim depende do compilador 6 de verdade, que é içado e fica
 * com o bin `tsc`. Conferido em instalação limpa — depois de `npm ci`,
 * `npx tsc` é a 6.0.3, não a 7. Um `tsc` pelado em script ou em workflow
 * compila com a 6 e PASSA: gate auditando com compilador velho, em silêncio.
 * Por isso todo script que compila chama o binário da 7 pelo caminho.
 *
 * Nada aqui pina versão. O major esperado sai do range declarado no
 * package.json e a fronteira da 6 sai do peerDependencies do próprio
 * typescript-eslint — quando ele suportar a 7, o teste afrouxa sozinho e o
 * arranjo pode ser desmontado.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");
const pkg = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

const majorOf = (v: string) => Number(v.match(/(\d+)/)?.[1]);

describe("toolchain TypeScript", () => {
  it("declara o compilador como alias de uma major que o package.json fixa", () => {
    const spec = pkg.devDependencies["typescript-7"];
    expect(spec, "devDependency `typescript-7` sumiu").toBeDefined();
    expect(spec).toMatch(/^npm:typescript@/);
  });

  it("o compilador que o build de fato roda é a major declarada", () => {
    const declared = majorOf(pkg.devDependencies["typescript-7"].replace("npm:typescript@", ""));
    const [bin, ...args] = pkg.scripts.build.split(/\s+/);
    const out = execFileSync(bin, [...args, "--version"], { cwd: root, encoding: "utf8" });
    expect(majorOf(out.replace(/^\D+/, "")), `build compila com ${out.trim()}`).toBe(declared);
  });

  it("nenhum script chama `tsc` pelado — o bin do PATH é o compilador 6", () => {
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      expect(cmd, `script \`${name}\` chama tsc pelado`).not.toMatch(/(^|[\s&|;])tsc(\s|$)/);
    }
  });

  it("nenhum workflow chama `tsc` pelado", () => {
    const dir = join(root, ".github", "workflows");
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const body = read(join(".github", "workflows", f));
      expect(body, `${f} chama tsc pelado`).not.toMatch(/(npx |[\s&|;])tsc(\s|$)/);
    }
  });

  it("a API que o typescript-eslint enxerga cabe no peer que ele declara", () => {
    const p = join(root, "node_modules", "typescript-eslint", "package.json");
    if (!existsSync(p)) return; // sem o plugin, o shim não precisa existir
    const peer = (JSON.parse(readFileSync(p, "utf8")) as { peerDependencies?: Record<string, string> })
      .peerDependencies?.typescript;
    if (!peer) return;
    const cap = Number(peer.match(/<\s*(\d+)\./)?.[1]);
    if (!Number.isFinite(cap)) return; // peer sem teto: nada a impedir
    const api = createRequire(join(root, "package.json"))("typescript") as { version: string };
    expect(majorOf(api.version), `require("typescript") entrega ${api.version}`).toBeLessThanOrEqual(cap);
  });
});

