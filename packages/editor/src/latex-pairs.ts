import { getIndentUnit, indentString } from "@codemirror/language";
import {
  CharCategory,
  countColumn,
  EditorSelection,
  Prec,
  type EditorState,
  type Extension,
  type SelectionRange,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, type KeyBinding } from "@codemirror/view";
import {
  latexDelimiterCloserAt,
  latexDelimiterClosing,
  latexDelimiterGlyphForClosingTrigger,
  latexDelimiterGlyphForTrigger,
  latexDelimiterPrefixBefore,
  latexEmptyDelimiterPairAt,
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
}

const RUN_LIMIT = 64;

const LINE_WINDOW = 2 * 1024;

const MATH_PAIRS: readonly (readonly [string, string])[] = [
  ["$$", "$$"],
  ["$", "$"],
  [String.raw`\(`, String.raw`\)`],
  [String.raw`\[`, String.raw`\]`],
];

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

/**
 * Pairs a delimiter the user opened with a size command: typing `(` right
 * after `\left` closes it with `\right)`. `\middle` and the `m` separators
 * are recognised but deliberately left unpaired, and so is a closing size
 * command, which already is the partner of something.
 */
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
  if (prefix.role !== "open") {
    return range.empty ? plainInsert(range, text) : null;
  }
  const closing = latexDelimiterClosing(prefix.size, glyph);
  if (!range.empty) return wrapSelection(range, text, closing);
  return {
    changes: [{ from: pos, insert: `${text}${closing}` }],
    range: EditorSelection.cursor(pos + text.length),
  };
}

/**
 * Steps the caret over a closer the editor inserted instead of writing a
 * second one. A caret sitting just after a closing size command is skipped:
 * there the user is spelling out their own `\right)` and means the glyph.
 */
function semanticOvertypeForRange(
  state: EditorState,
  range: SelectionRange,
  text: string,
): RangeChange | null {
  if (!range.empty) return null;
  const pos = range.head;
  if (inLatexIgnoredRegion(state, pos) || escapedAt(state, pos)) return null;
  const glyph = latexDelimiterGlyphForClosingTrigger(text);
  if (!glyph) return null;
  const before = sliceBefore(state, pos);
  if (latexDelimiterPrefixBefore(before)) return null;
  const length = latexDelimiterCloserAt(sliceAfter(state, pos), glyph);
  if (length === null) return null;
  return { changes: [], range: EditorSelection.cursor(pos + length) };
}

function semanticDelimiterChange(
  state: EditorState,
  text: string,
): TransactionSpec | null {
  const plans = state.selection.ranges.map(
    (range) =>
      semanticOvertypeForRange(state, range, text) ??
      semanticPairForRange(state, range, text),
  );
  if (plans.includes(null)) return null;
  let index = 0;
  return {
    ...state.changeByRange(() => plans[index++]!),
    userEvent: "input.type",
    scrollIntoView: true,
  };
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
  return Prec.high(
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
  );
}

function emptyPairAt(
  state: EditorState,
  pos: number,
): { open: number; close: number } | null {
  for (const [open, close] of MATH_PAIRS) {
    if (
      state.sliceDoc(pos - open.length, pos) === open &&
      state.sliceDoc(pos, pos + close.length) === close
    ) {
      return { open: open.length, close: close.length };
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
  const pairs = state.selection.ranges.map((range) =>
    range.empty ? emptyPairAt(state, range.head) : null,
  );
  if (pairs.includes(null)) return false;
  let index = 0;
  const spec = state.changeByRange((range) => {
    const pair = pairs[index++]!;
    return {
      changes: [
        { from: range.head - pair.open, to: range.head + pair.close },
      ],
      range: EditorSelection.cursor(range.head - pair.open),
    };
  });
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
