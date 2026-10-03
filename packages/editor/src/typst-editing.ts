import { getIndentUnit, indentString, language, syntaxTree } from "@codemirror/language";
import {
  CharCategory,
  countColumn,
  EditorSelection,
  MapMode,
  Prec,
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  type ChangeSpec,
  type EditorState,
  type Extension,
  type Line,
  type SelectionRange,
  type Text,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap, type KeyBinding } from "@codemirror/view";
import type { NodeSet, SyntaxNode } from "@lezer/common";
import { vimOwnsInput } from "./latex-structure-commands";
import { typstAutolinkEnd, typstIdentifierEnd } from "./typst-syntax";

export type TypstContext =
  | "markup"
  | "code"
  | "math"
  | "string"
  | "raw"
  | "comment";

export interface TypstEditingOptions {
  math: boolean;
  wrap: boolean;
}

const SCAN_WINDOW = 64 * 1024;
const LINE_WINDOW = 2 * 1024;
const LIST_SCAN_LINES = 200;
const CONTEXT_CACHE_SIZE = 16;

type FrameKind =
  | "markup"
  | "content"
  | "code"
  | "paren"
  | "math"
  | "embedded"
  | "statement";

interface Frame {
  readonly kind: FrameKind;
  fresh: boolean;
}

type Step = number | TypstContext;

const STATEMENT_KEYWORDS: ReadonlySet<string> = new Set([
  "let",
  "set",
  "show",
  "import",
  "include",
  "return",
  "if",
  "for",
  "while",
  "context",
  "break",
  "continue",
]);

const LABEL = /<[\p{L}\p{M}\p{N}_][\p{L}\p{M}\p{N}_:.-]*>/uy;

class TypstScanner {
  private readonly stack: Frame[] = [{ kind: "markup", fresh: false }];

  constructor(
    private readonly text: string,
    private readonly target: number,
  ) {}

  run(from: number): TypstContext {
    let index = from;
    while (index < this.target) {
      const step = this.step(index);
      if (typeof step === "string") return step;
      index = step;
    }
    return this.contextOf(this.top());
  }

  private top(): Frame {
    return this.stack[this.stack.length - 1];
  }

  private push(kind: FrameKind, fresh = false): void {
    this.stack.push({ kind, fresh });
  }

  private pop(): void {
    if (this.stack.length > 1) this.stack.pop();
  }

  private popThrough(kind: FrameKind): void {
    for (let level = this.stack.length - 1; level > 0; level -= 1) {
      if (this.stack[level].kind === kind) {
        this.stack.length = level;
        return;
      }
    }
  }

  private contextOf(frame: Frame): TypstContext {
    if (frame.kind === "markup" || frame.kind === "content") return "markup";
    if (frame.kind === "math") return "math";
    return "code";
  }

  private step(index: number): Step {
    const kind = this.top().kind;
    if (kind === "markup" || kind === "content") return this.markupStep(index);
    if (kind === "math") return this.mathStep(index);
    return this.codeStep(index);
  }

  private inside(from: number, insideEnd: number, next: number, context: TypstContext): Step {
    return this.target > from && this.target < insideEnd ? context : next;
  }

  private commentStep(index: number): Step | null {
    const next = this.text[index + 1];
    if (next === "/") {
      const newline = this.text.indexOf("\n", index);
      const end = newline < 0 ? this.text.length : newline;
      return this.inside(index, end + 1, end, "comment");
    }
    if (next !== "*") return null;
    let depth = 1;
    let cursor = index + 2;
    while (cursor < this.text.length) {
      if (this.text.startsWith("/*", cursor)) {
        depth += 1;
        cursor += 2;
      } else if (this.text.startsWith("*/", cursor)) {
        depth -= 1;
        cursor += 2;
        if (depth === 0) return this.inside(index, cursor, cursor, "comment");
      } else {
        cursor += 1;
      }
    }
    return this.inside(index, this.text.length + 1, this.text.length, "comment");
  }

  private rawStep(index: number): Step {
    let cursor = index;
    while (this.text[cursor] === "`") cursor += 1;
    const ticks = cursor - index;
    if (ticks === 2) return this.inside(index, cursor, cursor, "raw");
    const close = this.text.indexOf("`".repeat(ticks), cursor);
    if (close < 0) {
      return this.inside(index, this.text.length + 1, this.text.length, "raw");
    }
    const end = close + ticks;
    return this.inside(index, end, end, "raw");
  }

  private stringStep(index: number): Step {
    let cursor = index + 1;
    while (cursor < this.text.length) {
      const character = this.text[cursor];
      if (character === "\\") {
        cursor += 2;
      } else if (character === '"') {
        return this.inside(index, cursor + 1, cursor + 1, "string");
      } else if (character === "\n") {
        return this.inside(index, cursor + 1, cursor, "string");
      } else {
        cursor += 1;
      }
    }
    return this.inside(index, this.text.length + 1, this.text.length, "string");
  }

  private hashStep(index: number): Step {
    const start = index + 1;
    const identifierEnd = typstIdentifierEnd(this.text, start);
    if (identifierEnd > start) {
      const word = this.text.slice(start, identifierEnd);
      this.push(STATEMENT_KEYWORDS.has(word) ? "statement" : "embedded");
      return identifierEnd;
    }
    const after = this.text[start];
    if (after === "(" || after === "{" || after === "[" || after === '"') {
      this.push("embedded", true);
    }
    return start;
  }

  private markupStep(index: number): Step {
    const character = this.text[index];
    switch (character) {
      case "\\":
        return index + 2;
      case "/":
        return this.commentStep(index) ?? index + 1;
      case "`":
        return this.rawStep(index);
      case "$":
        this.push("math");
        return index + 1;
      case "#":
        return this.hashStep(index);
      case "]":
        if (this.top().kind === "content") this.pop();
        return index + 1;
      case "<": {
        LABEL.lastIndex = index;
        return LABEL.test(this.text) ? LABEL.lastIndex : index + 1;
      }
      case "h": {
        const end = typstAutolinkEnd(this.text, index);
        return end !== null && end > index ? end : index + 1;
      }
      default:
        return index + 1;
    }
  }

  private mathStep(index: number): Step {
    const character = this.text[index];
    switch (character) {
      case "\\":
        return index + 2;
      case "$":
        this.pop();
        return index + 1;
      case '"':
        return this.stringStep(index);
      case "#":
        return this.hashStep(index);
      case "/":
        return this.commentStep(index) ?? index + 1;
      default:
        return index + 1;
    }
  }

  private embeddedStep(index: number, frame: Frame): Step | null {
    const character = this.text[index];
    if (frame.fresh) {
      frame.fresh = false;
      if (character === "{") {
        this.push("code");
        return index + 1;
      }
      if (character === '"') return this.stringStep(index);
    } else if (character === ".") {
      const end = typstIdentifierEnd(this.text, index + 1);
      if (end > index + 1) return end;
    }
    if (character === "(") {
      this.push("paren");
      return index + 1;
    }
    if (character === "[") {
      this.push("content");
      return index + 1;
    }
    this.pop();
    return index;
  }

  private codeStep(index: number): Step {
    const frame = this.top();
    const character = this.text[index];
    if (frame.kind === "embedded") {
      const step = this.embeddedStep(index, frame);
      if (step !== null) return step;
    }
    if (frame.kind === "statement" && (character === "\n" || character === ";")) {
      this.pop();
      return character === ";" ? index + 1 : index;
    }
    switch (character) {
      case '"':
        return this.stringStep(index);
      case "/":
        return this.commentStep(index) ?? index + 1;
      case "`":
        return this.rawStep(index);
      case "$":
        this.push("math");
        return index + 1;
      case "[":
        this.push("content");
        return index + 1;
      case "{":
        this.push("code");
        return index + 1;
      case "(":
        this.push("paren");
        return index + 1;
      case "}":
        this.popThrough("code");
        return index + 1;
      case ")":
        this.popThrough("paren");
        return index + 1;
      case "]":
        this.popThrough("content");
        return index + 1;
      default:
        return index + 1;
    }
  }
}

export function typstContextInText(
  text: string,
  pos: number,
  from = 0,
): TypstContext {
  return new TypstScanner(text, Math.min(pos, text.length)).run(from);
}

const TREE_CODE_NODES = [
  "Code",
  "CodeBlock",
  "Args",
  "Parenthesized",
  "FuncCall",
  "Ident",
  "FieldAccess",
  "Closure",
  "Params",
  "Array",
  "Dict",
  "Named",
  "Keyed",
  "Unary",
  "Binary",
  "Spread",
  "LetBinding",
  "SetRule",
  "ShowRule",
  "Contextual",
  "Conditional",
  "WhileLoop",
  "ForLoop",
  "ModuleImport",
  "ImportItems",
  "ModuleInclude",
  "Destructuring",
  "FuncReturn",
] as const;

const TREE_CONTEXTS: ReadonlyMap<string, TypstContext> = new Map<string, TypstContext>([
  ["LineComment", "comment"],
  ["BlockComment", "comment"],
  ["Raw", "raw"],
  ["Str", "string"],
  ["Equation", "math"],
  ["Math", "math"],
  ["Markup", "markup"],
  ["ContentBlock", "markup"],
  ["Source", "markup"],
  ...TREE_CODE_NODES.map((name): [string, TypstContext] => [name, "code"]),
]);

const TREE_REQUIRED_GROUPS: readonly (readonly string[])[] = [
  ["LineComment", "BlockComment"],
  ["Raw"],
  ["Str"],
  ["Equation", "Math"],
  ["Markup", "ContentBlock"],
  ["Code", "CodeBlock"],
];

const TREE_ROOTS: ReadonlySet<string> = new Set(["Source"]);

const usableNodeSets = new WeakMap<NodeSet, boolean>();

function treeNamesUsable(nodeSet: NodeSet): boolean {
  const cached = usableNodeSets.get(nodeSet);
  if (cached !== undefined) return cached;
  const names = new Set(nodeSet.types.map((type) => type.name));
  const usable = TREE_REQUIRED_GROUPS.every((group) =>
    group.some((name) => names.has(name)),
  );
  usableNodeSets.set(nodeSet, usable);
  return usable;
}

function treeContextAt(state: EditorState, pos: number): TypstContext | null {
  const tree = syntaxTree(state);
  const parser = state.facet(language)?.parser as { nodeSet?: NodeSet } | undefined;
  const usable = parser?.nodeSet
    ? treeNamesUsable(parser.nodeSet)
    : TREE_ROOTS.has(tree.type.name);
  if (!usable || tree.length < pos) return null;
  if (tree.resolveInner(pos, -1).name === "LineComment") return "comment";
  for (
    let node: SyntaxNode | null = tree.resolveInner(pos, 0);
    node;
    node = node.parent
  ) {
    const context = TREE_CONTEXTS.get(node.name);
    if (context) return context;
  }
  return null;
}

const contextCache = new WeakMap<Text, Map<number, TypstContext>>();

function scannedContextAt(state: EditorState, pos: number): TypstContext {
  let cache = contextCache.get(state.doc);
  const cached = cache?.get(pos);
  if (cached) return cached;
  const from =
    pos > SCAN_WINDOW ? state.doc.lineAt(pos - SCAN_WINDOW).from : 0;
  const context = typstContextInText(state.sliceDoc(from, pos), pos - from);
  if (!cache) {
    cache = new Map();
    contextCache.set(state.doc, cache);
  }
  if (cache.size >= CONTEXT_CACHE_SIZE) cache.clear();
  cache.set(pos, context);
  return context;
}

export function typstContextAt(state: EditorState, pos: number): TypstContext {
  const safe = Math.max(0, Math.min(pos, state.doc.length));
  return treeContextAt(state, safe) ?? scannedContextAt(state, safe);
}

class TrackedDollar extends RangeValue {
  constructor(
    readonly opener: string,
    readonly closer: string,
  ) {
    super();
  }

  override eq(other: RangeValue): boolean {
    return (
      other instanceof TrackedDollar &&
      other.opener === this.opener &&
      other.closer === this.closer
    );
  }
}

TrackedDollar.prototype.startSide = 1;
TrackedDollar.prototype.endSide = -1;

interface TrackedDollarInsertion {
  readonly from: number;
  readonly to: number;
  readonly opener: string;
  readonly closer: string;
}

const trackDollar = StateEffect.define<TrackedDollarInsertion>({
  map(value, mapping) {
    const from = mapping.mapPos(value.from, 1, MapMode.TrackDel);
    const to = mapping.mapPos(value.to, -1, MapMode.TrackDel);
    return from === null || to === null || from >= to
      ? undefined
      : { ...value, from, to };
  },
});

const forgetDollar = StateEffect.define<number>({
  map: (value, mapping) => mapping.mapPos(value, 1),
});

const trackedDollars = StateField.define<RangeSet<TrackedDollar>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    let next = set.map(tr.changes);
    if (tr.selection) {
      const line = tr.state.doc.lineAt(tr.selection.main.head);
      next = next.update({
        filter: (_from, to) => to >= line.from && to <= line.to,
      });
    }
    for (const effect of tr.effects) {
      if (effect.is(forgetDollar)) {
        const end = effect.value;
        next = next.update({ filter: (_from, to) => to !== end });
      } else if (effect.is(trackDollar)) {
        const { from, to, opener, closer } = effect.value;
        next = next.update({
          add: [new TrackedDollar(opener, closer).range(from, to)],
        });
      }
    }
    return next;
  },
});

interface RangeChange {
  changes: ChangeSpec[];
  range: SelectionRange;
  effects?: StateEffect<unknown>[];
}

function pendingCloserAt(
  state: EditorState,
  pos: number,
): { closer: string; to: number } | null {
  const set = state.field(trackedDollars, false);
  if (!set || set.size === 0) return null;
  let found: { closer: string; to: number } | null = null;
  set.between(pos, pos, (from, to, value) => {
    if (to - value.closer.length !== pos) return;
    if (state.sliceDoc(pos, to) !== value.closer) return;
    if (state.sliceDoc(from, from + value.opener.length) !== value.opener) return;
    found = { closer: value.closer, to };
    return false;
  });
  return found;
}

function characterAt(state: EditorState, pos: number): string {
  if (pos < 0 || pos >= state.doc.length) return "";
  return state.sliceDoc(pos, pos + 1);
}

function isWordCharacter(state: EditorState, pos: number, character: string): boolean {
  return (
    character.length > 0 &&
    state.charCategorizer(pos)(character) === CharCategory.Word
  );
}

function escapedAt(state: EditorState, pos: number): boolean {
  const before = state.sliceDoc(Math.max(0, pos - 64), pos);
  let backslashes = 0;
  while (
    backslashes < before.length &&
    before[before.length - 1 - backslashes] === "\\"
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function plainInsert(range: SelectionRange, text: string): RangeChange {
  return {
    changes: [{ from: range.from, to: range.to, insert: text }],
    range: EditorSelection.cursor(range.from + text.length),
  };
}

function wrapRange(range: SelectionRange, open: string, close: string): RangeChange {
  return {
    changes: [
      { from: range.from, insert: open },
      { from: range.to, insert: close },
    ],
    range: EditorSelection.range(
      range.anchor + open.length,
      range.head + open.length,
    ),
  };
}

function selectionInMarkup(state: EditorState, range: SelectionRange): boolean {
  return (
    typstContextAt(state, range.from) === "markup" &&
    typstContextAt(state, range.to) === "markup"
  );
}

function overtype(pos: number, closer: string, to: number): RangeChange {
  return {
    changes: [{ from: pos, to, insert: closer }],
    range: EditorSelection.cursor(pos + closer.length),
    effects: [forgetDollar.of(to)],
  };
}

function dollarForRange(state: EditorState, range: SelectionRange): RangeChange {
  if (!range.empty) {
    return selectionInMarkup(state, range)
      ? wrapRange(range, "$", "$")
      : plainInsert(range, "$");
  }
  const pos = range.head;
  const pending = pendingCloserAt(state, pos);
  if (pending) return overtype(pos, pending.closer, pending.to);
  if (escapedAt(state, pos)) return plainInsert(range, "$");
  const context = typstContextAt(state, pos);
  const after = characterAt(state, pos);
  if (context === "math" && after === "$") return overtype(pos, "$", pos + 1);
  if (context !== "markup") return plainInsert(range, "$");
  const before = characterAt(state, pos - 1);
  if (
    after === "$" ||
    isWordCharacter(state, pos, before) ||
    isWordCharacter(state, pos, after)
  ) {
    return plainInsert(range, "$");
  }
  return {
    changes: [{ from: pos, insert: "$$" }],
    range: EditorSelection.cursor(pos + 1),
    effects: [trackDollar.of({ from: pos, to: pos + 2, opener: "$", closer: "$" })],
  };
}

function emptyInlinePairAt(state: EditorState, pos: number): boolean {
  return (
    characterAt(state, pos - 1) === "$" &&
    characterAt(state, pos) === "$" &&
    !escapedAt(state, pos - 1) &&
    typstContextAt(state, pos) === "math"
  );
}

function emptyDisplayPairAt(state: EditorState, pos: number): boolean {
  return (
    state.sliceDoc(pos - 2, pos) === "$ " &&
    state.sliceDoc(pos, pos + 2) === " $" &&
    !escapedAt(state, pos - 2) &&
    typstContextAt(state, pos) === "math"
  );
}

function displayPromotion(state: EditorState): TransactionSpec | null {
  const ranges = state.selection.ranges;
  const promotable = ranges.every(
    (range) =>
      range.empty &&
      emptyInlinePairAt(state, range.head) &&
      typstContextAt(state, range.head - 1) === "markup",
  );
  if (!promotable) return null;
  return {
    ...state.changeByRange((range) => {
      const pos = range.head;
      return {
        changes: [{ from: pos, insert: "  " }],
        range: EditorSelection.cursor(pos + 1),
        effects: [
          forgetDollar.of(pos + 3),
          trackDollar.of({ from: pos - 1, to: pos + 3, opener: "$ ", closer: " $" }),
        ],
      };
    }),
    userEvent: "input.type",
    scrollIntoView: true,
  };
}

const WRAP_CHARACTERS: ReadonlySet<string> = new Set(["*", "_", "`"]);

function wrapChange(state: EditorState, character: string): TransactionSpec | null {
  if (state.selection.ranges.every((range) => range.empty)) return null;
  return {
    ...state.changeByRange((range) =>
      !range.empty && selectionInMarkup(state, range)
        ? wrapRange(range, character, character)
        : plainInsert(range, character),
    ),
    userEvent: "input.type",
    scrollIntoView: true,
  };
}

export function typstInputChange(
  state: EditorState,
  text: string,
  options: TypstEditingOptions,
): TransactionSpec | null {
  if (state.readOnly) return null;
  if (options.math && text === "$") {
    return {
      ...state.changeByRange((range) => dollarForRange(state, range)),
      userEvent: "input.type",
      scrollIntoView: true,
    };
  }
  if (options.math && text === " ") {
    return displayPromotion(state);
  }
  if (options.wrap && WRAP_CHARACTERS.has(text)) return wrapChange(state, text);
  return null;
}

interface ListItem {
  readonly line: Line;
  readonly indent: string;
  readonly marker: string;
  readonly gap: string;
}

const LIST_ITEM = /^([ \t]*)(-|\+|\/|\d+\.)(?=[ \t]|$)([ \t]*)/u;
const MARKER_BEFORE_CARET = /^([ \t]*)(-|\+|\/|\d+\.)[ \t]$/u;

function listItemOn(state: EditorState, line: Line): ListItem | null {
  if (line.length > LINE_WINDOW) return null;
  const match = LIST_ITEM.exec(line.text);
  if (!match) return null;
  if (typstContextAt(state, line.from + match[1].length) !== "markup") return null;
  return { line, indent: match[1], marker: match[2], gap: match[3] };
}

function columns(state: EditorState, whitespace: string): number {
  return countColumn(whitespace, state.tabSize);
}

function nextMarker(marker: string): string {
  const number = /^(\d+)\.$/u.exec(marker);
  return number ? `${Number(number[1]) + 1}.` : marker;
}

interface ContinuationPlan {
  readonly changes: ChangeSpec[];
  readonly head: number;
}

function continuationPlan(state: EditorState, pos: number): ContinuationPlan | null {
  const line = state.doc.lineAt(pos);
  const item = listItemOn(state, line);
  if (!item) return null;
  const markerEnd = line.from + item.indent.length + item.marker.length;
  const contentFrom = markerEnd + item.gap.length;
  if (contentFrom === line.to) {
    if (pos < markerEnd) return null;
    return { changes: [{ from: line.from, to: line.to }], head: line.from };
  }
  if (pos < contentFrom) return null;
  if (typstContextAt(state, pos) !== "markup") return null;
  let end = pos;
  while (end < line.to && /[ \t]/u.test(characterAt(state, end))) end += 1;
  const insert = `\n${item.indent}${nextMarker(item.marker)} `;
  return {
    changes: [{ from: pos, to: end, insert }],
    head: pos + insert.length,
  };
}

function itemTextPlan(state: EditorState, pos: number): ContinuationPlan | null {
  const line = state.doc.lineAt(pos);
  const item = listItemOn(state, line);
  if (!item) return null;
  const markerEnd = line.from + item.indent.length + item.marker.length;
  if (pos < markerEnd) return null;
  if (typstContextAt(state, pos) !== "markup") return null;
  const indent = indentString(
    state,
    columns(state, item.indent) + item.marker.length + 1,
  );
  const insert = `\n${indent}`;
  return { changes: [{ from: pos, insert }], head: pos + insert.length };
}

function runPlans(
  view: EditorView,
  plan: (state: EditorState, pos: number) => ContinuationPlan | null,
  userEvent: string,
): boolean {
  const state = view.state;
  if (state.readOnly || vimOwnsInput(view)) return false;
  if (state.selection.ranges.some((range) => !range.empty)) return false;
  const plans = state.selection.ranges.map((range) => plan(state, range.head));
  if (plans.some((entry) => entry === null)) return false;
  let index = 0;
  view.dispatch({
    ...state.changeByRange(() => {
      const entry = plans[index++]!;
      return { changes: entry.changes, range: EditorSelection.cursor(entry.head) };
    }),
    scrollIntoView: true,
    userEvent,
  });
  return true;
}

function continueTypstList(view: EditorView): boolean {
  return runPlans(view, continuationPlan, "input");
}

function continueTypstItemText(view: EditorView): boolean {
  return runPlans(view, itemTextPlan, "input");
}

function markerRemovalPlan(state: EditorState, pos: number): ContinuationPlan | null {
  const line = state.doc.lineAt(pos);
  if (pos - line.from > LINE_WINDOW) return null;
  const head = MARKER_BEFORE_CARET.exec(state.sliceDoc(line.from, pos));
  if (!head) return null;
  if (typstContextAt(state, line.from + head[1].length) !== "markup") return null;
  return {
    changes: [
      {
        from: line.from + head[1].length,
        to: pos,
        insert: " ".repeat(pos - line.from - head[1].length),
      },
    ],
    head: pos,
  };
}

function mathPairRemovalPlan(state: EditorState, pos: number): ContinuationPlan | null {
  if (emptyInlinePairAt(state, pos)) {
    return { changes: [{ from: pos - 1, to: pos + 1 }], head: pos - 1 };
  }
  if (emptyDisplayPairAt(state, pos)) {
    return { changes: [{ from: pos - 1, to: pos + 1 }], head: pos - 1 };
  }
  return null;
}

function deleteTypstListMarker(view: EditorView): boolean {
  return runPlans(view, markerRemovalPlan, "delete.backward");
}

function deleteTypstMathPair(view: EditorView): boolean {
  return runPlans(view, mathPairRemovalPlan, "delete.backward");
}

function previousNonBlankLine(state: EditorState, line: Line): Line | null {
  const stop = Math.max(1, line.number - LIST_SCAN_LINES);
  for (let number = line.number - 1; number >= stop; number -= 1) {
    const candidate = state.doc.line(number);
    if (candidate.length > LINE_WINDOW) return null;
    if (candidate.text.trim().length > 0) return candidate;
  }
  return null;
}

function deeperColumns(state: EditorState, item: ListItem): number {
  const current = columns(state, item.indent);
  const unit = indentUnitColumns(state);
  const previous = previousNonBlankLine(state, item.line);
  const sibling = previous ? listItemOn(state, previous) : null;
  if (!sibling) return current + unit;
  const siblingColumns = columns(state, sibling.indent);
  if (siblingColumns === current) return current + sibling.marker.length + 1;
  if (siblingColumns > current) return siblingColumns;
  return current + unit;
}

function shallowerColumns(state: EditorState, item: ListItem): number {
  const current = columns(state, item.indent);
  const stop = Math.max(1, item.line.number - LIST_SCAN_LINES);
  for (let number = item.line.number - 1; number >= stop; number -= 1) {
    const line = state.doc.line(number);
    if (line.length > LINE_WINDOW) break;
    if (line.text.trim().length === 0) continue;
    const parent = listItemOn(state, line);
    const lineColumns = columns(state, /^[ \t]*/u.exec(line.text)?.[0] ?? "");
    if (parent && lineColumns < current) return lineColumns;
    if (!parent && lineColumns < current) break;
  }
  return Math.max(0, current - indentUnitColumns(state));
}

function indentUnitColumns(state: EditorState): number {
  return Math.max(1, getIndentUnit(state));
}

function selectedItemLines(state: EditorState): ListItem[] | null {
  const items: ListItem[] = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from);
    let last = state.doc.lineAt(range.to);
    if (!range.empty && range.to === last.from && last.number > first.number) {
      last = state.doc.line(last.number - 1);
    }
    for (let number = first.number; number <= last.number; number += 1) {
      if (seen.has(number)) continue;
      seen.add(number);
      const item = listItemOn(state, state.doc.line(number));
      if (!item) return null;
      items.push(item);
    }
  }
  return items;
}

function reindentItems(
  view: EditorView,
  target: (state: EditorState, item: ListItem) => number,
  userEvent: string,
): boolean {
  const state = view.state;
  if (state.readOnly || vimOwnsInput(view)) return false;
  const items = selectedItemLines(state);
  if (!items || items.length === 0) return false;
  const changes: ChangeSpec[] = [];
  for (const item of items) {
    const next = target(state, item);
    if (next === columns(state, item.indent)) continue;
    changes.push({
      from: item.line.from,
      to: item.line.from + item.indent.length,
      insert: indentString(state, next),
    });
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes, scrollIntoView: true, userEvent });
  return true;
}

function indentTypstListItem(view: EditorView): boolean {
  return reindentItems(view, deeperColumns, "input.indent");
}

function outdentTypstListItem(view: EditorView): boolean {
  return reindentItems(view, shallowerColumns, "delete.dedent");
}

function typstEditingKeymap(options: TypstEditingOptions): KeyBinding[] {
  return [
    { key: "Enter", run: continueTypstList, shift: continueTypstItemText },
    {
      key: "Backspace",
      run: (view) =>
        deleteTypstListMarker(view) ||
        (options.math && deleteTypstMathPair(view)),
    },
    { key: "Tab", run: indentTypstListItem, shift: outdentTypstListItem },
  ];
}

export function typstEditing(options: TypstEditingOptions): Extension {
  const typing = options.math || options.wrap;
  return [
    trackedDollars,
    typing
      ? Prec.high(
          EditorView.inputHandler.of((view, from, to, text) => {
            if (view.composing || view.compositionStarted) return false;
            if (vimOwnsInput(view)) return false;
            const main = view.state.selection.main;
            if (from !== main.from || to !== main.to) return false;
            const spec = typstInputChange(view.state, text, options);
            if (!spec) return false;
            view.dispatch(spec);
            return true;
          }),
        )
      : [],
    keymap.of(typstEditingKeymap(options)),
  ];
}
