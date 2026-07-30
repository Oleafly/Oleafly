import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  latexCommandCompletions,
  lintLatexText,
  maskToProse,
  scanMathExpressions,
  spellcheckRanges,
} from "@oleafly/editor";
import { analyzeProjectFile } from "./project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "./project-intelligence/assemble";
import { citationCompletions } from "./project-intelligence/selectors";
import { buildLargeLatexBook } from "../../test/fixtures/editor-support/large-book";

describe("book-scale editor feature integration", () => {
  it("keeps structure, references, citations, syntax, math, and proofing exact across 6,200 lines", () => {
    const book = buildLargeLatexBook();
    const file = analyzeProjectFile("main.tex", book.source, 7);
    const snapshot = assembleProjectIntelligence({
      identity: {
        projectId: "large-book",
        projectRevision: 7,
        requestGeneration: 7,
      },
      files: { "main.tex": file },
      knownFiles: ["main.tex"],
      mainDocument: "main.tex",
      stats: {
        fileCount: 1,
        characterCount: book.characterCount,
        parsedFileCount: 1,
        reusedFileCount: 0,
        durationMs: 0,
      },
    });

    expect(book.lineCount).toBe(6_200);
    expect(book.characterCount).toBeGreaterThan(450_000);
    expect(book.characterCount).toBeLessThanOrEqual(500_000);
    expect(book.distinctNonEmptyLineRatio).toBeGreaterThanOrEqual(0.98);
    expect(book.chapterCount).toBeGreaterThanOrEqual(16);
    expect(book.sectionCount).toBeGreaterThanOrEqual(70);
    expect(book.formulaKinds).toHaveLength(10);
    expect(book.source).toContain("\\begin{theorem}");
    expect(book.source).toContain("\\begin{table}");
    expect(book.source).toContain("\\begin{enumerate}");
    expect(book.source).toContain("\\begin{quote}");
    expect(file.status).toBe("success");
    expect(snapshot.status).toBe("success");
    expect(snapshot.outlines["main.tex"].length).toBeGreaterThanOrEqual(
      book.sectionCount,
    );
    expect(
      snapshot.uses.filter((use) => use.kind === "reference"),
    ).not.toContainEqual(
      expect.objectContaining({ resolution: "unresolved" }),
    );
    expect(
      snapshot.uses.filter((use) => use.kind === "citation"),
    ).not.toContainEqual(
      expect.objectContaining({ resolution: "unresolved" }),
    );
    expect(
      snapshot.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "unresolved-reference" ||
          diagnostic.code === "unresolved-citation",
      ),
    ).toEqual([]);
    expect(citationCompletions(snapshot, "foundations")).toHaveLength(1);
    expect(lintLatexText(book.source)).toEqual([]);
    expect(book.displayMathCount).toBeGreaterThanOrEqual(100);
    expect(
      scanMathExpressions(book.source, { format: "latex" }),
    ).toHaveLength(book.mathCount);

    const typo = "qwertzuiopz";
    const typoOffset = book.source.indexOf(typo);
    expect(typoOffset).toBeGreaterThan(0);
    expect(spellcheckRanges(book.source)).toContainEqual(
      expect.objectContaining({
        from: typoOffset,
        to: typoOffset + typo.length,
        word: typo,
      }),
    );
    const prose = maskToProse(book.source);
    expect(prose.prose).toContain(typo);
    expect(prose.prose).not.toContain("\\newcommand");
    expect(prose.map[prose.prose.indexOf(typo)]).toBe(typoOffset);
  });

  it("returns static LaTeX completion at the end of the large book without scanning away the command site", () => {
    const book = buildLargeLatexBook();
    const source = `${book.source.slice(0, book.source.lastIndexOf("\\end{document}"))}\n\\tex`;
    const state = EditorState.create({ doc: source });
    const result = latexCommandCompletions(
      new CompletionContext(state, state.doc.length, false),
    );

    expect(result?.from).toBe(state.doc.length - 4);
    expect(result?.options.map((option) => option.label)).toEqual(
      expect.arrayContaining([
        "\\textbf",
        "\\textit",
        "\\texttt",
        "\\textcolor",
      ]),
    );
  });
});
