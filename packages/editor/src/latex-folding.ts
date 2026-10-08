import { codeFolding, foldService } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { escapeRegExp } from "./regexp";

// Since LaTeX is a StreamLanguage (no syntax tree), we provide fold ranges
// directly: `\begin{env}` ... `\end{env}` blocks (nesting-aware), and
// sectioning commands folded until the next same-or-higher-level section.

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

function environmentFoldRange(
  state: EditorState,
  lineStart: number,
  lineEnd: number,
  env: string,
): { from: number; to: number } | null {
  const next = state.doc.lineAt(lineStart).number + 1;
  if (next > state.doc.lines) return null;
  const re = new RegExp(String.raw`\\(begin|end)\{${escapeRegExp(env)}\}`, "g");
  const limit = Math.min(state.doc.length, lineEnd + WINDOW);
  let depth = 1;
  let from = lineEnd + 1;
  for (const line of state.doc.iterLines(next)) {
    if (from > limit) break;
    const to = from + line.length;
    const text = to > limit ? line.slice(0, limit - from) : line;
    re.lastIndex = 0;
    for (let match = re.exec(text); match; match = re.exec(text)) {
      depth += match[1] === "begin" ? 1 : -1;
      if (depth === 0) return { from: lineEnd, to };
    }
    from = to + 1;
  }
  return null;
}

function sectionFoldEnd(
  state: EditorState,
  startNo: number,
  level: number,
): number {
  if (startNo >= state.doc.lines) return state.doc.length;
  let previousEnd = state.doc.line(startNo).to;
  for (const line of state.doc.iterLines(startNo + 1)) {
    const match = SECTION_RE.exec(line);
    if (match && SECTION_LEVEL[match[1]] <= level) return previousEnd;
    previousEnd += line.length + 1;
  }
  return state.doc.length;
}

function latexFoldRange(state: EditorState, lineStart: number, lineEnd: number): { from: number; to: number } | null {
  const lineText = state.doc.sliceString(lineStart, lineEnd);

  const begin = /\\begin\{([^}]*)\}/.exec(lineText);
  if (begin) {
    return environmentFoldRange(state, lineStart, lineEnd, begin[1]);
  }

  const sec = SECTION_RE.exec(lineText);
  if (sec) {
    const startNo = state.doc.lineAt(lineStart).number;
    const to = sectionFoldEnd(state, startNo, SECTION_LEVEL[sec[1]]);
    if (state.doc.lineAt(to).number > startNo) return { from: lineEnd, to };
  }

  return null;
}

export function latexFolding() {
  return [codeFolding(), foldService.of(latexFoldRange)];
}
