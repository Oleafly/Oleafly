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
import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import { citationCompletions } from "@/lib/project-intelligence/selectors";
import {
  buildLargeLatexBook,
  buildReferenceProject,
  LARGE_BOOK_LINE_COUNT,
} from "../fixtures/editor-support/large-book";

const WARMUP_RUNS = 3;
const MEASURED_RUNS = 20;

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function measure(operation: () => void): number {
  const start = performance.now();
  operation();
  return performance.now() - start;
}

function measureP95(operation: () => void): number {
  for (let run = 0; run < WARMUP_RUNS; run++) operation();
  return p95(
    Array.from({ length: MEASURED_RUNS }, () => measure(operation)),
  );
}

function nearContractProject() {
  const sources = {
    ...buildReferenceProject(199),
    "references.bib": `@book{book-source,
  author = {Ada Author},
  title = {A Stable Source},
  year = {2026}
}`,
  };
  const characterCount = Object.values(sources).reduce(
    (total, source) => total + source.length,
    0,
  );
  return { sources, characterCount };
}

describe("large-document editor performance", () => {
  it("keeps a book-sized single source inside every synchronous editor budget", () => {
    const book = buildLargeLatexBook();
    expect(book.lineCount).toBe(LARGE_BOOK_LINE_COUNT);
    expect(book.characterCount).toBeGreaterThan(450_000);
    expect(book.characterCount).toBeLessThanOrEqual(500_000);
    expect(book.distinctNonEmptyLineRatio).toBeGreaterThanOrEqual(0.98);
    expect(book.formulaKinds).toHaveLength(10);

    let analysis:
      | ReturnType<typeof analyzeProjectFile>
      | undefined;
    const analysisP95 = measureP95(() => {
      analysis = analyzeProjectFile("main.tex", book.source, 1);
    });
    expect(analysis?.status).toBe("success");
    expect(analysis?.outline.length).toBeGreaterThanOrEqual(
      book.sectionCount,
    );
    expect(analysisP95).toBeLessThanOrEqual(750);

    let syntaxDiagnostics = lintLatexText(book.source);
    const syntaxP95 = measureP95(() => {
      syntaxDiagnostics = lintLatexText(book.source);
    });
    expect(syntaxDiagnostics).toEqual([]);
    expect(syntaxP95).toBeLessThanOrEqual(50);

    let proseMapLength = 0;
    let proofingWordCount = 0;
    const proofingExtractionP95 = measureP95(() => {
      const prose = maskToProse(book.source);
      proseMapLength = prose.map.length;
      proofingWordCount = spellcheckRanges(book.source).length;
    });
    expect(proseMapLength).toBeGreaterThan(250_000);
    expect(proofingWordCount).toBeGreaterThan(20_000);
    expect(proofingExtractionP95).toBeLessThanOrEqual(2_000);

    let mathCount = 0;
    const inlineMathP95 = measureP95(() => {
      mathCount = scanMathExpressions(book.source, {
        format: "latex",
      }).length;
    });
    expect(book.displayMathCount).toBeGreaterThanOrEqual(100);
    expect(mathCount).toBe(book.mathCount);
    expect(inlineMathP95).toBeLessThanOrEqual(500);
    console.info("[editor-performance] realistic 6,200-line source p95", {
      analysisMs: analysisP95,
      syntaxMs: syntaxP95,
      proofingExtractionMs: proofingExtractionP95,
      inlineMathMs: inlineMathP95,
    });
  });

  it("keeps a 200-file, near-500k project within the project-analysis gate", () => {
    const { sources, characterCount } = nearContractProject();
    const paths = Object.keys(sources);
    expect(paths).toHaveLength(200);
    expect(characterCount).toBeGreaterThan(400_000);
    expect(characterCount).toBeLessThanOrEqual(500_000);

    let snapshot:
      | ReturnType<typeof assembleProjectIntelligence>
      | undefined;
    const projectP95 = measureP95(() => {
      const files = Object.fromEntries(
        Object.entries(sources).map(([path, source]) => [
          path,
          analyzeProjectFile(path, source, 1),
        ]),
      );
      snapshot = assembleProjectIntelligence({
        identity: {
          projectId: "large-book",
          projectRevision: 1,
          requestGeneration: 1,
        },
        files,
        knownFiles: paths,
        mainDocument: paths[0],
        stats: {
          fileCount: paths.length,
          characterCount,
          parsedFileCount: paths.length,
          reusedFileCount: 0,
          durationMs: 0,
        },
      });
    });

    expect(snapshot?.status).toBe("success");
    expect(snapshot?.definitions.length).toBeGreaterThanOrEqual(201);
    expect(
      snapshot?.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "unresolved-reference" ||
          diagnostic.code === "unresolved-citation",
      ),
    ).toEqual([]);
    expect(projectP95).toBeLessThanOrEqual(750);

    let completionCount = 0;
    const completionP95 = measureP95(() => {
      completionCount = citationCompletions(snapshot!, "book").length;
    });
    expect(completionCount).toBe(1);
    expect(completionP95).toBeLessThanOrEqual(250);
    console.info("[editor-performance] 200-file project p95", {
      analysisMs: projectP95,
      citationCompletionMs: completionP95,
    });
  });

  it("keeps completion responsive at the end of a 6,200-line document", () => {
    const book = buildLargeLatexBook();
    const source = `${book.source.slice(0, book.source.lastIndexOf("\\end{document}"))}\n\\tex`;
    const state = EditorState.create({ doc: source });
    let labels: string[] = [];

    const completionP95 = measureP95(() => {
      const result = latexCommandCompletions(
        new CompletionContext(state, state.doc.length, false),
      );
      labels = result?.options.map((option) => option.label) ?? [];
    });

    expect(labels).toContain("\\textbf");
    expect(labels).toContain("\\textit");
    expect(completionP95).toBeLessThanOrEqual(100);
    console.info("[editor-performance] end-of-book completion p95", {
      completionMs: completionP95,
    });
  });
});
