import { beforeAll, describe, expect, it } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { STICKY_MAX_LINES, scopesAtLine, stickyScopes } from "./sticky-structure";
import { typstStickyScopes } from "./typst-structure";
import { loadTypstParser, typstLanguage } from "./typst";
import { parsedState } from "./visual/test-document";

const doc = (...lines: string[]) => Text.of(lines);

describe("stickyScopes", () => {
  it("pairs an environment with its end line", () => {
    const scopes = stickyScopes(doc("\\begin{figure}", "body", "\\end{figure}"));

    expect(scopes).toEqual([{ line: 1, endLine: 3 }]);
  });

  it("nests environments inside one another", () => {
    const scopes = stickyScopes(
      doc(
        "\\begin{center}",
        "\\begin{minipage}{0.5\\linewidth}",
        "body",
        "\\end{minipage}",
        "\\end{center}",
      ),
    );

    expect(scopes).toEqual([
      { line: 1, endLine: 5 },
      { line: 2, endLine: 4 },
    ]);
  });

  it("closes a section at the next same-or-higher-level heading", () => {
    const scopes = stickyScopes(
      doc("\\section{A}", "body", "\\subsection{A1}", "body", "\\section{B}", "body"),
    );

    expect(scopes).toEqual([
      { line: 1, endLine: 4 },
      { line: 3, endLine: 4 },
      { line: 5, endLine: 6 },
    ]);
  });

  it("does not let a section boundary close an open environment", () => {
    const scopes = stickyScopes(
      doc("\\begin{figure}", "\\section{A}", "body", "\\end{figure}", "tail"),
    );

    expect(scopes).toContainEqual({ line: 1, endLine: 4 });
  });

  it("skips the document environment", () => {
    const scopes = stickyScopes(
      doc("\\begin{document}", "\\section{A}", "body", "\\end{document}"),
    );

    expect(scopes).toEqual([{ line: 2, endLine: 4 }]);
  });

  it("drops a scope that opens and closes on one line", () => {
    expect(stickyScopes(doc("\\begin{center}x\\end{center}"))).toEqual([]);
  });

  it("ignores commented-out structure", () => {
    expect(stickyScopes(doc("% \\begin{figure}", "body", "more"))).toEqual([]);
  });

  it("does not treat an escaped percent as a comment", () => {
    const scopes = stickyScopes(doc("\\section{Up 40\\% here}", "body"));

    expect(scopes).toEqual([{ line: 1, endLine: 2 }]);
  });

  it("closes scopes left open at the end of the document", () => {
    const scopes = stickyScopes(doc("\\begin{figure}", "body", "more"));

    expect(scopes).toEqual([{ line: 1, endLine: 3 }]);
  });

  it("turns itself off past the line budget", () => {
    const huge = Text.of(new Array(STICKY_MAX_LINES + 2).fill("\\section{A}"));

    expect(stickyScopes(huge)).toEqual([]);
  });
});

describe("scopesAtLine", () => {
  const scopes = [
    { line: 1, endLine: 100 },
    { line: 10, endLine: 60 },
    { line: 20, endLine: 30 },
    { line: 70, endLine: 90 },
  ];

  it("returns the containing scopes outermost first", () => {
    expect(scopesAtLine(scopes, 25, 6)).toEqual([
      { line: 1, endLine: 100 },
      { line: 10, endLine: 60 },
      { line: 20, endLine: 30 },
    ]);
  });

  it("drops a scope once the reader has scrolled past its end", () => {
    expect(scopesAtLine(scopes, 65, 6)).toEqual([{ line: 1, endLine: 100 }]);
  });

  it("does not pin a scope whose own line is on screen", () => {
    expect(scopesAtLine(scopes, 20, 6)).toEqual([
      { line: 1, endLine: 100 },
      { line: 10, endLine: 60 },
    ]);
  });

  it("keeps the outermost scopes when the nesting exceeds the cap", () => {
    expect(scopesAtLine(scopes, 25, 2)).toEqual([
      { line: 1, endLine: 100 },
      { line: 10, endLine: 60 },
    ]);
  });

  it("returns nothing at the top of the document", () => {
    expect(scopesAtLine(scopes, 1, 6)).toEqual([]);
  });
});

describe("typstStickyScopes", () => {
  beforeAll(async () => {
    await loadTypstParser();
  });

  const scopes = (...lines: string[]) =>
    typstStickyScopes(
      parsedState(EditorState.create({ doc: lines.join("\n"), extensions: [typstLanguage()] })),
    );

  it("closes a heading at the next same-or-higher-level heading", () => {
    expect(scopes("= A", "body", "== A1", "body", "= B", "body")).toEqual([
      { line: 1, endLine: 4 },
      { line: 3, endLine: 4 },
      { line: 5, endLine: 6 },
    ]);
  });

  it("pins a multi-line embedded call through its closing line", () => {
    expect(scopes("#figure(", '  image("a.png"),', ")", "after")).toEqual([{ line: 1, endLine: 3 }]);
  });

  it("closes headings inside a content block before the block's closing line", () => {
    expect(scopes("#block[", "= Inner", "text", "]", "= Outer", "x")).toEqual([
      { line: 1, endLine: 4 },
      { line: 2, endLine: 3 },
      { line: 5, endLine: 6 },
    ]);
  });

  it("ignores heading markers in raw blocks and comments", () => {
    expect(scopes("```", "= not a heading", "```", "/* = not either */", "x")).toEqual([]);
  });

  it("drops calls that fit on one line and calls that do not start a line", () => {
    expect(scopes("#f(a)", "text #g(", "  b", ")")).toEqual([]);
  });

  it("turns itself off past the line budget", () => {
    const huge = new Array(STICKY_MAX_LINES + 2).fill("= A").join("\n");
    expect(typstStickyScopes(EditorState.create({ doc: huge }))).toEqual([]);
  });
});
