import { foldable } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { latexFolding } from "./latex-folding";

function foldAt(doc: string, lineNumber: number): string | null {
  const state = EditorState.create({ doc, extensions: [latexFolding()] });
  const line = state.doc.line(lineNumber);
  const range = foldable(state, line.from, line.to);
  return range ? state.sliceDoc(range.from, range.to) : null;
}

describe("LaTeX source folding", () => {
  it("folds an environment to its matching end across nested environments of the same name", () => {
    const doc = "\\begin{itemize}\n\\begin{itemize}\nx\n\\end{itemize}\n\\end{itemize}\nafter";
    expect(foldAt(doc, 1)).toBe("\n\\begin{itemize}\nx\n\\end{itemize}\n\\end{itemize}");
    expect(foldAt(doc, 2)).toBe("\nx\n\\end{itemize}");
  });

  it("does not fold single-line or unclosed environments", () => {
    expect(foldAt("\\begin{center}x\\end{center}\nmore\n\\begin{center}\ny\n\\end{center}", 1)).toBeNull();
    expect(foldAt("\\begin{center}\nnever closed", 1)).toBeNull();
  });

  it("folds a section until the next section of the same or a higher level", () => {
    const doc = "\\section{One}\ntext\n\\subsection{Inner}\nmore\n\\section*{Two}\nlast";
    expect(foldAt(doc, 1)).toBe("\ntext\n\\subsection{Inner}\nmore");
    expect(foldAt(doc, 3)).toBe("\nmore");
    expect(foldAt(doc, 5)).toBe("\nlast");
  });

  it("does not fold a section with nothing after it or plain lines", () => {
    expect(foldAt("\\section{Only}", 1)).toBeNull();
    expect(foldAt("\\section{A}\n\\section{B}", 1)).toBeNull();
    expect(foldAt("plain text\nmore", 1)).toBeNull();
  });
});

describe("LaTeX folding over a long chapter", () => {
  const LEVELS: Record<string, number> = { chapter: 1, section: 2, subsection: 3 };
  const HEADING = /^\s*\\(chapter|section|subsection)\*?\s*\{/;

  function referenceFold(doc: string, lineNumber: number): string | null {
    const state = EditorState.create({ doc });
    const line = state.doc.line(lineNumber);
    const begin = /\\begin\{([^}]*)\}/.exec(line.text);
    if (begin) {
      const rest = state.doc.sliceString(line.to, Math.min(state.doc.length, line.to + 200_000));
      const name = begin[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\\\(begin|end)\\{${name}\\}`, "g");
      let depth = 1;
      for (let match = re.exec(rest); match; match = re.exec(rest)) {
        depth += match[1] === "begin" ? 1 : -1;
        if (depth === 0) {
          const end = state.doc.lineAt(line.to + match.index);
          return state.sliceDoc(line.to, end.to);
        }
      }
      return null;
    }
    const heading = HEADING.exec(line.text);
    if (!heading) return null;
    let to = state.doc.length;
    for (let number = lineNumber + 1; number <= state.doc.lines; number++) {
      const next = HEADING.exec(state.doc.line(number).text);
      if (next && LEVELS[next[1]] <= LEVELS[heading[1]]) {
        to = state.doc.line(number - 1).to;
        break;
      }
    }
    return state.doc.lineAt(to).number > lineNumber ? state.sliceDoc(line.to, to) : null;
  }

  it("finds the same ranges as a whole-window scan", () => {
    const lines: string[] = ["\\chapter{Probability}"];
    for (let section = 0; section < 6; section++) {
      lines.push(`\\section{Part ${section}}`, "Some prose here.");
      lines.push("\\begin{example}", "\\begin{example}", "inner", "\\end{example}", "\\end{example}");
      lines.push("\\subsection{Detail}", "\\begin{itemize}", "\\item one", "\\end{itemize}");
      lines.push("\\begin{center}x\\end{center}", "\\begin{figure}", "never closed in this part");
    }
    lines.push("\\begin{verbatim}");
    for (let filler = 0; filler < 4_000; filler++) lines.push("x".repeat(60));
    lines.push("\\end{verbatim}", "\\section{Last}", "end");
    const doc = lines.join("\n");

    for (let number = 1; number <= lines.length; number++) {
      expect(foldAt(doc, number), `line ${number}`).toBe(referenceFold(doc, number));
    }
  });
});
