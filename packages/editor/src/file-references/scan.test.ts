import { describe, expect, it } from "vitest";
import {
  latexSearchPaths,
  pathReferenceAt,
  referenceLanguageForPath,
  resolvePathReference,
  scanPathReferences,
} from "./index";

describe("referenceLanguageForPath", () => {
  it("maps source extensions to languages", () => {
    expect(referenceLanguageForPath("a/b.tex")).toBe("latex");
    expect(referenceLanguageForPath("style.STY")).toBe("latex");
    expect(referenceLanguageForPath("thesis.cls")).toBe("latex");
    expect(referenceLanguageForPath("main.typ")).toBe("typst");
    expect(referenceLanguageForPath("README.md")).toBe("markdown");
    expect(referenceLanguageForPath("notes.markdown")).toBe("markdown");
    expect(referenceLanguageForPath("refs.bib")).toBeNull();
    expect(referenceLanguageForPath("figure.png")).toBeNull();
  });
});

describe("scanPathReferences", () => {
  it("reports the path span inside the argument", () => {
    const text = "\\includegraphics*[width=2cm][x]{ figs/a }";
    const [reference] = scanPathReferences("latex", text);
    expect(reference).toMatchObject({ kind: "tex-graphics", command: "includegraphics", raw: "figs/a" });
    expect(text.slice(reference.from, reference.to)).toBe("figs/a");
  });

  it("reports import directories as their own span", () => {
    const text = "\\subimport*{parts/}{intro}";
    const [reference] = scanPathReferences("latex", text);
    expect(reference.raw).toBe("intro");
    expect(reference.directory?.raw).toBe("parts/");
  });

  it("splits comma lists into one reference per item", () => {
    const references = scanPathReferences("latex", "\\bibliography{a, b ,c}");
    expect(references.map((reference) => reference.raw)).toEqual(["a", "b", "c"]);
  });

  it("returns graphicspath entries as directory references", () => {
    const references = scanPathReferences("latex", "\\graphicspath{{figs/}{./img/}}");
    expect(references.map((reference) => [reference.kind, reference.raw])).toEqual([
      ["tex-graphicspath", "figs/"],
      ["tex-graphicspath", "./img/"],
    ]);
  });

  it("does not mistake longer command names for path commands", () => {
    expect(scanPathReferences("latex", "\\bibliographystyle{plain}\\inputencoding{utf8}")).toEqual([]);
  });

  it("recognises every path command by its whole name", () => {
    const single = [
      "input",
      "include",
      "includeonly",
      "InputIfFileExists",
      "subfile",
      "includegraphics",
      "includesvg",
      "includepdf",
      "includestandalone",
      "lstinputlisting",
      "verbatiminput",
      "bibliography",
      "addbibresource",
      "addglobalbib",
      "addsectionbib",
      "usepackage",
      "RequirePackage",
      "documentclass",
    ];
    for (const name of single) {
      expect(scanPathReferences("latex", `\\${name}{a}`).map((reference) => reference.command)).toEqual([name]);
      expect(scanPathReferences("latex", `\\${name}@{a}\\${name}x{a}\\${name.slice(0, -1)}{a}`)).toEqual([]);
    }
    expect(scanPathReferences("latex", "\\inputminted{tex}{a}").map((reference) => reference.raw)).toEqual(["a"]);
    expect(scanPathReferences("latex", "\\import{d/}{a}\\subimport{e/}{b}").map((reference) => reference.kind)).toEqual([
      "tex-import",
      "tex-subimport",
    ]);
    expect(scanPathReferences("latex", "\\svgpath{{s/}}").map((reference) => reference.kind)).toEqual(["tex-svgpath"]);
  });

  it("finds a path command right after another command", () => {
    const references = scanPathReferences("latex", "\\relax\\input{a}\\foo@bar\\include{b}\\\\input{c}");
    expect(references.map((reference) => [reference.command, reference.raw])).toEqual([
      ["input", "a"],
      ["include", "b"],
      ["input", "c"],
    ]);
  });
});

describe("pathReferenceAt", () => {
  it("finds the LaTeX path under the caret", () => {
    const text = "See \\includegraphics[width=1cm]{figs/a} here";
    const inside = text.indexOf("figs") + 2;
    expect(pathReferenceAt("latex", text, inside)?.raw).toBe("figs/a");
    expect(pathReferenceAt("latex", text, text.indexOf("}"))?.raw).toBe("figs/a");
    expect(pathReferenceAt("latex", text, text.indexOf("width"))).toBeNull();
    expect(pathReferenceAt("latex", text, 2)).toBeNull();
  });

  it("finds Typst strings and Markdown destinations", () => {
    const typst = '#image("figs/a.png", width: 2cm)';
    expect(pathReferenceAt("typst", typst, typst.indexOf("a.png"))?.raw).toBe("figs/a.png");
    expect(pathReferenceAt("typst", typst, typst.indexOf("2cm"))).toBeNull();
    const markdown = "Look at ![plot](figs/a.png#top) now";
    expect(pathReferenceAt("markdown", markdown, markdown.indexOf("a.png"))?.raw).toBe("figs/a.png");
    expect(pathReferenceAt("markdown", markdown, markdown.indexOf("plot"))).toBeNull();
  });

  it("counts the caret on the import directory as the reference", () => {
    const text = "\\import{chapters/}{intro}";
    expect(pathReferenceAt("latex", text, text.indexOf("chapters"))?.raw).toBe("intro");
  });
});

describe("resolvePathReference", () => {
  const project = {
    files: ["main.tex", "figures/plot.pdf", "figures/plot.png", "chapters/a.tex", "doc/notes.md", "doc/img.png"],
    mainDoc: "main.tex",
  };

  it("resolves graphics through graphicspath with engine extension order", () => {
    const sources = [{ path: "main.tex", text: "\\graphicspath{{figures/}}" }];
    const [reference] = scanPathReferences("latex", "\\includegraphics{plot}");
    expect(
      resolvePathReference(reference, {
        sourcePath: "chapters/a.tex",
        project,
        searchPaths: latexSearchPaths(sources),
      }),
    ).toEqual({ path: "figures/plot.pdf", directory: false });
  });

  it("resolves Markdown relative to the file and returns null for unknown paths", () => {
    const [found] = scanPathReferences("markdown", "![x](img.png)");
    expect(resolvePathReference(found, { sourcePath: "doc/notes.md", project })).toEqual({
      path: "doc/img.png",
      directory: false,
    });
    const [missing] = scanPathReferences("markdown", "![x](nothing.png)");
    expect(resolvePathReference(missing, { sourcePath: "doc/notes.md", project })).toBeNull();
  });

  it("resolves directory references", () => {
    const [reference] = scanPathReferences("latex", "\\graphicspath{{figures/}}");
    expect(resolvePathReference(reference, { sourcePath: "main.tex", project })).toEqual({
      path: "figures",
      directory: true,
    });
  });
});
