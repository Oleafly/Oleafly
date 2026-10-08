import { describe, expect, it } from "vitest";
import {
  appendEntries,
  bibEntrySpans,
  bibKeyIndex,
  bibStyleOf,
  entryHash,
  ensureLatexBibliography,
  findEntry,
  latexUsesBiblatex,
  replaceEntry,
  withEntryKey,
} from "./bib-text";

const BIB = [
  "% my notes, keep me",
  "@string{jot = {Journal of Things}}",
  "",
  "@article{smith2020,",
  "  title = {Deep {Learning} for \"Things\"},",
  "  author = {Smith, Ann},",
  "  doi = {10.1000/ABC},",
  "  note = {nested {braces} and \"quotes\"},",
  "}",
  "",
  "@comment{ignored}",
  "@Book{ doe_2019 ,",
  "  title = \"Quoted {title}\",",
  "  DOI = \"https://doi.org/10.2000/xyz\",",
  "}",
  "",
].join("\n");

describe("bib entry scanning", () => {
  it("finds entries with nested braces, quotes, comments and odd spacing", () => {
    const spans = bibEntrySpans(BIB);
    expect(spans.map((span) => span.key)).toEqual(["smith2020", "doe_2019"]);
    const smith = findEntry(BIB, "smith2020");
    expect(smith && BIB.slice(smith.from, smith.to)).toMatch(/^@article\{smith2020,[\s\S]*\n\}$/);
    const doe = findEntry(BIB, "doe_2019");
    expect(doe && BIB.slice(doe.from, doe.to).endsWith("}")).toBe(true);
    expect(findEntry(BIB, "missing")).toBeNull();
  });

  it("indexes keys and normalised DOIs", () => {
    const index = bibKeyIndex(BIB);
    expect(index.keys.has("smith2020")).toBe(true);
    expect(index.keys.has("doe_2019")).toBe(true);
    expect(index.doiToKey.get("10.1000/abc")).toBe("smith2020");
    expect(index.doiToKey.get("10.2000/xyz")).toBe("doe_2019");
    expect(bibKeyIndex(BIB)).toBe(index);
  });

  it("tolerates unterminated entries without hanging", () => {
    const broken = "@article{a,\n title = {open\n\n@book{b, title={x}}\n";
    expect(bibEntrySpans(broken).map((span) => span.key)).toContain("b");
  });
});

describe("minimal edits", () => {
  it("appends one entry and leaves everything else byte for byte", () => {
    const entry = "@article{new2024,\n  title = {New}\n}";
    const next = appendEntries(BIB, [entry]);
    expect(next.startsWith(BIB)).toBe(true);
    expect(next.slice(BIB.length)).toBe(`\n${entry}\n`);
    expect(appendEntries("", [entry])).toBe(`${entry}\n`);
    expect(appendEntries("@a{x,}", [entry])).toBe(`@a{x,}\n\n${entry}\n`);
    expect(appendEntries("@a{x,}\n", [entry, entry])).toBe(`@a{x,}\n\n${entry}\n\n${entry}\n`);
  });

  it("replaces exactly one entry in place", () => {
    const span = findEntry(BIB, "smith2020");
    if (!span) throw new Error("missing entry");
    const next = replaceEntry(BIB, span, "@article{smith2020,\n  title = {Updated}\n}");
    expect(next.startsWith("% my notes, keep me\n@string{jot = {Journal of Things}}\n\n@article{smith2020,\n  title = {Updated}\n}\n\n@comment{ignored}")).toBe(true);
    expect(next.endsWith(BIB.slice(span.to))).toBe(true);
  });

  it("hashes entries ignoring whitespace layout only", () => {
    expect(entryHash("@a{x,\n  t = {A}\n}")).toBe(entryHash("@a{x,\r\n\tt = {A}\n}"));
    expect(entryHash("@a{x, t = {A}}")).not.toBe(entryHash("@a{x, t = {B}}"));
  });

  it("rekeys an entry", () => {
    expect(withEntryKey("@article{muller_deep_2020,\n\ttitle = {A},\n}", "mullerDeep2020")).toBe(
      "@article{mullerDeep2020,\n\ttitle = {A},\n}",
    );
  });

  it("detects the bibliography flavour of an existing file", () => {
    expect(bibStyleOf("@article{a,\n journaltitle = {J},\n date = {2020}\n}")).toBe("biblatex");
    expect(bibStyleOf("@article{a,\n journal = {J},\n year = {2020}\n}")).toBe("bibtex");
    expect(bibStyleOf("")).toBeNull();
  });
});

describe("LaTeX bibliography declaration", () => {
  const plain = "\\documentclass{article}\n\\begin{document}\nHi \\cite{a}.\n\\end{document}\n";

  it("adds \\bibliographystyle and \\bibliography before \\end{document}", () => {
    expect(ensureLatexBibliography(plain, "refs/library.bib")).toBe(
      "\\documentclass{article}\n\\begin{document}\nHi \\cite{a}.\n\\bibliographystyle{plain}\n\\bibliography{refs/library}\n\\end{document}\n",
    );
  });

  it("uses plainnat with natbib and keeps an existing style", () => {
    const natbib = plain.replace("\\begin{document}", "\\usepackage[round]{natbib}\n\\begin{document}");
    expect(ensureLatexBibliography(natbib, "references.bib")).toContain("\\bibliographystyle{plainnat}\n\\bibliography{references}\n\\end{document}");
    const styled = plain.replace("\\end{document}", "\\bibliographystyle{apalike}\n\\end{document}");
    const next = ensureLatexBibliography(styled, "references.bib");
    expect(next.match(/\\bibliographystyle/g)).toHaveLength(1);
    expect(next).toContain("\\bibliography{references}\n\\end{document}");
  });

  it("adds \\addbibresource after biblatex and \\printbibliography once", () => {
    const biblatex = "\\documentclass{article}\n\\usepackage[style=apa]{biblatex}\n\\begin{document}\nx\n\\end{document}";
    expect(latexUsesBiblatex(biblatex)).toBe(true);
    expect(latexUsesBiblatex(plain)).toBe(false);
    expect(latexUsesBiblatex("% \\usepackage{biblatex}\n")).toBe(false);
    expect(ensureLatexBibliography(biblatex, "references.bib")).toBe(
      "\\documentclass{article}\n\\usepackage[style=apa]{biblatex}\n\\addbibresource{references.bib}\n\\begin{document}\nx\n\\printbibliography\n\\end{document}",
    );
  });

  it("does nothing when a declaration already exists, even in another form", () => {
    const declared = plain.replace("\\end{document}", "\\bibliography{other}\n\\end{document}");
    expect(ensureLatexBibliography(declared, "references.bib")).toBe(declared);
    const commented = plain.replace("\\end{document}", "% \\bibliography{other}\n\\end{document}");
    expect(ensureLatexBibliography(commented, "references.bib")).toContain("\\bibliography{references}\n\\end{document}");
  });

  it("appends at the end when there is no document environment", () => {
    expect(ensureLatexBibliography("Chapter text\n", "references.bib")).toBe(
      "Chapter text\n\\bibliographystyle{plain}\n\\bibliography{references}\n",
    );
  });
});
