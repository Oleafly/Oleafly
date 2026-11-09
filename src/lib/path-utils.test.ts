import { describe, expect, it } from "vitest";
import { basename, dirname, exportFileStem, isSeparator, numberedPath, relativeFilePath } from "./path-utils";

describe("numberedPath", () => {
  const takenFrom = (paths: string[]) => {
    const taken = new Set(paths.map((path) => path.toLowerCase()));
    return (path: string) => taken.has(path.toLowerCase());
  };

  it("keeps a free path and numbers a taken one before its extension", () => {
    expect(numberedPath("figures/plot.png", takenFrom([]))).toBe("figures/plot.png");
    expect(numberedPath("figures/plot.png", takenFrom(["figures/plot.png"]))).toBe("figures/plot-2.png");
    expect(numberedPath("figures/PLOT.png", takenFrom(["figures/plot.png", "figures/plot-2.png"]))).toBe("figures/PLOT-3.png");
    expect(numberedPath("notes/Plan v1.2.md", takenFrom(["notes/plan v1.2.md"]))).toBe("notes/Plan v1.2-2.md");
  });

  it("numbers names without an extension, dot files and dotted folders at the end", () => {
    expect(numberedPath("notes/README", takenFrom(["notes/readme"]))).toBe("notes/README-2");
    expect(numberedPath("notes/.hidden", takenFrom(["notes/.hidden"]))).toBe("notes/.hidden-2");
    expect(numberedPath("v1.0/data", takenFrom(["v1.0/data"]))).toBe("v1.0/data-2");
  });
});

describe("exportFileStem", () => {
  it("avoids names Windows reserves", () => {
    expect(exportFileStem("Aux", "document")).toBe("document_Aux");
    expect(exportFileStem("con.draft", "document")).toBe("document_con.draft");
    expect(exportFileStem("Auxiliary notes", "document")).toBe("Auxiliary_notes");
  });

  it("keeps letters and numbers from every script", () => {
    expect(exportFileStem("论文 初稿", "document")).toBe("论文_初稿");
    expect(exportFileStem("Überblick 2026", "document")).toBe("Überblick_2026");
    expect(exportFileStem("研究ノート", "document")).toBe("研究ノート");
    expect(exportFileStem("한국어 논문", "document")).toBe("한국어_논문");
    expect(exportFileStem("शोध पत्र", "document")).toBe("शोध_पत्र");
  });

  it("replaces path and shell characters and trims the edges", () => {
    expect(exportFileStem("My paper", "document")).toBe("My_paper");
    expect(exportFileStem("a/b\\c:d", "document")).toBe("a_b_c_d");
    expect(exportFileStem("  paper.  ", "document")).toBe("paper");
    expect(exportFileStem("v1.2-final", "document")).toBe("v1.2-final");
  });

  it("falls back when no usable name is left", () => {
    expect(exportFileStem("", "figure")).toBe("figure");
    expect(exportFileStem(null, "figure")).toBe("figure");
    expect(exportFileStem("...", "document")).toBe("document");
    expect(exportFileStem("!!!", "document")).toBe("document");
  });
});

describe("isSeparator", () => {
  it("accepts either slash and nothing else", () => {
    expect(isSeparator("/")).toBe(true);
    expect(isSeparator("\\")).toBe(true);
    expect(isSeparator(":")).toBe(false);
    expect(isSeparator(undefined)).toBe(false);
  });
});

describe("basename", () => {
  it("returns the last segment of a project path", () => {
    expect(basename("chapters/intro.tex")).toBe("intro.tex");
    expect(basename("main.tex")).toBe("main.tex");
    expect(basename("/abs/dir/file.bib")).toBe("file.bib");
  });

  it("splits Windows paths and mixed separators", () => {
    expect(basename(String.raw`C:\Users\ada\paper\main.tex`)).toBe("main.tex");
    expect(basename(String.raw`figures\plots/fig.pdf`)).toBe("fig.pdf");
    expect(basename(String.raw`figures/plots\fig.pdf`)).toBe("fig.pdf");
  });

  it("keeps the empty tail of a path that ends in a separator", () => {
    expect(basename("figures/")).toBe("");
    expect(basename("")).toBe("");
  });
});

describe("dirname", () => {
  it("returns everything before the last segment", () => {
    expect(dirname("chapters/part/intro.tex")).toBe("chapters/part");
    expect(dirname("main.tex")).toBe("");
    expect(dirname("/main.tex")).toBe("");
  });

  it("splits Windows paths and mixed separators", () => {
    expect(dirname(String.raw`C:\paper\main.tex`)).toBe(String.raw`C:\paper`);
    expect(dirname(String.raw`a\b/c.tex`)).toBe(String.raw`a\b`);
  });
});

describe("relativeFilePath", () => {
  it("writes a project path relative to the folder of a file", () => {
    expect(relativeFilePath("notes/a.md", "notes/b.md")).toBe("b.md");
    expect(relativeFilePath("notes/a.md", "img/x.png")).toBe("../img/x.png");
    expect(relativeFilePath("main.tex", "chapters/intro.tex")).toBe("chapters/intro.tex");
    expect(relativeFilePath("a/b/c.typ", "a/d/e.typ")).toBe("../d/e.typ");
    expect(relativeFilePath("", "notes/b.md")).toBe("notes/b.md");
  });

  it("keeps the file name when a folder shares the target's name", () => {
    expect(relativeFilePath("notes/notes.md", "notes")).toBe("../notes");
    expect(relativeFilePath("notes/a.md", "notes/a.md")).toBe("a.md");
  });
});
