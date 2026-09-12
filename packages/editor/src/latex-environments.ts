import { completionStatus, startCompletion } from "@codemirror/autocomplete";
import { getIndentUnit, indentString } from "@codemirror/language";
import { countColumn, type EditorState } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  type Command,
  type ViewUpdate,
} from "@codemirror/view";
import { isLatexDocument, vimOwnsInput } from "./latex-structure-commands";
import { latexMaskedSlice } from "./latex-lexical";

const ENVIRONMENT_SCAN_LIMIT = 4 * 1024;

const LINE_SCAN_LIMIT = 2 * 1024;

const BEGIN_ON_LINE = /\\begin\s*\{([^{}]*)\}/gu;

const ENVIRONMENT_EDGE = /\\(begin|end)\s*\{([^{}]*)\}/gu;

const OPEN_BEGIN = String.raw`\begin{`;

const TRAILING_ARGUMENTS = /^(?:\s*(?:\[[^\]]*\]|\{[^{}]*\}))*\s*$/u;

const ITEM_ENVIRONMENTS = new Set(["itemize", "enumerate", "description"]);

function environmentBase(name: string): string {
  return name.endsWith("*") ? name.slice(0, -1) : name;
}

export function environmentSnippet(name: string): string {
  const close = `\\end{${name}}`;
  if (name === "tabular") {
    return `${name}}{\${1:ll}}\n\t\${2}\n${close}\${}`;
  }
  switch (environmentBase(name)) {
    case "itemize":
    case "enumerate":
      return `${name}}\n\t\\item \${1}\n${close}\${}`;
    case "description":
      return `${name}}\n\t\\item[\${1}] \${2}\n${close}\${}`;
    case "figure":
      return (
        `${name}}[\${1:htbp}]\n\t\\centering\n\t\${2}\n` +
        `\t\\caption{\${3}}\n\t\\label{\${4}}\n${close}\${}`
      );
    case "table":
      return (
        `${name}}[\${1:htbp}]\n\t\\centering\n\t\\caption{\${2}}\n` +
        `\t\\label{\${3}}\n\t\\begin{tabular}{\${4:ll}}\n\t\t\${5}\n` +
        `\t\\end{tabular}\n${close}\${}`
      );
    default:
      return `${name}}\n\t\${1}\n${close}\${}`;
  }
}

function environmentDepth(text: string, name: string): number {
  let depth = 0;
  ENVIRONMENT_EDGE.lastIndex = 0;
  for (
    let match = ENVIRONMENT_EDGE.exec(text);
    match;
    match = ENVIRONMENT_EDGE.exec(text)
  ) {
    if (match[2].trim() !== name) continue;
    if (match[1] === "begin") depth += 1;
    else if (depth > 0) depth -= 1;
  }
  return depth;
}

function closingsAhead(text: string, name: string): number {
  const open: string[] = [];
  let closings = 0;
  ENVIRONMENT_EDGE.lastIndex = 0;
  for (
    let match = ENVIRONMENT_EDGE.exec(text);
    match;
    match = ENVIRONMENT_EDGE.exec(text)
  ) {
    const environment = match[2].trim();
    if (match[1] === "begin") {
      open.push(environment);
      continue;
    }
    const level = open.lastIndexOf(environment);
    if (level >= 0) {
      open.length = level;
      continue;
    }
    if (environment !== name) break;
    closings += 1;
  }
  return closings;
}

function lastBeginOnLine(
  lineText: string,
): { name: string; end: number } | null {
  let found: { name: string; end: number } | null = null;
  BEGIN_ON_LINE.lastIndex = 0;
  for (
    let match = BEGIN_ON_LINE.exec(lineText);
    match;
    match = BEGIN_ON_LINE.exec(lineText)
  ) {
    found = { name: match[1].trim(), end: match.index + match[0].length };
  }
  return found;
}

function indentColumns(state: EditorState, lineText: string): number {
  return countColumn(/^\s*/u.exec(lineText)?.[0] ?? "", state.tabSize);
}

export const closeEnvironmentOnEnter: Command = (view) => {
  if (!isLatexDocument() || vimOwnsInput(view)) return false;
  const state = view.state;
  if (state.readOnly) return false;
  if (state.selection.ranges.length > 1) return false;
  const range = state.selection.main;
  if (!range.empty) return false;

  const line = state.doc.lineAt(range.head);
  const tailFrom = range.head;
  const tailTo = Math.min(line.to, tailFrom + LINE_SCAN_LIMIT);
  if (tailTo < line.to) return false;
  const tail = state.sliceDoc(tailFrom, tailTo);
  if (tail.trim().length > 0) return false;

  const headFrom = Math.max(line.from, range.head - LINE_SCAN_LIMIT);
  const scanFrom = Math.max(0, range.head - ENVIRONMENT_SCAN_LIMIT);
  const before = latexMaskedSlice(state, scanFrom, range.head);
  const lineHead = before.slice(headFrom - scanFrom);
  const begin = lastBeginOnLine(lineHead);
  if (!begin || begin.name.length === 0 || begin.name === "document") {
    return false;
  }
  if (!TRAILING_ARGUMENTS.test(lineHead.slice(begin.end))) return false;

  const openDepth = environmentDepth(before, begin.name);
  if (openDepth === 0) return false;
  const after = latexMaskedSlice(
    state,
    range.head,
    Math.min(state.doc.length, range.head + ENVIRONMENT_SCAN_LIMIT),
  );
  if (closingsAhead(after, begin.name) >= openDepth) return false;

  const content = state.sliceDoc(headFrom, range.head).trimEnd();
  const from = headFrom + content.length;
  const columns = indentColumns(state, lineHead);
  const outer = indentString(state, columns);
  const inner = indentString(state, columns + getIndentUnit(state));
  const base = environmentBase(begin.name);
  const itemMarker =
    base === "description" ? String.raw`\item[] ` : String.raw`\item `;
  const marker = ITEM_ENVIRONMENTS.has(base) ? itemMarker : "";
  const caret = base === "description" ? String.raw`\item[`.length : marker.length;
  view.dispatch({
    changes: {
      from,
      to: line.to,
      insert: `\n${inner}${marker}\n${outer}\\end{${begin.name}}`,
    },
    selection: { anchor: from + 1 + inner.length + caret },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
};

export const openEnvironmentCompletion = ViewPlugin.fromClass(
  class {
    view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
    }

    update(update: ViewUpdate) {
      if (!update.docChanged && !update.selectionSet) return;
      if (completionStatus(update.state) !== null) return;
      const range = update.state.selection.main;
      if (!range.empty) return;
      const start = range.head - OPEN_BEGIN.length;
      if (start < 0) return;
      if (update.state.sliceDoc(start, range.head) !== OPEN_BEGIN) return;
      if (update.state.sliceDoc(range.head, range.head + 1) !== "}") return;
      const view = this.view;
      const at = range.head;
      queueMicrotask(() => {
        const current = view.state.selection.main;
        if (!current.empty || current.head !== at) return;
        if (completionStatus(view.state) !== null) return;
        startCompletion(view);
      });
    }
  },
);
