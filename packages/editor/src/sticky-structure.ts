import type { EditorState, Text } from "@codemirror/state";
import { typstTools } from "./typst";

export interface StickyScope {
  line: number;
  endLine: number;
}

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

const IGNORED_ENVS = new Set(["document"]);

export const STICKY_MAX_LINES = 50_000;

const ENV_LEVEL = 100;

interface OpenScope {
  line: number;
  level: number;
  env: string | null;
}

type CloseScope = (scope: OpenScope, endLine: number) => void;

function closeEnvironmentScope(
  open: OpenScope[],
  env: string,
  lineNumber: number,
  close: CloseScope,
): void {
  for (let i = open.length - 1; i >= 0; i--) {
    if (open[i].env !== env) continue;
    for (let j = open.length - 1; j > i; j--) close(open[j], lineNumber - 1);
    close(open[i], lineNumber);
    open.length = i;
    break;
  }
}

function closeHeadingScopes(
  open: OpenScope[],
  level: number,
  lineNumber: number,
  close: CloseScope,
): void {
  let top = open.at(-1);
  while (top?.env === null && top.level >= level) {
    close(open.pop()!, lineNumber - 1);
    top = open.at(-1);
  }
}

export function stickyScopes(doc: Text): StickyScope[] {
  if (doc.lines > STICKY_MAX_LINES) return [];

  const scopes: StickyScope[] = [];
  const open: OpenScope[] = [];
  const lastLine = doc.lines;

  const close = (scope: OpenScope, endLine: number) => {
    if (endLine > scope.line) scopes.push({ line: scope.line, endLine });
  };

  let lineNumber = 0;
  for (const text of doc.iterLines()) {
    lineNumber++;
    const line = text.replace(/(^|[^\\])%[^\n]*/, "$1");

    const end = END_RE.exec(line);
    if (end) closeEnvironmentScope(open, end[1].trim(), lineNumber, close);

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
      closeHeadingScopes(open, level, lineNumber, close);
      open.push({ line: lineNumber, level, env: null });
    }
  }

  for (let i = open.length - 1; i >= 0; i--) close(open[i], lastLine);

  scopes.sort((a, b) => a.line - b.line);
  return scopes;
}

export function scopesAtLine(
  scopes: readonly StickyScope[],
  topLine: number,
  max: number,
): StickyScope[] {
  const containing: StickyScope[] = [];
  for (const scope of scopes) {
    if (scope.line > topLine) break;
    if (scope.endLine >= topLine && scope.line < topLine) containing.push(scope);
  }
  return containing.slice(0, max);
}

export interface StickySource {
  scopes(state: EditorState): StickyScope[];
  followsTree?: boolean;
}

export const latexStickySource: StickySource = {
  scopes: (state) => stickyScopes(state.doc),
};

export const typstStickySource: StickySource = {
  scopes: (state) => typstTools()?.typstStickyScopes(state) ?? [],
  followsTree: true,
};
