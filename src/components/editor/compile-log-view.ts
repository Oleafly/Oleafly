import {
  EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

export type LogLineCategory = "error" | "warn" | "lineref" | "register" | "normal";
export type LogHomeRanges = (text: string) => readonly (readonly [number, number])[];

const MAX_INDENT = 8;
const INDENT_PX = 12;
const OPEN_PAREN = 40;
const CLOSE_PAREN = 41;

export function logLineCategory(line: string): LogLineCategory {
  if (line.startsWith("!")) return "error";
  if (/^Runaway argument|Emergency stop|^<inserted text>/.test(line)) return "warn";
  if (/^l\.\d+/.test(line)) return "lineref";
  if (/^\\[a-zA-Z@]+=/.test(line)) return "register";
  return "normal";
}

export const LOG_TOKEN_RE = /(\([^\s()]+\.\w+\)|\\[a-zA-Z@]+|[{}()])/g;
const FILE_TOKEN_RE = /^\([^)]+\.\w+\)$/;

export function logTokenClass(token: string): string {
  if (FILE_TOKEN_RE.test(token)) return "text-primary";
  if (token === "(" || token === ")") return "text-primary/70";
  if (token.startsWith("\\")) return "text-purple-500 dark:text-purple-400";
  return "text-fuchsia-500";
}

function nextDepth(depth: number, line: string): number {
  let next = depth;
  for (let index = 0; index < line.length; index++) {
    const code = line.codePointAt(index);
    if (code === OPEN_PAREN) next++;
    else if (code === CLOSE_PAREN) next--;
  }
  return Math.max(0, next);
}

class LogDepths {
  constructor(
    private readonly doc: Text,
    private starts: Int32Array,
    private known: number,
  ) {}

  at(lineNumber: number): number {
    if (lineNumber < 1 || lineNumber > this.doc.lines) return 0;
    if (lineNumber > this.known) this.extend(lineNumber);
    return this.starts[lineNumber - 1];
  }

  extended(doc: Text, firstChangedLine: number): LogDepths {
    let starts = this.starts;
    const known = Math.min(this.known, firstChangedLine);
    if (starts.length < doc.lines) {
      const grown = new Int32Array(Math.max(doc.lines, starts.length * 2));
      grown.set(starts.subarray(0, known));
      starts = grown;
    }
    return new LogDepths(doc, starts, known);
  }

  private extend(target: number): void {
    let depth = 0;
    let number = 1;
    if (this.known > 0) {
      depth = nextDepth(this.starts[this.known - 1], this.doc.line(this.known).text);
      number = this.known + 1;
    }
    const iterator = this.doc.iterLines(number, target + 1);
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      this.starts[number - 1] = depth;
      depth = nextDepth(depth, next.value);
      number++;
    }
    this.known = target;
  }
}

function freshDepths(doc: Text): LogDepths {
  return new LogDepths(doc, new Int32Array(Math.max(doc.lines, 256)), 0);
}

const logDepthField = StateField.define<LogDepths>({
  create: (state) => freshDepths(state.doc),
  update(depths, transaction) {
    if (!transaction.docChanged) return depths;
    const end = transaction.startState.doc.length;
    let appended = true;
    transaction.changes.iterChangedRanges((fromA, toA) => {
      if (fromA !== end || toA !== end) appended = false;
    });
    if (!appended) return freshDepths(transaction.state.doc);
    return depths.extended(transaction.state.doc, transaction.startState.doc.lineAt(end).number);
  },
});

export function logLineDepth(state: EditorState, lineNumber: number): number {
  return state.field(logDepthField).at(lineNumber);
}

export const setLogHomeRanges = StateEffect.define<LogHomeRanges>();

const homeRangesField = StateField.define<LogHomeRanges>({
  create: () => () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setLogHomeRanges)) return effect.value;
    return value;
  },
});

const LINE_CLASS: Record<LogLineCategory, string> = {
  error: "text-red-500 font-semibold",
  warn: "text-red-400",
  lineref: "",
  register: "text-muted-foreground/40",
  normal: "text-muted-foreground",
};

const lineDecorations = new Map<string, Decoration>();

function lineDecoration(category: LogLineCategory, indent: number): Decoration {
  const key = `${category}:${indent}`;
  let decoration = lineDecorations.get(key);
  if (!decoration) {
    const classes = [LINE_CLASS[category], indent > 0 ? `cm-log-indent-${indent}` : ""].filter(Boolean);
    decoration = Decoration.line({ class: classes.join(" ") });
    lineDecorations.set(key, decoration);
  }
  return decoration;
}

const lineNumberMark = Decoration.mark({ class: "font-semibold text-primary" });
const lineRestMark = Decoration.mark({ class: "text-amber-600 dark:text-amber-400" });
const lineFallbackMark = Decoration.mark({ class: "text-primary" });

class HomeWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.textContent = "~";
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const homeMark = Decoration.replace({ widget: new HomeWidget() });
const LINE_REF_RE = /^(l\.\d+)(?!\d)(.*)$/;
const tokenMarks = new Map<string, Decoration>();

function tokenMark(token: string): Decoration {
  const className = logTokenClass(token);
  let mark = tokenMarks.get(className);
  if (!mark) {
    mark = Decoration.mark({ class: className });
    tokenMarks.set(className, mark);
  }
  return mark;
}

function lineMarks(text: string, from: number, category: LogLineCategory, out: Range<Decoration>[]): void {
  if (category === "error" || category === "warn" || text.length === 0) return;
  if (category === "lineref") {
    const match = LINE_REF_RE.exec(text);
    if (!match) {
      out.push(lineFallbackMark.range(from, from + text.length));
      return;
    }
    out.push(lineNumberMark.range(from, from + match[1].length));
    if (match[2]) out.push(lineRestMark.range(from + match[1].length, from + text.length));
    return;
  }
  for (const match of text.matchAll(LOG_TOKEN_RE)) {
    out.push(tokenMark(match[0]).range(from + match.index, from + match.index + match[0].length));
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const depths = state.field(logDepthField);
  const homeRanges = state.field(homeRangesField);
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let position = from; position <= to; ) {
      const line = state.doc.lineAt(position);
      const text = line.text;
      const category = logLineCategory(text);
      const flush = category === "error" || category === "warn" || category === "lineref";
      const indent = flush ? 0 : Math.min(depths.at(line.number), MAX_INDENT);
      ranges.push(lineDecoration(category, indent).range(line.from));
      lineMarks(text, line.from, category, ranges);
      for (const [start, end] of homeRanges(text)) {
        if (end > start) ranges.push(homeMark.range(line.from + start, line.from + end));
      }
      position = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

const logDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      const homesChanged = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(setLogHomeRanges)),
      );
      if (update.docChanged || update.viewportChanged || homesChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const indentRules: Record<string, { paddingLeft: string }> = {};
for (let indent = 1; indent <= MAX_INDENT; indent++) {
  indentRules[`.cm-log-indent-${indent}`] = { paddingLeft: `${indent * INDENT_PX}px` };
}

const logTheme = EditorView.theme({
  "&": { fontSize: "inherit", backgroundColor: "transparent", color: "inherit" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit", overflow: "visible" },
  ".cm-content": { padding: "0", caretColor: "transparent", minHeight: "0" },
  ".cm-line": { padding: "0" },
  ...indentRules,
});

const copySelectionOnly = EditorView.domEventHandlers({
  copy(event, view) {
    if (!view.state.selection.ranges.every((range) => range.empty)) return false;
    const text = view.dom.ownerDocument.getSelection()?.toString() ?? "";
    if (text) event.clipboardData?.setData("text/plain", text);
    return true;
  },
});

export function compileLogViewer(homeRanges: LogHomeRanges): Extension {
  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
    copySelectionOnly,
    logDepthField,
    homeRangesField.init(() => homeRanges),
    logDecorations,
    logTheme,
  ];
}

function withoutCarriageReturns(text: string): string {
  return text.includes("\r") ? text.replaceAll("\r", "") : text;
}

export function syncLogDocument(view: EditorView, previous: string, next: string): void {
  if (previous === next) return;
  if (previous.length > 0 && next.startsWith(previous)) {
    const insert = withoutCarriageReturns(next.slice(previous.length));
    if (insert) view.dispatch({ changes: { from: view.state.doc.length, insert } });
    return;
  }
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: withoutCarriageReturns(next) } });
}
