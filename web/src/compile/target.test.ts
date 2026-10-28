import { describe, expect, it } from "vitest";
import type { WebFile } from "../protocol";
import { compileTargetOf, projectFileFor } from "./target";

const file = (fileId: string, path: string, kind: WebFile["kind"] = "text"): WebFile => ({ fileId, path, kind, blob: null });
const FILES = [file("a", "main.tex"), file("b", "paper/thesis.tex"), file("c", "notes.typ"), file("d", "fig.png", "blob")];

describe("compileTargetOf", () => {
  it("uses the main document and engine the project stores", () => {
    expect(compileTargetOf({ main_doc: "b", engine: "latexmk", tex_flavor: "xelatex" }, FILES)).toEqual({
      mainDocument: "paper/thesis.tex",
      engine: "latexmk",
      texFlavor: "xelatex",
    });
  });

  it("falls back to the likeliest main file and the engine its extension implies", () => {
    expect(compileTargetOf({}, FILES)).toEqual({ mainDocument: "main.tex", engine: "latex", texFlavor: null });
    expect(compileTargetOf({ main_doc: "c" }, FILES)).toMatchObject({ mainDocument: "notes.typ", engine: "typst" });
  });

  it("picks like the app without stored settings: root names first, then the shallowest source, never a note", () => {
    expect(compileTargetOf({}, [file("r", "README.md"), file("x", "paper/a.ltx")])).toMatchObject({
      mainDocument: "paper/a.ltx",
      engine: "latex",
    });
    expect(compileTargetOf({}, [file("a", "a.md"), file("q", "main.qmd")])).toMatchObject({
      mainDocument: "main.qmd",
      engine: "quarto",
    });
    expect(compileTargetOf({}, [file("r", "README.md"), file("b", "refs.bib")])).toBeNull();
  });

  it("ignores a stored main document that is gone or not text, and values it doesn't know", () => {
    expect(compileTargetOf({ main_doc: "zz", engine: "warp", tex_flavor: "context" }, FILES)).toEqual({
      mainDocument: "main.tex",
      engine: "latex",
      texFlavor: null,
    });
    expect(compileTargetOf({ main_doc: "d" }, FILES)?.mainDocument).toBe("main.tex");
  });

  it("has nothing to compile in a project without text files", () => {
    expect(compileTargetOf({}, [file("d", "fig.png", "blob")])).toBeNull();
  });
});

describe("projectFileFor", () => {
  it("finds the project file a log or SyncTeX path names", () => {
    expect(projectFileFor("./paper/thesis.tex", FILES)?.fileId).toBe("b");
    expect(projectFileFor("/home/ana/project/paper/thesis.tex", FILES)?.fileId).toBe("b");
    expect(projectFileFor("C:\\Users\\ana\\project\\main.tex", FILES)?.fileId).toBe("a");
    expect(projectFileFor("/usr/share/texmf/article.cls", FILES)).toBeNull();
    expect(projectFileFor("fig.png", FILES)).toBeNull();
    expect(projectFileFor("", FILES)).toBeNull();
  });
});
