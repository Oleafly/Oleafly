import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { typstFigureMarkup, typstPreviewSource } from "./typst-figure";

const TRIPLES: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
};
const triple = TRIPLES[`${process.platform}-${process.arch}`];
const binaries = fileURLToPath(new URL("../../../src-tauri/binaries/", import.meta.url));
const typst = triple
  ? join(binaries, `typst-${triple}${process.platform === "win32" ? ".exe" : ""}`)
  : "";
const SNIPPET_PAGE = "#set page(width: auto, height: auto, margin: 2pt, fill: none)\n";

function compile(source: string, output: string): void {
  const dir = mkdtempSync(join(tmpdir(), "oleafly-typst-figure-"));
  try {
    writeFileSync(join(dir, "main.typ"), source);
    execFileSync(
      typst,
      ["compile", "--root", dir, join(dir, "main.typ"), join(dir, output)],
      { timeout: 30_000, stdio: "pipe" },
    );
    expect(existsSync(join(dir, output))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!typst || !existsSync(typst))("Typst figures with the bundled Typst", () => {
  it("compiles an inserted figure that the text references by its label", () => {
    const figure = typstFigureMarkup('#rect(width: 2cm)[A]\n\n#text(fill: blue)["quoted"]', {
      caption: "A box with $x^2$",
      label: "fig: a box",
    });

    compile(`= Results\nSee @fig:-a-box.\n\n${figure}\n`, "main.pdf");
  });

  it("renders the preview source the way the snippet renderer wraps it", () => {
    compile(`${SNIPPET_PAGE}${typstPreviewSource("#circle(radius: 4mm)")}\n`, "main.png");
  });
});
