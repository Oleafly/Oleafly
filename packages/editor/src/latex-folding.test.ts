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
