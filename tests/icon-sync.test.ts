/**
 * The server icon lives in THREE places and all three must agree:
 *
 *   1. `assets/icon.png`     — the source; the file you actually edit;
 *   2. `worker/src/icon.ts`  — a base64 copy, because the Worker cannot read a
 *                              file at runtime without an assets binding;
 *   3. `server.json`         — what the MCP Registry publishes and what every
 *                              directory mirrors (`icons[0]`).
 *
 * WHY THIS EXISTS. The duplicated bytes are deliberate and cannot go away, so
 * the risk is DRIFT: swap the icon in `assets/` and forget to regenerate the
 * Worker module, and the `/icon.png` route serves the old image while
 * `server.json` promises the new one — invisibly, because both answer 200. The
 * header comment in `worker/src/icon.ts` asks for the regeneration; a comment
 * is not a gate. This file is.
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

const bytesDoAtivo = (): Buffer => readFileSync(join(raiz, "assets", "icon.png"));

function bytesDoWorker(): Buffer {
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

describe("server icon: asset x worker x manifest", () => {
  it("the Worker base64 is byte-for-byte assets/icon.png", () => {
    expect(bytesDoWorker().equals(bytesDoAtivo())).toBe(true);
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
    const { largura, altura } = dimensoesPng(bytesDoAtivo());
    expect(manifesto()![0]!.mimeType).toBe("image/png");
    expect(manifesto()![0]!.sizes).toEqual([`${largura}x${altura}`]);
  });

  it("the icon fits under Smithery's 1 MB ceiling", () => {
    expect(bytesDoAtivo().byteLength).toBeLessThan(1024 * 1024);
  });
});
