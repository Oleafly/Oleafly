import { describe, expect, it } from "vitest";
import {
  citationInsert,
  citeSiteAt,
  citeSiteAtCaret,
  dominantLatexCommand,
  prefersBareMarkdown,
  type CiteFormat,
} from "./cite-syntax";

function site(text: string, format: CiteFormat) {
  return citeSiteAt(text, text.length, format);
}

function apply(text: string, format: CiteFormat, key: string, options = { latexCommand: "cite", markdownBare: false }) {
  const found = site(text, format);
  if (!found) return null;
  return text.slice(0, found.from) + citationInsert(format, found, key, options) + text.slice(found.to);
}

function atCaret(marked: string, format: CiteFormat, key: string, options = { latexCommand: "cite", markdownBare: false }) {
  const from = marked.indexOf("|");
  const to = marked.lastIndexOf("|") - (marked.indexOf("|") === marked.lastIndexOf("|") ? 0 : 1);
  const text = marked.replaceAll("|", "");
  const found = citeSiteAtCaret(text, from, to, format);
  return text.slice(0, found.from) + citationInsert(format, found, key, options) + text.slice(found.to);
}

describe("LaTeX citation sites", () => {
  it("turns @query in prose into the document's cite command", () => {
    expect(site("See @smi", "latex")).toMatchObject({ kind: "prose", query: "smi", from: 4 });
    expect(apply("See @smi", "latex", "smithBBT2020")).toBe("See \\cite{smithBBT2020}");
    expect(apply("(@smi", "latex", "k", { latexCommand: "parencite", markdownBare: false })).toBe("(\\parencite{k}");
    expect(apply("~@", "latex", "k")).toBe("~\\cite{k}");
  });

  it("keeps searching across a few words so author and title can be combined", () => {
    expect(site("See @garcia mon", "latex")).toMatchObject({ query: "garcia mon", from: 4 });
    expect(site("See @garcia ", "latex")).toMatchObject({ query: "garcia " });
    expect(apply("See @garcia monte carlo", "latex", "garcia2026")).toBe("See \\cite{garcia2026}");
    expect(site("See @ garcia", "latex")).toBeNull();
    expect(site("See @a b c d e f g h", "latex")).toBeNull();
    expect(apply("As @smith deep", "typst", "smith2020")).toBe("As @smith2020");
    expect(apply("[see @smith deep", "markdown", "smith2020")).toBe("[see @smith2020");
  });

  it("ignores emails, escaped at signs and comments", () => {
    expect(site("write to foo@bar", "latex")).toBeNull();
    expect(site("\\@smi", "latex")).toBeNull();
    expect(site("text % see @smi", "latex")).toBeNull();
    expect(site("50\\% of @smi", "latex")).toMatchObject({ query: "smi" });
  });

  it("completes keys inside every cite command form", () => {
    for (const command of ["cite", "citep", "citet", "parencite", "textcite", "autocite", "footcite", "Textcite", "citep*", "parencite*"]) {
      expect(site(`\\${command}{smi`, "latex")).toMatchObject({ kind: "argument", query: "smi" });
    }
    expect(apply("\\citep[see][p.~4]{a, smi", "latex", "smith")).toBe("\\citep[see][p.~4]{a, smith");
    expect(apply("\\cite{a,smi", "latex", "smith")).toBe("\\cite{a,smith");
    expect(site("\\ref{fig", "latex")).toBeNull();
    expect(site("\\cite{a}", "latex")).toBeNull();
  });

  it("appends a key when @ is typed inside existing braces", () => {
    expect(apply("\\cite{a,@jo", "latex", "jones")).toBe("\\cite{a,jones");
    expect(apply("\\cite{@jo", "latex", "jones")).toBe("\\cite{jones");
    expect(apply("\\parencite{a @jo", "latex", "jones")).toBe("\\parencite{a, jones");
    expect(apply("\\cite{a,b @jo", "latex", "jones")).toBe("\\cite{a,b,jones");
    expect(apply("\\citep{a, @smith expl", "latex", "smith2018")).toBe("\\citep{a, smith2018");
  });
});

describe("Typst citation sites", () => {
  it("inserts @key, or a label call for keys Typst cannot parse", () => {
    expect(apply("As in @smi", "typst", "smith2020")).toBe("As in @smith2020");
    expect(apply("As in @smi", "typst", "smith/2020")).toBe('As in #cite(label("smith/2020"))');
    expect(site("user@mail", "typst")).toBeNull();
  });

  it("completes inside #cite", () => {
    expect(apply("#cite(<smi", "typst", "smith2020")).toBe("#cite(<smith2020");
    expect(apply('#cite(label("smi', "typst", "smith2020")).toBe('#cite(label("smith2020');
  });
});

describe("Markdown citation sites", () => {
  it("wraps prose citations in brackets unless the document writes them bare", () => {
    expect(apply("As @smi", "markdown", "smith2020")).toBe("As [@smith2020]");
    expect(apply("As @smi", "markdown", "smith2020", { latexCommand: "cite", markdownBare: true })).toBe("As @smith2020");
  });

  it("keeps bracketed lists and locators", () => {
    expect(apply("[see @smi", "markdown", "smith2020")).toBe("[see @smith2020");
    expect(apply("[@a; @smi", "markdown", "smith2020")).toBe("[@a; @smith2020");
    expect(apply("[@a, p. 4; @smi", "markdown", "smith2020")).toBe("[@a, p. 4; @smith2020");
    expect(site("[@a](link) and @smi", "markdown")).toMatchObject({ bracketed: false });
  });

  it("braces keys Pandoc would cut short", () => {
    expect(apply("[@smi", "markdown", "smith:2020.")).toBe("[@{smith:2020.}");
    expect(apply("[@smi", "markdown", "smith:2020")).toBe("[@smith:2020");
    expect(site("foo@bar.com", "markdown")).toBeNull();
  });
});

describe("citation sites at the caret", () => {
  it("adds a key to the LaTeX cite list the caret is in", () => {
    expect(atCaret("\\cite{efron1979bootstrap,benjamini1995controlling|}", "latex", "cox1972regression")).toBe(
      "\\cite{efron1979bootstrap,benjamini1995controlling,cox1972regression}",
    );
    expect(atCaret("\\cite{a, b|} more", "latex", "k")).toBe("\\cite{a, b, k} more");
    expect(atCaret("\\cite{a|}", "latex", "k")).toBe("\\cite{a, k}");
    expect(atCaret("\\cite{a|,b}", "latex", "k")).toBe("\\cite{a,k,b}");
    expect(atCaret("\\cite{ab|cd}", "latex", "k")).toBe("\\cite{abcd, k}");
    expect(atCaret("\\cite{|}", "latex", "k")).toBe("\\cite{k}");
    expect(atCaret("\\cite{a,|}", "latex", "k")).toBe("\\cite{a,k}");
    expect(atCaret("\\citep[see][p.~4]{a|}", "latex", "k")).toBe("\\citep[see][p.~4]{a, k}");
  });

  it("writes a whole LaTeX citation in prose", () => {
    expect(atCaret("See |.", "latex", "k", { latexCommand: "parencite", markdownBare: false })).toBe("See \\parencite{k}.");
    expect(atCaret("\\cite{a}| and", "latex", "k")).toBe("\\cite{a}\\cite{k} and");
    expect(atCaret("See @|", "latex", "k")).toBe("See \\cite{k}");
    expect(atCaret("See |old| text", "latex", "k")).toBe("See \\cite{k} text");
  });

  it("adds a Typst reference next to the one the caret is on", () => {
    expect(atCaret("As @efron @benjamini|.", "typst", "cox")).toBe("As @efron @benjamini @cox.");
    expect(atCaret("As @benj|amini said", "typst", "cox")).toBe("As @benjamini @cox said");
    expect(atCaret("As @a| now", "typst", "smith/2020")).toBe('As @a #cite(label("smith/2020")) now');
    expect(atCaret("As |", "typst", "cox")).toBe("As @cox");
    expect(atCaret("As @|", "typst", "cox")).toBe("As @cox");
    expect(atCaret("#cite(<|>)", "typst", "cox")).toBe("#cite(<cox>)");
    expect(atCaret("#cite(<a|>) next", "typst", "cox")).toBe("#cite(<a>) @cox next");
  });

  it("adds a Markdown citation to the group the caret is in", () => {
    expect(atCaret("As [@a; @b|] shows", "markdown", "k")).toBe("As [@a; @b; @k] shows");
    expect(atCaret("As [@a; |]", "markdown", "k")).toBe("As [@a; @k]");
    expect(atCaret("As [see @a, p. 4|]", "markdown", "k")).toBe("As [see @a, p. 4; @k]");
    expect(atCaret("As [@|", "markdown", "k")).toBe("As [@k");
    expect(atCaret("As @a| says", "markdown", "k")).toBe("As @a [@k] says");
    expect(atCaret("As @a| says", "markdown", "k", { latexCommand: "cite", markdownBare: true })).toBe("As @a @k says");
    expect(atCaret("As |", "markdown", "k")).toBe("As [@k]");
    expect(atCaret("[a link|](url)", "markdown", "k")).toBe("[a link[@k]](url)");
  });
});

describe("dominant citation style", () => {
  it("picks the most used LaTeX cite command", () => {
    expect(dominantLatexCommand(["\\parencite{a} \\parencite*{b} \\textcite{c} \\cite{d}"])).toBe("parencite");
    expect(dominantLatexCommand(["\\citeauthor{a} \\citeauthor{b} \\nocite{*} \\citep{c}"])).toBe("citep");
    expect(dominantLatexCommand(["% \\autocite{a} \\autocite{b}\n\\cite{c}"])).toBe("cite");
    expect(dominantLatexCommand([])).toBe("cite");
  });

  it("detects bare Markdown citations", () => {
    expect(prefersBareMarkdown("As @a says, and @b agrees [@c].")).toBe(true);
    expect(prefersBareMarkdown("Shown before [@a; @b] and [@c].")).toBe(false);
    expect(prefersBareMarkdown("No citations, mail me at x@y.z")).toBe(false);
  });
});
