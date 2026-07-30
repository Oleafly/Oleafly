import { readFileSync } from "node:fs";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { languageForPath } from "./languages";

interface HighlightSpan {
  from: number;
  to: number;
  classes: string;
}

const fixture = (name: string): string =>
  readFileSync(
    new URL(
      `../../../test/fixtures/editor-support/project/${name}`,
      import.meta.url,
    ),
    "utf8",
  );

function highlightedState(path: string, text: string): {
  state: EditorState;
  spans: HighlightSpan[];
} {
  const language = languageForPath(path);
  if (!language) throw new Error(`No language for ${path}`);
  const state = EditorState.create({
    doc: text,
    extensions: [language],
  });
  const tree = ensureSyntaxTree(state, state.doc.length, 1_000);
  if (!tree) {
    throw new Error(`Syntax tree did not finish parsing ${path}`);
  }
  const spans: HighlightSpan[] = [];
  highlightTree(
    tree,
    classHighlighter,
    (from, to, classes) => spans.push({ from, to, classes }),
  );
  return { state, spans };
}

function tokenClasses(
  text: string,
  spans: readonly HighlightSpan[],
  token: string,
): string[] {
  return spans
    .filter((span) => text.slice(span.from, span.to).includes(token))
    .map((span) => span.classes);
}

describe("contractual source syntax highlighting", () => {
  it.each(["tex", "ltx", "latex", "sty", "cls"])(
    "assigns LaTeX command, argument, comment, and math classes for .%s",
    (extension) => {
      const text = `${fixture("main.tex")}\n% syntax comment\n$x^2$`;
      const { spans } = highlightedState(`document.${extension}`, text);
      expect(tokenClasses(text, spans, "\\documentclass")).toContain(
        "tok-typeName",
      );
      expect(tokenClasses(text, spans, "document")).toContain("tok-atom");
      expect(tokenClasses(text, spans, "% syntax comment")).toContain(
        "tok-comment",
      );
      expect(
        tokenClasses(text, spans, "x").some((classes) =>
          classes.includes("tok-variableName"),
        ),
      ).toBe(true);
    },
  );

  it("highlights GFM and Pandoc math in Markdown source", () => {
    const text = `${fixture("notes.md")}\n\n~~revised~~\n\n| A | B |\n|---|---|`;
    const { spans } = highlightedState("NOTES.MARKDOWN", text);
    expect(
      tokenClasses(text, spans, "Markdown notes").some((classes) =>
        classes.includes("tok-heading"),
      ),
    ).toBe(true);
    expect(
      tokenClasses(text, spans, "chapters/analysis.tex").some((classes) =>
        classes.includes("tok-url"),
      ),
    ).toBe(true);
    expect(
      tokenClasses(text, spans, "a^2 + b^2 = c^2").some((classes) =>
        classes.includes("tok-string2"),
      ),
    ).toBe(true);
    expect(
      tokenClasses(text, spans, "\\sum_{i=1}^{n}").some((classes) =>
        classes.includes("tok-string2"),
      ),
    ).toBe(true);
    expect(tokenClasses(text, spans, "~~")).toContain("tok-meta");
    expect(
      tokenClasses(text, spans, " A ").some((classes) =>
        classes.includes("tok-heading"),
      ),
    ).toBe(true);
  });

  it("does not treat escaped Markdown currency as Pandoc math", () => {
    const text = String.raw`Price \$5, equation $x + 1$, then \$10.`;
    const { spans } = highlightedState("notes.md", text);
    expect(
      tokenClasses(text, spans, "x + 1").some((classes) =>
        classes.includes("tok-string2"),
      ),
    ).toBe(true);
    expect(
      tokenClasses(text, spans, "5").some((classes) =>
        classes.includes("tok-string2"),
      ),
    ).toBe(false);
  });

  it("highlights Typst markup, code, labels, references, strings, and math", () => {
    const text = fixture("paper.typ");
    const { spans } = highlightedState("PAPER.TYP", text);
    expect(tokenClasses(text, spans, "#set")).toContain("tok-keyword");
    expect(
      tokenClasses(text, spans, "Typst introduction").some((classes) =>
        classes.includes("tok-heading"),
      ),
    ).toBe(true);
    expect(tokenClasses(text, spans, "<typst-introduction>")).toContain(
      "tok-labelName",
    );
    expect(tokenClasses(text, spans, "@typst-analysis")).toContain(
      "tok-link",
    );
    expect(
      tokenClasses(text, spans, "references.bib").some((classes) =>
        classes.includes("tok-string"),
      ),
    ).toBe(true);
    expect(
      tokenClasses(text, spans, "E = m c^2").some((classes) =>
        classes.includes("tok-string"),
      ),
    ).toBe(true);
  });

  it("keeps nested Typst block comments opaque until the outer close", () => {
    const text =
      "/* outer /* nested */ still outer */ #let visible = 1\n" +
      "/* level one\n/* level two */\nstill level one */ #set text(fill: red)";
    const { spans } = highlightedState("nested.typ", text);
    expect(
      tokenClasses(text, spans, "still outer").some((classes) =>
        classes.includes("tok-comment"),
      ),
    ).toBe(true);
    expect(tokenClasses(text, spans, "#let")).toContain("tok-keyword");
    expect(
      tokenClasses(text, spans, "still level one").some((classes) =>
        classes.includes("tok-comment"),
      ),
    ).toBe(true);
    expect(tokenClasses(text, spans, "#set")).toContain("tok-keyword");
  });

  it("highlights BibTeX entry types, keys, fields, and values", () => {
    const text = fixture("references.bib");
    const { spans } = highlightedState("REFERENCES.BIB", text);
    expect(tokenClasses(text, spans, "@book")).toContain("tok-keyword");
    expect(tokenClasses(text, spans, "knuth1984")).toContain(
      "tok-variableName",
    );
    expect(tokenClasses(text, spans, "author")).toContain(
      "tok-propertyName",
    );
    expect(
      tokenClasses(text, spans, "Donald E. Knuth").some((classes) =>
        classes.includes("tok-string"),
      ),
    ).toBe(true);
  });

  it("classifies BibTeX string, preamble, and comment directives", () => {
    const text = `@string{JACM = "Journal of the ACM"}
@preamble{"Generated bibliography " # JACM}
@comment{ignored = {nested {metadata}}}`;
    const { spans } = highlightedState("directives.bib", text);
    expect(tokenClasses(text, spans, "@string")).toContain(
      "tok-keyword",
    );
    expect(
      tokenClasses(text, spans, "JACM").some((classes) =>
        classes.includes("tok-propertyName"),
      ),
    ).toBe(true);
    expect(tokenClasses(text, spans, "@preamble")).toContain(
      "tok-keyword",
    );
    expect(
      tokenClasses(text, spans, "Generated bibliography").some(
        (classes) => classes.includes("tok-string"),
      ),
    ).toBe(true);
    expect(tokenClasses(text, spans, "@comment")).toContain(
      "tok-comment",
    );
    expect(
      tokenClasses(text, spans, "nested {metadata}").some((classes) =>
        classes.includes("tok-comment"),
      ),
    ).toBe(true);
  });
});

describe("malformed highlighting recovery and revision correctness", () => {
  it("keeps later LaTeX commands highlighted around unclosed constructs", () => {
    const text = fixture("malformed.tex");
    const { spans } = highlightedState("malformed.tex", text);
    expect(tokenClasses(text, spans, "\\section")).toContain("tok-typeName");
    expect(tokenClasses(text, spans, "\\textbf")).toContain("tok-typeName");
    expect(tokenClasses(text, spans, "\\item")).toContain("tok-typeName");
  });

  it("recovers BibTeX highlighting at the next complete entry opener", () => {
    const text = `@article{broken,\n  title = "Unclosed\n@book{recovered,\n  author = {Ada Lovelace}\n}`;
    const { spans } = highlightedState("broken.bib", text);
    expect(tokenClasses(text, spans, "@article")).toContain("tok-keyword");
    expect(tokenClasses(text, spans, "@book")).toContain("tok-keyword");
    expect(tokenClasses(text, spans, "recovered")).toContain(
      "tok-variableName",
    );
    expect(tokenClasses(text, spans, "author")).toContain(
      "tok-propertyName",
    );
  });

  it("reads token classes only from the current incremental revision", () => {
    const initial = highlightedState("main.tex", "\\section{Old}");
    const current = initial.state.update({
      changes: {
        from: 0,
        to: initial.state.doc.length,
        insert: "% replaced\n\\newcommand{\\current}[1]{#1}",
      },
    }).state;
    const text = current.doc.toString();
    const spans: HighlightSpan[] = [];
    highlightTree(
      syntaxTree(current),
      classHighlighter,
      (from, to, classes) => spans.push({ from, to, classes }),
    );
    expect(tokenClasses(text, spans, "\\newcommand")).toContain(
      "tok-typeName",
    );
    expect(tokenClasses(text, spans, "% replaced")).toContain("tok-comment");
    expect(text).not.toContain("\\section");
  });
});
