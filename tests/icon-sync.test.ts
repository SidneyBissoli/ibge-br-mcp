/**
 * The server icon is declared in TWO places that must never disagree:
 *
 *   1. `worker/src/icon.ts` — the bytes, base64-inlined, served by the
 *      `/icon.png` route. It is THE source: there is no `assets/` copy;
 *   2. `server.json`        — what the MCP Registry publishes and what every
 *      directory mirrors (`icons[0]`).
 *
 * WHY THIS EXISTS. Until 4.0.2 the bytes lived in two places — a file in
 * `assets/icon.png` and the Worker's base64 copy — because the Worker cannot
 * read a file at runtime without an assets binding. Duplication that cannot go
 * away becomes drift risk: swap one and forget the other, and the route serves
 * one image while the manifest promises another, with no error on either side,
 * because both answer 200. The copy is gone; what is left to guard is the
 * manifest agreeing with what the code actually serves.
 *
 * It lives in the ROOT suite on purpose: this repo's CI runs `npm test` at the
 * root and never runs `worker/tests/`, so a guard placed there would never fire.
 *
 * It also pins `mimeType` and `sizes` to what the image REALLY is — a manifest
 * advertising 512x512 while serving something else is the same class of lie the
 * output-contract test catches in tool responses.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..");

function bytesDoIcone(): Buffer {
  const fonte = readFileSync(join(raiz, "worker", "src", "icon.ts"), "utf8");
  // Match the exported literal instead of importing the module: this test runs
  // under the ROOT vitest, which does not have the worker's tsconfig on path.
  const m = fonte.match(/ICON_PNG_BASE64\s*=\s*\n?\s*"([A-Za-z0-9+/=]+)"/);
  if (!m) throw new Error("ICON_PNG_BASE64 not found in worker/src/icon.ts");
  return Buffer.from(m[1]!, "base64");
}

/** Dimensions read from the PNG IHDR header — no image dependency. */
function dimensoesPng(buf: Buffer): { largura: number; altura: number } {
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("not a PNG");
  }
  return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
}

interface ManifestoIcone {
  src: string;
  mimeType?: string;
  sizes?: string[];
}

const manifesto = (): ManifestoIcone[] | undefined =>
  (JSON.parse(readFileSync(join(raiz, "server.json"), "utf8")) as { icons?: ManifestoIcone[] })
    .icons;

describe("server icon: bytes x manifest x route", () => {
  it("the inlined bytes are a valid PNG, and the only copy", () => {
    expect(() => dimensoesPng(bytesDoIcone())).not.toThrow();
    // An assets/ copy would reintroduce the drift 4.0.2 removed.
    expect(
      () => readFileSync(join(raiz, "assets", "icon.png")),
      "a second copy of the icon is back — worker/src/icon.ts is the single source",
    ).toThrow();
  });

  it("server.json declares the icon served by the server's own domain", () => {
    const icone = manifesto()?.[0];
    expect(
      icone,
      "server.json must declare icons — that is 5 completeness points in the directories",
    ).toBeDefined();
    expect(icone!.src).toBe("https://ibge.sidneybissoli.com/icon.png");
    const indexWorker = readFileSync(join(raiz, "worker", "src", "index.ts"), "utf8");
    expect(indexWorker).toContain('url.pathname === "/icon.png"');
  });

  it("mimeType and sizes describe the image that exists, not a promise", () => {
    const { largura, altura } = dimensoesPng(bytesDoIcone());
    expect(manifesto()![0]!.mimeType).toBe("image/png");
    expect(manifesto()![0]!.sizes).toEqual([`${largura}x${altura}`]);
  });

  it("the icon fits under Smithery's 1 MB ceiling", () => {
    expect(bytesDoIcone().byteLength).toBeLessThan(1024 * 1024);
  });
});
