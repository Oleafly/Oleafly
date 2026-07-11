import { codeFolding, foldService } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/**
 * Click-to-collapse folding for LaTeX. Since LaTeX is a StreamLanguage (no syntax
 * tree), we provide fold ranges directly:
 *  - `\begin{env}` ... `\end{env}` blocks (nesting-aware).
 *  - Sectioning commands, folded until the next same-or-higher-level section.
 * The fold gutter and keymap are already installed in the editor.
 */

const SECTION_LEVEL: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};
const SECTION_RE = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*\{/;

// Bound the forward scan so folding stays cheap on very large documents.
const WINDOW = 200_000;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function latexFoldRange(state: EditorState, lineStart: number, lineEnd: number): { from: number; to: number } | null {
  const lineText = state.doc.sliceString(lineStart, lineEnd);

  // Environment fold: \begin{env} ... matching \end{env}.
  const begin = /\\begin\{([^}]*)\}/.exec(lineText);
  if (begin) {
    const env = begin[1];
    const rest = state.doc.sliceString(lineEnd, Math.min(state.doc.length, lineEnd + WINDOW));
    const re = new RegExp(`\\\\(begin|end)\\{${escapeRe(env)}\\}`, "g");
    let depth = 1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest))) {
      depth += m[1] === "begin" ? 1 : -1;
      if (depth === 0) {
        const endLine = state.doc.lineAt(lineEnd + m.index);
        if (endLine.number > state.doc.lineAt(lineStart).number) return { from: lineEnd, to: endLine.to };
        return null; // single-line block, nothing to fold
      }
    }
    return null;
  }

  // Section fold: until the next section of the same or higher level.
  const sec = SECTION_RE.exec(lineText);
  if (sec) {
    const level = SECTION_LEVEL[sec[1]];
    const startNo = state.doc.lineAt(lineStart).number;
    const total = state.doc.lines;
    let to = state.doc.length;
    for (let ln = startNo + 1; ln <= total; ln++) {
      const line = state.doc.line(ln);
      const lm = SECTION_RE.exec(line.text);
      if (lm && SECTION_LEVEL[lm[1]] <= level) {
        to = state.doc.line(ln - 1).to;
        break;
      }
    }
    if (state.doc.lineAt(to).number > startNo) return { from: lineEnd, to };
  }

  return null;
}

export function latexFolding() {
  return [codeFolding(), foldService.of(latexFoldRange)];
}
