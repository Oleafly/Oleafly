import { parseLatexLog } from "@oleafly/latex";
import { gunzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import type { CompileSources } from "./browser";
import { CompileStopped, type CompileTarget } from "./port";
import { createFakeEngine } from "./testing";

const target: CompileTarget = { mainDocument: "main.tex", engine: "latex", texFlavor: null };

function sources(texts: Record<string, string>): CompileSources {
  return {
    files: Object.keys(texts).map((path) => ({ path, kind: "text" as const })),
    text: (path) => texts[path] ?? null,
    bytes: async () => null,
  };
}

const MAIN = [
  "\\documentclass{article}",
  "\\begin{document}",
  "First line of the body.",
  "",
  "% a comment",
  "\\input{sections/intro}",
  "Last line.",
  "\\end{document}",
].join("\n");

async function run(texts: Record<string, string>, options = {}) {
  const controller = new AbortController();
  return createFakeEngine(options).run({ target, sources: sources(texts), signal: controller.signal });
}

describe("createFakeEngine", () => {
  it("accepts the engines it stands in for", () => {
    const engine = createFakeEngine({ engines: ["typst"] });
    expect(engine.accepts({ ...target, engine: "typst" })).toBe(true);
    expect(engine.accepts(target)).toBe(false);
  });

  it("typesets the body lines and inputs into a PDF and a SyncTeX file", async () => {
    const result = await run({ "main.tex": MAIN, "sections/intro.tex": "Intro text here.\n\nMore intro." });
    expect(result.ok).toBe(true);
    const pdf = strFromU8(result.pdf ?? new Uint8Array());
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("(First line of the body.) Tj");
    expect(pdf).toContain("(Intro text here.) Tj");
    expect(pdf).not.toContain("documentclass");
    const synctex = strFromU8(gunzipSync(result.synctex ?? new Uint8Array()));
    expect(synctex).toContain("Input:1:main.tex");
    expect(synctex).toContain("Input:2:sections/intro.tex");
    expect(synctex).toMatch(/^\(1,3:/mu);
    expect(synctex).toMatch(/^\(2,3:/mu);
    expect(synctex).toMatch(/^\(1,7:/mu);
  });

  it("writes byte-identical output for the same input", async () => {
    const texts = { "main.tex": MAIN, "sections/intro.tex": "Intro." };
    const [one, two] = await Promise.all([run(texts), run(texts)]);
    expect(one.pdf).toEqual(two.pdf);
    expect(one.synctex).toEqual(two.synctex);
  });

  it("puts a long document on several pages", async () => {
    const body = Array.from({ length: 90 }, (_, index) => `Line ${index + 1}.`).join("\n");
    const result = await run({ "main.tex": body });
    expect(strFromU8(result.pdf ?? new Uint8Array())).toContain("/Count 3");
    expect(strFromU8(gunzipSync(result.synctex ?? new Uint8Array()))).toContain("{3");
  });

  it("fails on \\fakeerror with a TeX error the log reader places", async () => {
    const result = await run({ "main.tex": MAIN, "sections/intro.tex": "Fine.\n\\fakeerror here" });
    expect(result.ok).toBe(false);
    expect(result.pdf).not.toBeNull();
    expect(parseLatexLog(result.log, "main.tex")).toEqual([
      expect.objectContaining({ severity: "error", file: "./sections/intro.tex", line: 2 }),
    ]);
  });

  it("fails without a PDF when the main document is missing", async () => {
    const result = await run({ "other.tex": "x" });
    expect(result).toMatchObject({ ok: false, pdf: null, synctex: null });
    expect(result.log).toContain("main.tex");
  });

  it("stops while it waits", async () => {
    const controller = new AbortController();
    const running = createFakeEngine({ delayMs: 1_000 }).run({
      target,
      sources: sources({ "main.tex": "x" }),
      signal: controller.signal,
    });
    controller.abort();
    await expect(running).rejects.toBeInstanceOf(CompileStopped);
  });
});
