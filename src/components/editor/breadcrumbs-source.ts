import { syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { decodeLatexAccents } from "@oleafly/latex";

export interface SectionCrumb {
  line: number;
  level: number;
  pos: number;
  title: string;
}

const SECTION_LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

export const SECTION_LINE_RE =
  /^[ \t]*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?[ \t]*(?:\[[^\]]*\][ \t]*)?\{/u;

const MAX_SCANNED_LINES = 50_000;

function balancedTitle(text: string, openBrace: number): { title: string; start: number } | null {
  let depth = 0;
  for (let index = openBrace; index < text.length; index++) {
    const char = text[index];
    if (char === "\\") {
      index++;
      continue;
    }
    if (char === "{") {
      depth++;
      continue;
    }
    if (char === "}") {
      depth--;
      if (depth === 0) {
        return { title: text.slice(openBrace + 1, index), start: openBrace + 1 };
      }
    }
  }
  if (depth > 0) return { title: text.slice(openBrace + 1), start: openBrace + 1 };
  return null;
}

export function readableTitle(raw: string): string {
  return decodeLatexAccents(raw)
    .replaceAll(
      /\\(?:([%$&#_{}])|([,;:! ~\\])|[\p{L}\p{M}@]+\s*|.?)|[{}]/gu,
      (_whole, escaped?: string, space?: string) => escaped ?? (space ? " " : ""),
    )
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function headingFromLine(
  text: string,
  lineNumber: number,
  lineFrom: number,
): SectionCrumb | null {
  const match = SECTION_LINE_RE.exec(text);
  if (!match) return null;
  const extracted = balancedTitle(text, match[0].length - 1);
  if (!extracted) return null;
  const title = readableTitle(extracted.title);
  return {
    line: lineNumber,
    level: SECTION_LEVELS[match[1]],
    pos: lineFrom + extracted.start,
    title,
  };
}

export function scanSectionHeadings(doc: Text): SectionCrumb[] {
  if (doc.lines > MAX_SCANNED_LINES) return [];
  const headings: SectionCrumb[] = [];
  let lineNumber = 0;
  let offset = 0;
  for (const text of doc.iterLines()) {
    lineNumber++;
    const heading = text.trimStart().startsWith("%")
      ? null
      : headingFromLine(text, lineNumber, offset);
    if (heading) headings.push(heading);
    offset += text.length + 1;
  }
  return headings;
}

export function ancestorsAtLine(
  headings: readonly SectionCrumb[],
  cursorLine: number,
): SectionCrumb[] {
  const stack: SectionCrumb[] = [];
  for (const heading of headings) {
    if (heading.line > cursorLine) break;
    let top = stack.at(-1);
    while (top && top.level >= heading.level) {
      stack.pop();
      top = stack.at(-1);
    }
    stack.push(heading);
  }
  return stack;
}

function sectionNodeHeading(state: EditorState, node: SyntaxNode): SectionCrumb | null {
  const line = state.doc.lineAt(node.from);
  return headingFromLine(line.text, line.number, line.from);
}

export function treeSectionCrumbs(state: EditorState): SectionCrumb[] {
  const tree = syntaxTree(state);
  if (tree.length === 0) return [];
  const crumbs: SectionCrumb[] = [];
  let node: SyntaxNode | null = tree.resolveInner(state.selection.main.head, -1);
  while (node) {
    if (node.type.is("$Section") || node.name === "SectioningCommand") {
      const heading = sectionNodeHeading(state, node);
      if (heading && !crumbs.some((crumb) => crumb.line === heading.line)) {
        crumbs.push(heading);
      }
    }
    node = node.parent;
  }
  return crumbs.reverse();
}

export function sectionCrumbsForState(
  state: EditorState,
  visual: boolean,
): SectionCrumb[] {
  if (visual) {
    const fromTree = treeSectionCrumbs(state);
    if (fromTree.length > 0) return fromTree;
  }
  const cursorLine = state.doc.lineAt(state.selection.main.head).number;
  return ancestorsAtLine(scanSectionHeadings(state.doc), cursorLine);
}
