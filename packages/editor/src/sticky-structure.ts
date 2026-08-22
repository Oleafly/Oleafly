import type { Text } from "@codemirror/state";

/**
 * A nesting level that sticky scroll can pin: one `\begin{env}`…`\end{env}`
 * block, or one sectioning command and everything under it.
 */
export interface StickyScope {
  /** 1-based line number of the opening line. */
  line: number;
  /** 1-based line number of the last line the scope covers. */
  endLine: number;
}

// Matches the fold service's levels so folding and sticky scroll agree on what
// nests inside what.
const SECTION_LEVEL: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};
const SECTION_RE =
  /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/;
const BEGIN_RE = /\\begin\s*\{([^}]*)\}/;
const END_RE = /\\end\s*\{([^}]*)\}/;

// `document` wraps everything after the preamble, so pinning it would spend a
// row of the viewport, permanently, telling you that you are in the document.
// Every other environment earns its row by being one you can scroll out of.
const IGNORED_ENVS = new Set(["document"]);

/**
 * Beyond this the per-edit rescan becomes noticeable while typing, and sticky
 * scroll turns itself off rather than making the editor feel heavy.
 */
export const STICKY_MAX_LINES = 50_000;

// A section header is a scope; a section header nested in an environment is
// still a section. Environments and sections therefore share one stack, with
// environments given a level below every section so an environment opened
// inside a subsection is not closed by the next section-level pop.
const ENV_LEVEL = 100;

interface OpenScope {
  line: number;
  level: number;
  env: string | null;
}

/**
 * Every scope in the document, in opening order.
 *
 * One linear pass. Callers cache the result against the document they scanned;
 * recomputing it per scroll frame would be far too much work for a list that
 * only changes when the text does.
 */
export function stickyScopes(doc: Text): StickyScope[] {
  if (doc.lines > STICKY_MAX_LINES) return [];

  const scopes: StickyScope[] = [];
  const open: OpenScope[] = [];
  const lastLine = doc.lines;

  const close = (scope: OpenScope, endLine: number) => {
    // A scope that opens and closes on one line has nothing to pin: the reader
    // can never be scrolled past its header and still inside it.
    if (endLine > scope.line) scopes.push({ line: scope.line, endLine });
  };

  let lineNumber = 0;
  for (const text of doc.iterLines()) {
    lineNumber++;
    // Strip a trailing comment so commented-out structure cannot open a scope
    // that never closes.
    const line = text.replace(/(^|[^\\])%.*$/, "$1");

    const end = END_RE.exec(line);
    if (end) {
      const env = end[1].trim();
      for (let i = open.length - 1; i >= 0; i--) {
        if (open[i].env !== env) continue;
        // Anything still open inside this environment ends with it.
        for (let j = open.length - 1; j > i; j--) close(open[j], lineNumber - 1);
        close(open[i], lineNumber);
        open.length = i;
        break;
      }
    }

    const begin = BEGIN_RE.exec(line);
    if (begin) {
      const env = begin[1].trim();
      if (!IGNORED_ENVS.has(env.replace(/\*$/, ""))) {
        open.push({ line: lineNumber, level: ENV_LEVEL, env });
      }
      continue;
    }

    const section = SECTION_RE.exec(line);
    if (section) {
      const level = SECTION_LEVEL[section[1]];
      // A heading ends every open heading at its own depth or deeper: a new
      // \section closes the previous \section and its \subsections, while a
      // \subsection leaves its parent \section open. Environments survive,
      // because a section boundary inside an unbalanced environment is a
      // malformed document, not a close.
      while (
        open.length &&
        open[open.length - 1].env === null &&
        open[open.length - 1].level >= level
      ) {
        close(open.pop()!, lineNumber - 1);
      }
      open.push({ line: lineNumber, level, env: null });
    }
  }

  for (let i = open.length - 1; i >= 0; i--) close(open[i], lastLine);

  scopes.sort((a, b) => a.line - b.line);
  return scopes;
}

/**
 * The scopes containing `topLine`, outermost first, capped at `max`.
 *
 * The cap drops the innermost scopes: when a deeply nested block runs off the
 * limit, knowing you are in section 3 of chapter 2 orients you better than
 * knowing the innermost `minipage`.
 */
export function scopesAtLine(
  scopes: readonly StickyScope[],
  topLine: number,
  max: number,
): StickyScope[] {
  const containing: StickyScope[] = [];
  for (const scope of scopes) {
    if (scope.line > topLine) break;
    // `>=` keeps the header pinned through its own last line; `scope.line <
    // topLine` drops it the moment its own line is visible for real.
    if (scope.endLine >= topLine && scope.line < topLine) containing.push(scope);
  }
  return containing.slice(0, max);
}
