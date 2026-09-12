import { describe, it, expect } from "vitest";
import { prepareAccessibleSource } from "./accessible-prep";

const DOC = "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}";

describe("prepareAccessibleSource: DocumentMetadata", () => {
  it("adds \\DocumentMetadata as the very first line when missing", () => {
    const { output } = prepareAccessibleSource(DOC);
    expect(output.startsWith("\\DocumentMetadata{")).toBe(true);
    expect(output).toMatch(/tagging\s*=\s*on/);
    expect(output).toMatch(/pdfstandard\s*=\s*ua-2/);
    expect(output).toMatch(/lang\s*=/);
  });

  it("uses the requested language", () => {
    const { output } = prepareAccessibleSource(DOC, { lang: "fr-FR" });
    expect(output).toMatch(/lang\s*=\s*fr-FR/);
  });

  it("merges missing keys into an existing DocumentMetadata rather than duplicating it", () => {
    const src = "\\DocumentMetadata{lang=en-US}\n" + DOC;
    const { output } = prepareAccessibleSource(src);
    expect(output.match(/\\DocumentMetadata/g) ?? []).toHaveLength(1);
    expect(output).toMatch(/tagging\s*=\s*on/);
  });

  it("records the change", () => {
    const { changes } = prepareAccessibleSource(DOC);
    expect(changes.some((c) => c.summary.key === "prep.metadataAdded")).toBe(true);
  });
});

describe("prepareAccessibleSource: unicode-math", () => {
  it("adds unicode-math for a Unicode engine that needs it", () => {
    const { output } = prepareAccessibleSource(DOC, { engine: "lualatex" });
    expect(output).toMatch(/\\usepackage\{unicode-math\}/);
  });
  it("leaves unicode-math out for pdfLaTeX, which it breaks", () => {
    const { output } = prepareAccessibleSource(DOC, { engine: "pdflatex" });
    expect(output).not.toMatch(/unicode-math/);
  });
  it("leaves unicode-math out when the engine is not known", () => {
    const { output } = prepareAccessibleSource(DOC);
    expect(output).not.toMatch(/unicode-math/);
  });
  it("does not add unicode-math twice", () => {
    const src = "\\documentclass{article}\n\\usepackage{unicode-math}\n\\begin{document}x\\end{document}";
    const { output } = prepareAccessibleSource(src, { engine: "lualatex" });
    expect(output.match(/\\usepackage\{unicode-math\}/g) ?? []).toHaveLength(1);
  });
});

describe("prepareAccessibleSource: tables", () => {
  const WITH_TABLE = "\\documentclass{article}\n\\begin{document}\n\\begin{tabular}{ll}a&b\\\\\\hline c&d\\end{tabular}\n\\end{document}";

  it("declares the header row when the document has a table", () => {
    const { output, changes } = prepareAccessibleSource(WITH_TABLE);
    expect(output).toMatch(/tagging-setup=\{table\/header-rows=\{1\}\}/);
    expect(changes.some((c) => c.summary.key === "prep.headerRows")).toBe(true);
  });

  it("does not declare header rows for a document with no table", () => {
    expect(prepareAccessibleSource(DOC).output).not.toMatch(/header-rows/);
  });

  it("merges header rows into an existing DocumentMetadata and stays stable", () => {
    const src = `\\DocumentMetadata{lang=en-US}\n${WITH_TABLE}`;
    const once = prepareAccessibleSource(src).output;
    expect(once.match(/\\DocumentMetadata/g) ?? []).toHaveLength(1);
    expect(once).toMatch(/tagging-setup=\{table\/header-rows=\{1\}\}/);
    expect(prepareAccessibleSource(once).output).toBe(once);
  });

  it("does not overwrite a tagging-setup the author already wrote", () => {
    const src = `\\DocumentMetadata{lang=en-US,tagging-setup={table/header-rows={2}}}\n${WITH_TABLE}`;
    const { output, changes } = prepareAccessibleSource(src);
    expect(output).toMatch(/header-rows=\{2\}/);
    expect(output).not.toMatch(/header-rows=\{1\}/);
    expect(changes.some((c) => c.summary.key === "prep.headerRows")).toBe(false);
  });

  it("merges header rows into a tagging-setup that is already there for something else", () => {
    const src = `\\DocumentMetadata{lang=en-US,tagging-setup={math/setup=mathml-SE}}\n${WITH_TABLE}`;
    const { output, changes } = prepareAccessibleSource(src);
    expect(output).toMatch(/tagging-setup=\{math\/setup=mathml-SE,table\/header-rows=\{1\}\}/);
    expect(changes.some((c) => c.summary.key === "prep.headerRows")).toBe(true);
    expect(prepareAccessibleSource(output).output).toBe(output);
  });

  it("reports the header-rows change only when it really set one", () => {
    const noTable = prepareAccessibleSource(DOC);
    expect(noTable.changes.some((c) => c.summary.key === "prep.headerRows")).toBe(false);
  });
});

describe("prepareAccessibleSource: document title", () => {
  it("asks for a title the reader will display", () => {
    const { changes } = prepareAccessibleSource(DOC);
    expect(changes.some((c) => c.summary.key === "prep.titleRequired")).toBe(true);
  });

  it("stays quiet when the source already sets both", () => {
    const src = "\\documentclass{article}\\hypersetup{pdftitle={A paper},pdfdisplaydoctitle=true}\\begin{document}x\\end{document}";
    const { changes } = prepareAccessibleSource(src);
    expect(changes.some((c) => c.summary.key === "prep.titleRequired")).toBe(false);
  });
});

describe("prepareAccessibleSource: image alt stubs", () => {
  it("adds an alt placeholder to an image that lacks one", () => {
    const src = DOC.replace("Hello", "\\includegraphics{photo.png}");
    const { output } = prepareAccessibleSource(src);
    expect(output).toMatch(/\\includegraphics\[alt=\{[^}]*\}\]\{photo\.png\}/);
  });
  it("leaves an image that already has alt text alone", () => {
    const src = DOC.replace("Hello", "\\includegraphics[alt={A headshot}]{photo.png}");
    const { output } = prepareAccessibleSource(src);
    expect(output.match(/alt=/g) ?? []).toHaveLength(1);
  });
});

describe("prepareAccessibleSource: incompatible packages", () => {
  it("warns about listings but does not remove it", () => {
    const src = "\\documentclass{article}\\usepackage{listings}\n\\begin{document}x\\end{document}";
    const { output, changes } = prepareAccessibleSource(src);
    expect(output).toMatch(/\\usepackage\{listings\}/);
    expect(
      changes.some(
        (c) =>
          c.summary.key === "prep.incompatiblePackages" &&
          String(c.summary.params?.packages).includes("listings"),
      ),
    ).toBe(true);
  });

  it("names every package the LaTeX Project lists as incompatible", () => {
    const src = "\\documentclass{article}\\usepackage{float,minted}\\usepackage{amsmath}\n\\begin{document}x\\end{document}";
    const warning = prepareAccessibleSource(src).changes.find(
      (c) => c.summary.key === "prep.incompatiblePackages",
    );
    expect(warning?.summary.params?.packages).toBe("float, minted");
  });

  it("blocks enumitem here too, the same way the gate does", () => {
    const src = "\\documentclass{article}\\usepackage{enumitem}\n\\begin{document}x\\end{document}";
    const warning = prepareAccessibleSource(src).changes.find(
      (c) => c.summary.key === "prep.incompatiblePackages",
    );
    expect(warning?.summary.params?.packages).toBe("enumitem");
  });

  it("cautions about packages that only partly tag", () => {
    const src = "\\documentclass{article}\\usepackage{amsmath}\n\\begin{document}x\\end{document}";
    const caution = prepareAccessibleSource(src).changes.find(
      (c) => c.summary.key === "prep.cautionPackages",
    );
    expect(caution?.summary.params?.packages).toBe("amsmath");
  });

  it("ignores a package that is only mentioned in a comment", () => {
    const src = "\\documentclass{article}\n% \\usepackage{float}\n\\begin{document}x\\end{document}";
    const warning = prepareAccessibleSource(src).changes.find(
      (c) => c.summary.key === "prep.incompatiblePackages",
    );
    expect(warning).toBeUndefined();
  });
});

describe("prepareAccessibleSource: engine guidance", () => {
  it("names both tagging engines when the engine is unknown", () => {
    const { changes } = prepareAccessibleSource(DOC);
    expect(changes.some((c) => c.summary.key === "prep.compileAny")).toBe(true);
    expect(changes.some((c) => c.summary.key === "prep.compileLua")).toBe(false);
  });

  it("keeps the guidance short when LuaLaTeX is already selected", () => {
    const { changes } = prepareAccessibleSource(DOC, { engine: "lualatex" });
    expect(changes.some((c) => c.summary.key === "prep.compileLua")).toBe(true);
    expect(changes.some((c) => c.summary.key === "prep.compileAny")).toBe(false);
  });
});

describe("prepareAccessibleSource: idempotence", () => {
  it("is stable when run twice", () => {
    const once = prepareAccessibleSource(DOC, { engine: "lualatex" }).output;
    const twice = prepareAccessibleSource(once, { engine: "lualatex" }).output;
    expect(twice).toBe(once);
    expect(twice.match(/\\DocumentMetadata/g) ?? []).toHaveLength(1);
    expect(twice.match(/\\usepackage\{unicode-math\}/g) ?? []).toHaveLength(1);
  });
});
