import { pickedCompletion, type Completion } from "@codemirror/autocomplete";
import { getIndentUnit, indentString } from "@codemirror/language";
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
  type EditorState,
  type Extension,
  type SelectionRange,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, type KeyBinding } from "@codemirror/view";
import {
  latexDelimiterClosesAhead,
  latexDelimiterCloserConsumption,
  latexDelimiterCloserFor,
  latexDelimiterCloserText,
  latexDelimiterGlyphForTrigger,
  latexDelimiterPrefixBefore,
  latexDelimiterTakesPartner,
  latexEmptyDelimiterPairAt,
  type LatexDelimiterCloser,
  type LatexDelimiterCompletionSpec,
} from "./latex-delimiters";
import { inLatexIgnoredRegion, mathContextAt } from "./latex-lexical";
import { vimOwnsInput } from "./latex-structure-commands";

export interface LatexPairOptions {
  math: boolean;
  brackets: boolean;
}

interface RangeChange {
  changes: { from: number; to?: number; insert?: string }[];
  range: SelectionRange;
  effects?: StateEffect<unknown>;
}

type CompletionApply = (
  view: EditorView,
  completion: Completion,
  from: number,
  to: number,
) => void;

const RUN_LIMIT = 64;

const LINE_WINDOW = 2 * 1024;

const MATH_PAIRS: readonly (readonly [string, string])[] = [
  ["$$", "$$"],
  ["$", "$"],
  [String.raw`\(`, String.raw`\)`],
  [String.raw`\[`, String.raw`\]`],
];

const SEMANTIC_TRIGGERS: ReadonlySet<string> = new Set(["(", "[", "{", "<", "|"]);

class TrackedPair extends RangeValue {
  constructor(
    readonly opener: string,
    readonly closer: LatexDelimiterCloser,
  ) {
    super();
  }

  override eq(other: RangeValue): boolean {
    return (
      other instanceof TrackedPair &&
      other.opener === this.opener &&
      sameCloser(other.closer, this.closer)
    );
  }
}

TrackedPair.prototype.startSide = 1;
TrackedPair.prototype.endSide = -1;

interface TrackedPairInsertion {
  readonly from: number;
  readonly to: number;
  readonly opener: string;
  readonly closer: LatexDelimiterCloser;
}

const trackPair = StateEffect.define<TrackedPairInsertion>({
  map(value, mapping) {
    const from = mapping.mapPos(value.from, 1, MapMode.TrackDel);
    const to = mapping.mapPos(value.to, -1, MapMode.TrackDel);
    return from === null || to === null || from >= to
      ? undefined
      : { ...value, from, to };
  },
});

const trackedPairs = StateField.define<RangeSet<TrackedPair>>({
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
      if (!effect.is(trackPair)) continue;
      const { from, to, opener, closer } = effect.value;
      next = next.update({
        add: [new TrackedPair(opener, closer).range(from, to)],
      });
    }
    return next;
  },
});

interface PendingCloser {
  readonly closer: LatexDelimiterCloser;
  readonly bodyFrom: number;
}

function sameCloser(
  a: LatexDelimiterCloser | null,
  b: LatexDelimiterCloser,
): boolean {
  return a !== null && a.command === b.command && a.glyph === b.glyph;
}

function hasTrackedPairs(state: EditorState): boolean {
  return (state.field(trackedPairs, false)?.size ?? 0) > 0;
}

function pendingCloserAt(
  state: EditorState,
  pos: number,
): PendingCloser | null {
  const set = state.field(trackedPairs, false);
  if (!set || set.size === 0) return null;
  let found: PendingCloser | null = null;
  set.between(pos, pos, (from, to, value) => {
    const closing = latexDelimiterCloserText(value.closer);
    if (to - closing.length !== pos) return;
    if (state.sliceDoc(pos, to) !== closing) return;
    const bodyFrom = from + value.opener.length;
    if (state.sliceDoc(from, bodyFrom) !== value.opener) return;
    found = { closer: value.closer, bodyFrom };
    return false;
  });
  return found;
}

function escapedAt(state: EditorState, pos: number): boolean {
  const from = Math.max(0, pos - RUN_LIMIT);
  const before = state.sliceDoc(from, pos);
  let backslashes = 0;
  while (
    backslashes < before.length &&
    before[before.length - 1 - backslashes] === "\\"
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function characterAt(state: EditorState, pos: number): string {
  if (pos < 0 || pos >= state.doc.length) return "";
  return state.sliceDoc(pos, pos + 1);
}

function isWordCharacter(
  state: EditorState,
  pos: number,
  character: string,
): boolean {
  return (
    character.length > 0 &&
    state.charCategorizer(pos)(character) === CharCategory.Word
  );
}

function gluedToContent(state: EditorState, pos: number): boolean {
  const after = characterAt(state, pos);
  if (isWordCharacter(state, pos, after)) return true;
  if (after !== "\\") return false;
  return (
    isWordCharacter(state, pos, characterAt(state, pos + 1)) &&
    !latexDelimiterClosesAhead(sliceAfter(state, pos))
  );
}

function dollarRunBefore(state: EditorState, pos: number): number {
  const text = state.sliceDoc(Math.max(0, pos - RUN_LIMIT), pos);
  let run = 0;
  while (run < text.length && text[text.length - 1 - run] === "$") run += 1;
  return run;
}

function dollarRunAfter(state: EditorState, pos: number): number {
  const text = state.sliceDoc(
    pos,
    Math.min(state.doc.length, pos + RUN_LIMIT),
  );
  let run = 0;
  while (run < text.length && text[run] === "$") run += 1;
  return run;
}

function lineIsBlankAround(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  const head = state.sliceDoc(Math.max(line.from, pos - LINE_WINDOW), pos - 1);
  const tail = state.sliceDoc(
    pos + 1,
    Math.min(line.to, pos + LINE_WINDOW),
  );
  return head.trim().length === 0 && tail.trim().length === 0;
}

function lineIndentColumns(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos);
  const head = state.sliceDoc(
    line.from,
    Math.min(line.to, line.from + LINE_WINDOW),
  );
  return countColumn(/^\s*/u.exec(head)?.[0] ?? "", state.tabSize);
}

function plainInsert(range: SelectionRange, text: string): RangeChange {
  return {
    changes: [{ from: range.from, to: range.to, insert: text }],
    range: EditorSelection.cursor(range.from + text.length),
  };
}

function wrapSelection(
  range: SelectionRange,
  open: string,
  close: string,
): RangeChange {
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

function promoteToDisplayMath(
  state: EditorState,
  pos: number,
): RangeChange {
  const ownLine = lineIsBlankAround(state, pos);
  const insert = ownLine ? "$\n\n$" : "$$";
  return {
    changes: [{ from: pos, insert }],
    range: EditorSelection.cursor(pos + (ownLine ? 2 : 1)),
  };
}

function dollarForRange(
  state: EditorState,
  range: SelectionRange,
): RangeChange {
  if (!range.empty) {
    if (inLatexIgnoredRegion(state, range.from)) return plainInsert(range, "$");
    return wrapSelection(range, "$", "$");
  }

  const pos = range.head;
  if (inLatexIgnoredRegion(state, pos) || escapedAt(state, pos)) {
    return plainInsert(range, "$");
  }

  const before = characterAt(state, pos - 1);
  const after = characterAt(state, pos);
  const runBefore = dollarRunBefore(state, pos);
  const runAfter = dollarRunAfter(state, pos);
  const math = mathContextAt(state, pos);
  const inlineMath = math.inMath && math.delimiter === "$";

  if (
    inlineMath &&
    math.width === 1 &&
    math.from === pos - 1 &&
    runAfter === 1
  ) {
    return promoteToDisplayMath(state, pos);
  }

  if (inlineMath && after === "$") {
    return { changes: [], range: EditorSelection.cursor(pos + 1) };
  }

  if (
    runBefore > 0 ||
    runAfter > 0 ||
    math.inMath ||
    (after === "\\" &&
      isWordCharacter(state, pos, characterAt(state, pos + 1))) ||
    isWordCharacter(state, pos, before) ||
    isWordCharacter(state, pos, after)
  ) {
    return plainInsert(range, "$");
  }

  return {
    changes: [{ from: pos, insert: "$$" }],
    range: EditorSelection.cursor(pos + 1),
  };
}

function dollarChange(state: EditorState): TransactionSpec {
  return {
    ...state.changeByRange((range) => dollarForRange(state, range)),
    userEvent: "input.type",
    scrollIntoView: true,
  };
}

function afterCommandBackslash(
  state: EditorState,
  range: SelectionRange,
): boolean {
  return (
    range.empty &&
    escapedAt(state, range.head) &&
    !inLatexIgnoredRegion(state, range.head)
  );
}

function inlineDelimiterChange(range: SelectionRange): RangeChange {
  const pos = range.head;
  return {
    changes: [{ from: pos, insert: String.raw`(\)` }],
    range: EditorSelection.cursor(pos + 1),
  };
}

function displayDelimiterChange(
  state: EditorState,
  range: SelectionRange,
): RangeChange {
  const pos = range.head;
  const columns = lineIndentColumns(state, pos);
  const inner = indentString(state, columns + getIndentUnit(state));
  const outer = indentString(state, columns);
  return {
    changes: [{ from: pos, insert: `[\n${inner}\n${outer}\\]` }],
    range: EditorSelection.cursor(pos + 2 + inner.length),
  };
}

function mathDelimiterChange(
  state: EditorState,
  opening: "(" | "[",
): TransactionSpec | null {
  if (
    !state.selection.ranges.every((range) =>
      afterCommandBackslash(state, range),
    )
  ) {
    return null;
  }
  return {
    ...state.changeByRange((range) =>
      opening === "("
        ? inlineDelimiterChange(range)
        : displayDelimiterChange(state, range),
    ),
    userEvent: "input.type",
    scrollIntoView: true,
  };
}

function escapedBraceChange(state: EditorState): TransactionSpec | null {
  if (
    !state.selection.ranges.every((range) =>
      afterCommandBackslash(state, range),
    )
  ) {
    return null;
  }
  return {
    ...state.changeByRange((range) => plainInsert(range, "{")),
    userEvent: "input.type",
    scrollIntoView: true,
  };
}

function sliceBefore(state: EditorState, pos: number): string {
  return state.sliceDoc(Math.max(0, pos - RUN_LIMIT), pos);
}

function sliceAfter(state: EditorState, pos: number): string {
  return state.sliceDoc(pos, Math.min(state.doc.length, pos + RUN_LIMIT));
}

function semanticPairForRange(
  state: EditorState,
  range: SelectionRange,
  text: string,
): RangeChange | null {
  const pos = range.from;
  if (inLatexIgnoredRegion(state, pos)) return null;
  const prefix = latexDelimiterPrefixBefore(sliceBefore(state, pos));
  if (!prefix) return null;
  const glyph = latexDelimiterGlyphForTrigger(text, prefix.escapedSlash);
  if (!glyph) return null;
  if (prefix.role !== "open" || !latexDelimiterTakesPartner(prefix.size, glyph)) {
    return range.empty ? plainInsert(range, text) : null;
  }
  const closer = latexDelimiterCloserFor(prefix.size, glyph);
  const closing = latexDelimiterCloserText(closer);
  const opener = `${state.sliceDoc(pos - prefix.length, pos)}${text}`;
  const from = pos - prefix.length;
  if (!range.empty) {
    return {
      ...wrapSelection(range, text, closing),
      effects: trackPair.of({
        from,
        to: range.to + text.length + closing.length,
        opener,
        closer,
      }),
    };
  }
  if (gluedToContent(state, pos)) return plainInsert(range, text);
  return {
    changes: [{ from: pos, insert: `${text}${closing}` }],
    range: EditorSelection.cursor(pos + text.length),
    effects: trackPair.of({
      from,
      to: pos + text.length + closing.length,
      opener,
      closer,
    }),
  };
}

function semanticOvertypeForRange(
  state: EditorState,
  range: SelectionRange,
  text: string,
): RangeChange | null {
  if (!range.empty) return null;
  const pos = range.head;
  const pending = pendingCloserAt(state, pos);
  if (!pending) return null;
  const closing = latexDelimiterCloserText(pending.closer);
  if (!closing.endsWith(text)) return null;
  const consumed = latexDelimiterCloserConsumption(
    state.sliceDoc(pending.bodyFrom, pos),
    text,
    pending.closer,
  );
  if (consumed === null) return null;
  return {
    changes: [{ from: pos - consumed, to: pos + closing.length, insert: closing }],
    range: EditorSelection.cursor(pos - consumed + closing.length),
  };
}

function semanticDelimiterChange(
  state: EditorState,
  text: string,
): TransactionSpec | null {
  if (text.length !== 1) return null;
  const trigger = SEMANTIC_TRIGGERS.has(text);
  const tracked = hasTrackedPairs(state);
  if (!trigger && !tracked) return null;
  let declined = false;
  const spec = state.changeByRange((range) => {
    const plan =
      (tracked ? semanticOvertypeForRange(state, range, text) : null) ??
      (trigger ? semanticPairForRange(state, range, text) : null);
    if (plan) return plan;
    declined = true;
    return { range };
  });
  if (declined) return null;
  return { ...spec, userEvent: "input.type", scrollIntoView: true };
}

export function latexPairChange(
  state: EditorState,
  text: string,
  options: LatexPairOptions,
): TransactionSpec | null {
  if (state.readOnly) return null;
  if (options.math && text === "$") return dollarChange(state);
  if (options.math) {
    const semantic = semanticDelimiterChange(state, text);
    if (semantic) return semantic;
  }
  if (options.math && (text === "(" || text === "[")) {
    return mathDelimiterChange(state, text);
  }
  if (options.brackets && text === "{") return escapedBraceChange(state);
  return null;
}

export function latexPairInputHandler(options: LatexPairOptions): Extension {
  if (!options.math && !options.brackets) return [];
  return [
    options.math ? trackedPairs : [],
    Prec.high(
      EditorView.inputHandler.of((view, from, to, text) => {
        if (view.composing || view.compositionStarted) return false;
        if (vimOwnsInput(view)) return false;
        const main = view.state.selection.main;
        if (from !== main.from || to !== main.to) return false;
        const spec = latexPairChange(view.state, text, options);
        if (!spec) return false;
        view.dispatch(spec);
        return true;
      }),
    ),
  ];
}

export function latexDelimiterCompletionApply(
  spec: LatexDelimiterCompletionSpec,
): CompletionApply {
  return (view, completion, from, to) => {
    const head = from + spec.label.length;
    if (spec.kind === "pair") {
      const closing = latexDelimiterCloserText(spec.closer);
      view.dispatch({
        changes: { from, to, insert: `${spec.label}${closing}` },
        selection: EditorSelection.cursor(head),
        effects: trackPair.of({
          from,
          to: head + closing.length,
          opener: spec.label,
          closer: spec.closer,
        }),
        annotations: pickedCompletion.of(completion),
        userEvent: "input.complete",
      });
      return;
    }
    const pending = pendingCloserAt(view.state, to);
    const duplicate =
      spec.kind === "closer" && pending && sameCloser(pending.closer, spec.closer)
        ? spec.label.length
        : 0;
    view.dispatch({
      changes: { from, to: to + duplicate, insert: spec.label },
      selection: EditorSelection.cursor(head),
      annotations: pickedCompletion.of(completion),
      userEvent: "input.complete",
    });
  };
}

function emptyPairAt(
  state: EditorState,
  pos: number,
): { opener: number; closer: number } | null {
  for (const [open, close] of MATH_PAIRS) {
    if (
      state.sliceDoc(pos - open.length, pos) === open &&
      state.sliceDoc(pos, pos + close.length) === close
    ) {
      return { opener: open.length, closer: close.length };
    }
  }
  return latexEmptyDelimiterPairAt(
    sliceBefore(state, pos),
    sliceAfter(state, pos),
  );
}

function deleteMathPairBackward(view: EditorView): boolean {
  const state = view.state;
  if (state.readOnly || vimOwnsInput(view)) return false;
  let declined = false;
  const spec = state.changeByRange((range) => {
    const pair = range.empty ? emptyPairAt(state, range.head) : null;
    if (!pair) {
      declined = true;
      return { range };
    }
    return {
      changes: [
        { from: range.head - pair.opener, to: range.head + pair.closer },
      ],
      range: EditorSelection.cursor(range.head - pair.opener),
    };
  });
  if (declined) return false;
  view.dispatch({
    ...spec,
    userEvent: "delete.backward",
    scrollIntoView: true,
  });
  return true;
}

export const latexPairKeymap: KeyBinding[] = [
  { key: "Backspace", run: deleteMathPairBackward },
];
