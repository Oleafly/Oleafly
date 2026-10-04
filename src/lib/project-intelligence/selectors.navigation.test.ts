import { describe, expect, it } from "vitest";
import { analyzeProjectFile } from "./analyze-file";
import { assembleProjectIntelligence } from "./assemble";
import {
  citationCompletions,
  definitionAt,
  definitionsForUse,
  projectChildren,
  referencesFor,
  safeLinePreview,
  symbolAt,
} from "./selectors";

const MAIN = [
  String.raw`\documentclass{article}`,
  String.raw`\begin{document}`,
  String.raw`\section{Intro}\label{sec:intro}`,
  String.raw`See \ref{sec:intro} and \ref{sec:intro}.`,
  String.raw`\input{chapters/methods}`,
  String.raw`\input{missing/part}`,
  String.raw`\cite{knuth84}`,
  String.raw`\bibliography{refs}`,
  String.raw`\end{document}`,
].join("\n");
const METHODS = String.raw`\section{Methods}\label{sec:methods}`;
const REFS = [
  "@book{knuth84, author={Knuth, Donald}, title={The TeXbook}, year={1984}}",
  "@article{lamport94, author={Lamport, Leslie}, title={LaTeX}, year={1994}}",
  "@misc{knuth84b, title={Untitled notes}}",
].join("\n");

const texts = { "main.tex": MAIN, "chapters/methods.tex": METHODS, "refs.bib": REFS };

const snapshot = assembleProjectIntelligence({
  identity: { projectId: "p", projectRevision: 1, requestGeneration: 1 },
  files: Object.fromEntries(
    Object.entries(texts).map(([file, text]) => [file, analyzeProjectFile(file, text, 1)]),
  ),
  knownFiles: Object.keys(texts),
  mainDocument: "main.tex",
  stats: { fileCount: 3, characterCount: 0, parsedFileCount: 3, reusedFileCount: 0, durationMs: 0 },
});

const offsetOf = (needle: string, nth = 0) => {
  let index = -1;
  for (let i = 0; i <= nth; i += 1) index = MAIN.indexOf(needle, index + 1);
  return index;
};

describe("symbol lookup", () => {
  it("prefers the reference under the cursor and maps it to its definition", () => {
    const symbol = symbolAt(snapshot, "main.tex", offsetOf("sec:intro", 1) + 2);
    expect(symbol).toMatchObject({ kind: "reference", name: "sec:intro" });
    const definitions = definitionsForUse(snapshot, symbol?.id ?? "");
    expect(definitions.map((definition) => [definition.kind, definition.name])).toEqual([
      ["label", "sec:intro"],
    ]);
  });

  it("falls back to the narrowest definition when no reference is under the cursor", () => {
    const symbol = symbolAt(snapshot, "main.tex", offsetOf("sec:intro") + 1);
    expect(symbol).toMatchObject({ kind: "label", name: "sec:intro" });
    expect(definitionAt(snapshot, "main.tex", offsetOf("sec:intro") + 1)).toEqual(symbol);
  });

  it("finds nothing outside any symbol or in another file", () => {
    expect(symbolAt(snapshot, "main.tex", offsetOf("See"))).toBeNull();
    expect(definitionAt(snapshot, "main.tex", offsetOf("See"))).toBeNull();
    expect(symbolAt(snapshot, "other.tex", offsetOf("sec:intro") + 1)).toBeNull();
  });

  it("lists every reference to a definition", () => {
    const label = definitionAt(snapshot, "main.tex", offsetOf("sec:intro") + 1);
    const references = referencesFor(snapshot, label?.id ?? "");
    expect(references).toHaveLength(2);
    expect(references.every((use) => use.name === "sec:intro")).toBe(true);
    expect(referencesFor(snapshot, "unknown")).toEqual([]);
  });

  it("returns no definitions for an unknown use", () => {
    expect(definitionsForUse(snapshot, "nope")).toEqual([]);
  });

  it("treats an empty range as matching only its own offset", () => {
    const empty = {
      ...snapshot,
      uses: [],
      definitions: [
        {
          id: "point",
          source: "local" as const,
          engine: "latex" as const,
          kind: "label" as const,
          name: "point",
          location: {
            file: "main.tex",
            range: { from: 5, to: 5, startLine: 1, startColumn: 5, endLine: 1, endColumn: 5 },
          },
        },
      ],
    };
    expect(definitionAt(empty, "main.tex", 5)?.id).toBe("point");
    expect(definitionAt(empty, "main.tex", 6)).toBeNull();
  });

  it("breaks ties between equally narrow definitions by id", () => {
    const range = { from: 0, to: 3, startLine: 1, startColumn: 0, endLine: 1, endColumn: 3 };
    const base = { source: "local" as const, engine: "latex" as const, kind: "label" as const, name: "x" };
    const tied = {
      ...snapshot,
      uses: [],
      definitions: [
        { ...base, id: "b", location: { file: "main.tex", range } },
        { ...base, id: "a", location: { file: "main.tex", range } },
      ],
    };
    expect(definitionAt(tied, "main.tex", 1)?.id).toBe("a");
  });
});

describe("projectChildren", () => {
  it("lists the included files of a document, with unresolved targets kept as edges", () => {
    const children = projectChildren(snapshot, "main.tex");
    expect(children.edges.map((edge) => edge.rawTarget)).toEqual(["chapters/methods", "missing/part"]);
    expect(children.nodes.map((node) => node.file)).toEqual(["chapters/methods.tex"]);
  });

  it("uses candidate files when an include has no single target", () => {
    const edge = projectChildren(snapshot, "main.tex").edges[1];
    const ambiguous = {
      ...snapshot,
      hierarchy: {
        ...snapshot.hierarchy,
        edges: [{ ...edge, targetFile: null, candidateFiles: ["chapters/methods.tex"] }],
      },
    };
    expect(projectChildren(ambiguous, "main.tex").nodes.map((node) => node.file)).toEqual([
      "chapters/methods.tex",
    ]);
  });

  it("has no children for a leaf file", () => {
    expect(projectChildren(snapshot, "chapters/methods.tex")).toEqual({ nodes: [], edges: [] });
  });
});

describe("citationCompletions ranking", () => {
  it("ranks exact, prefix, infix and author/title matches in that order", () => {
    expect(citationCompletions(snapshot, "knuth84").map((completion) => completion.key)).toEqual([
      "knuth84",
      "knuth84b",
    ]);
    expect(citationCompletions(snapshot, "@lam").map((completion) => completion.key)).toEqual(["lamport94"]);
    expect(citationCompletions(snapshot, "port").map((completion) => completion.key)).toEqual(["lamport94"]);
    expect(citationCompletions(snapshot, "texbook").map((completion) => completion.key)).toEqual(["knuth84"]);
  });

  it("omits missing optional fields and clamps the limit", () => {
    const [notes] = citationCompletions(snapshot, "knuth84b");
    expect(notes).not.toHaveProperty("author");
    expect(notes).not.toHaveProperty("year");
    expect(notes.title).toBe("Untitled notes");
    expect(citationCompletions(snapshot, "", 1)).toHaveLength(1);
    expect(citationCompletions(snapshot, "", -5)).toEqual([]);
    expect(citationCompletions(snapshot, "", 1.5)).toHaveLength(3);
  });
});

describe("safeLinePreview", () => {
  const location = (line: number) => ({
    file: "main.tex",
    range: { from: 0, to: 0, startLine: line, startColumn: 0, endLine: line, endColumn: 0 },
  });

  it("returns the trimmed source line", () => {
    expect(safeLinePreview({ "main.tex": "a\n   middle line  \nc" }, location(2))).toBe("middle line");
  });

  it("returns an empty preview for unknown files and lines", () => {
    expect(safeLinePreview({}, location(1))).toBe("");
    expect(safeLinePreview({ "main.tex": "one" }, location(9))).toBe("");
  });

  it("truncates long lines with an ellipsis and clamps the length", () => {
    const long = `${"word ".repeat(100)}`;
    expect(safeLinePreview({ "main.tex": long }, location(1), 20)).toBe("word word word word…");
    expect(safeLinePreview({ "main.tex": long }, location(1), 2)).toBe("word word word…");
    expect(safeLinePreview({ "main.tex": long }, location(1), 1.5)).toHaveLength(240);
    expect(safeLinePreview({ "main.tex": "x".repeat(3000) }, location(1), 5000)).toHaveLength(2000);
  });
});
