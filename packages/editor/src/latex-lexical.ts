import { StateField, type EditorState, type Text } from "@codemirror/state";

export type LatexIgnoredKind =
  | "comment"
  | "verbatim-environment"
  | "inline-verbatim";

export interface LatexIgnoredRange {
  from: number;
  to: number;
  kind: LatexIgnoredKind;
  complete: boolean;
}

export interface LatexInlineVerbatimSpan {
  from: number;
  to: number;
  command: "verb" | "lstinline" | "mintinline";
  complete: boolean;
}

const OPAQUE_ENVIRONMENTS = new Set([
  "verbatim",
  "verbatim*",
  "Verbatim",
  "Verbatim*",
  "lstlisting",
  "minted",
  "comment",
]);

const commandCharacter = (character: string | undefined): boolean =>
  Boolean(character && /[A-Za-z@]/u.test(character));

const inlineWhitespace = (character: string | undefined): boolean =>
  character === " " || character === "\t";

function skipInlineWhitespace(text: string, start: number): number {
  let cursor = start;
  while (inlineWhitespace(text[cursor])) cursor += 1;
  return cursor;
}

interface LexLimits {
  truncated: boolean;
}

export function latexBalancedGroupEnd(
  text: string,
  start: number,
  opening = "{",
  closing = "}",
  limits?: LexLimits,
): number | null {
  if (text[start] !== opening) return null;
  let depth = 1;
  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (text[cursor] === opening) {
      depth += 1;
    } else if (text[cursor] === closing) {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
  }
  if (limits) limits.truncated = true;
  return null;
}

function lineEnd(text: string, start: number): number {
  const newline = text.indexOf("\n", start);
  return newline < 0 ? text.length : newline;
}

function delimitedBodyEnd(
  text: string,
  start: number,
): { to: number; complete: boolean } | null {
  const delimiter = text[start];
  if (!delimiter || /\s/u.test(delimiter)) return null;
  const endOfLine = lineEnd(text, start + 1);
  const closing = text.indexOf(delimiter, start + 1);
  if (closing < 0 || closing > endOfLine) {
    return { to: endOfLine, complete: false };
  }
  return { to: closing + 1, complete: true };
}

/**
 * Reads a complete or recoverable inline-verbatim construct beginning at a
 * backslash. The returned span is same-revision source data and may safely be
 * used both to mask completion catalogs and to skip syntax linting.
 */
export function latexInlineVerbatimSpan(
  text: string,
  start: number,
  limits?: LexLimits,
): LatexInlineVerbatimSpan | null {
  const head = inlineVerbatimHead(text, start);
  if (!head) return null;
  const { command } = head;

  if (command === "verb") {
    const body = delimitedBodyEnd(text, head.cursor);
    if (!body) return null;
    return { from: start, to: body.to, command, complete: body.complete };
  }

  return listingsVerbatimSpan(text, start, head.cursor, command, limits);
}

function inlineVerbatimHead(
  text: string,
  start: number,
): { command: LatexInlineVerbatimSpan["command"]; cursor: number } | null {
  if (text[start] !== "\\") return null;
  let commandEnd = start + 1;
  while (commandCharacter(text[commandEnd])) commandEnd += 1;
  const command = text.slice(start + 1, commandEnd);
  if (
    command !== "verb" &&
    command !== "lstinline" &&
    command !== "mintinline"
  ) {
    return null;
  }
  const cursor = text[commandEnd] === "*" ? commandEnd + 1 : commandEnd;
  return { command, cursor };
}

function listingsVerbatimSpan(
  text: string,
  start: number,
  from: number,
  command: "lstinline" | "mintinline",
  limits?: LexLimits,
): LatexInlineVerbatimSpan | null {
  let cursor = skipInlineWhitespace(text, from);
  if (text[cursor] === "[") {
    const optionEnd = latexBalancedGroupEnd(text, cursor, "[", "]", limits);
    if (optionEnd === null) {
      return {
        from: start,
        to: lineEnd(text, cursor + 1),
        command,
        complete: false,
      };
    }
    cursor = skipInlineWhitespace(text, optionEnd);
  }

  if (command === "mintinline") {
    const languageEnd = latexBalancedGroupEnd(
      text,
      cursor,
      "{",
      "}",
      limits,
    );
    if (languageEnd === null) return null;
    cursor = skipInlineWhitespace(text, languageEnd);
    if (text[cursor] === "{") {
      const bodyEnd = latexBalancedGroupEnd(text, cursor, "{", "}", limits);
      return {
        from: start,
        to: bodyEnd ?? lineEnd(text, cursor + 1),
        command,
        complete: bodyEnd !== null,
      };
    }
  }

  const body = delimitedBodyEnd(text, cursor);
  if (!body) return null;
  return { from: start, to: body.to, command, complete: body.complete };
}

function simpleBracedValue(
  text: string,
  start: number,
  limits?: LexLimits,
): { value: string; to: number } | null {
  const opening = skipInlineWhitespace(text, start);
  const end = latexBalancedGroupEnd(text, opening, "{", "}", limits);
  if (end === null) return null;
  return {
    value: text.slice(opening + 1, end - 1).trim(),
    to: end,
  };
}

function verbatimEnvironmentEnd(
  text: string,
  start: number,
  name: string,
): number {
  const close = `\\end{${name}}`;
  const closing = text.indexOf(close, start);
  return closing < 0 ? text.length : closing + close.length;
}

/**
 * Produces non-overlapping ignored ranges in one forward pass. Completion,
 * local symbol indexing, and the syntax linter intentionally share this
 * lexical definition so a command cannot be hidden in one feature and active
 * in another.
 */
export function latexIgnoredRanges(text: string): LatexIgnoredRange[] {
  return lexIgnoredRanges(text, 0, true, null).ranges;
}

interface LexPass {
  ranges: LatexIgnoredRange[];
  resumedAt: number | null;
  truncated: boolean;
}

function resumesAt(
  text: string,
  base: number,
  cursor: number,
  baseStartsLine: boolean,
  resumable: ((position: number) => boolean) | null,
): boolean {
  if (!resumable) return false;
  const startsLine = cursor === 0 ? baseStartsLine : text[cursor - 1] === "\n";
  return startsLine && resumable(base + cursor);
}

function opaqueEnvironmentRange(
  text: string,
  base: number,
  cursor: number,
  commandEnd: number,
  limits: LexLimits,
): { range: LatexIgnoredRange; to: number } | null {
  const environment = simpleBracedValue(text, commandEnd, limits);
  if (!environment || !OPAQUE_ENVIRONMENTS.has(environment.value)) return null;
  const closing = `\\end{${environment.value}}`;
  const to = verbatimEnvironmentEnd(text, environment.to, environment.value);
  return {
    range: {
      from: base + cursor,
      to: base + to,
      kind: "verbatim-environment",
      complete: text.slice(to - closing.length, to) === closing,
    },
    to,
  };
}

function lexIgnoredStep(
  text: string,
  base: number,
  cursor: number,
  limits: LexLimits,
): { range: LatexIgnoredRange | null; cursor: number } {
  const character = text[cursor];
  if (character === "%") {
    const to = lineEnd(text, cursor + 1);
    return {
      range: {
        from: base + cursor,
        to: base + to,
        kind: "comment",
        complete: text[to] === "\n",
      },
      cursor: to,
    };
  }
  if (character !== "\\") return { range: null, cursor: cursor + 1 };

  const inline = latexInlineVerbatimSpan(text, cursor, limits);
  if (inline) {
    return {
      range: {
        from: base + inline.from,
        to: base + inline.to,
        kind: "inline-verbatim",
        complete: inline.complete,
      },
      cursor: Math.max(cursor + 1, inline.to),
    };
  }

  let commandEnd = cursor + 1;
  while (commandCharacter(text[commandEnd])) commandEnd += 1;
  if (text.slice(cursor + 1, commandEnd) === "begin") {
    const opaque = opaqueEnvironmentRange(
      text,
      base,
      cursor,
      commandEnd,
      limits,
    );
    if (opaque) return { range: opaque.range, cursor: opaque.to };
  }

  // Skip a control sequence/control symbol as a unit. In particular, this
  // prevents an escaped percent sign from being mistaken for a comment.
  return {
    range: null,
    cursor:
      commandEnd > cursor + 1
        ? commandEnd
        : Math.min(text.length, cursor + 2),
  };
}

function lexIgnoredRanges(
  text: string,
  base: number,
  baseStartsLine: boolean,
  resumable: ((position: number) => boolean) | null,
): LexPass {
  const ranges: LatexIgnoredRange[] = [];
  const limits: LexLimits = { truncated: false };
  let cursor = 0;

  while (cursor < text.length) {
    if (resumesAt(text, base, cursor, baseStartsLine, resumable)) {
      return { ranges, resumedAt: base + cursor, truncated: limits.truncated };
    }
    const step = lexIgnoredStep(text, base, cursor, limits);
    if (step.range) ranges.push(step.range);
    cursor = step.cursor;
  }

  return { ranges, resumedAt: null, truncated: limits.truncated };
}

export function maskLatexIgnoredRegions(
  text: string,
  ranges = latexIgnoredRanges(text),
): string {
  if (ranges.length === 0) return text;
  const characters = text.split("");
  for (const range of ranges) {
    for (let cursor = range.from; cursor < range.to; cursor += 1) {
      if (characters[cursor] !== "\n") characters[cursor] = " ";
    }
  }
  return characters.join("");
}

export function isLatexCompletionPosition(
  text: string,
  position: number,
): boolean {
  return !latexIgnoredRanges(text).some((range) =>
    positionIsIgnored(range, position),
  );
}

function positionIsIgnored(
  range: LatexIgnoredRange,
  position: number,
): boolean {
  return (
    position > range.from &&
    (position < range.to ||
      (position === range.to &&
        (range.kind === "comment" || !range.complete)))
  );
}

const documentIgnoredRanges = new WeakMap<Text, LatexIgnoredRange[]>();

const RESCAN_WINDOWS = [4 * 1024, 64 * 1024];

function restartOffset(
  previous: readonly LatexIgnoredRange[],
  doc: Text,
  earliest: number,
): number {
  let restart = doc.lineAt(Math.min(earliest, doc.length)).from;
  let index = firstRangeEndingAfter(previous, restart);
  while (index >= 0 && index < previous.length) {
    const range = previous[index];
    if (range.to < restart) break;
    if (range.to === restart && range.complete) break;
    if (range.from < restart) restart = range.from;
    index -= 1;
  }
  return restart;
}

export const latexIgnoredRangesField = StateField.define<LatexIgnoredRange[]>({
  create: (state) => latexIgnoredRanges(state.doc.toString()),
  update: (previous, transaction) => {
    if (!transaction.docChanged) return previous;
    let earliest = Number.POSITIVE_INFINITY;
    let latest = -1;
    transaction.changes.iterChangedRanges((fromA, toA) => {
      if (fromA < earliest) earliest = fromA;
      if (toA > latest) latest = toA;
    });
    if (!Number.isFinite(earliest)) return previous;

    const startDoc = transaction.startState.doc;
    const newDoc = transaction.newDoc;
    const restart = restartOffset(previous, startDoc, earliest);
    const delta = newDoc.length - startDoc.length;
    const keepCount = firstRangeEndingAfter(previous, restart + 1);
    const startsLine = newDoc.lineAt(restart).from === restart;

    let probe = 0;
    const resumable = (position: number): boolean => {
      const before = position - delta;
      if (before < latest || before > startDoc.length) return false;
      if (before === latest && startDoc.lineAt(before).from !== before) {
        return false;
      }
      while (probe < previous.length && previous[probe].to <= before) {
        probe += 1;
      }
      const range = previous[probe];
      return !range || range.from >= before;
    };

    const merge = (pass: LexPass): LatexIgnoredRange[] => {
      const merged = previous.slice(0, keepCount);
      for (const range of pass.ranges) merged.push(range);
      if (pass.resumedAt === null) return merged;
      const resume = pass.resumedAt - delta;
      for (
        let index = firstRangeStartingAtOrAfter(previous, resume);
        index < previous.length;
        index += 1
      ) {
        const range = previous[index];
        merged.push({
          ...range,
          from: range.from + delta,
          to: range.to + delta,
        });
      }
      return merged;
    };

    for (const window of RESCAN_WINDOWS) {
      if (restart + window >= newDoc.length) break;
      probe = firstRangeEndingAfter(previous, latest);
      const pass = lexIgnoredRanges(
        newDoc.sliceString(restart, restart + window),
        restart,
        startsLine,
        resumable,
      );
      if (pass.resumedAt !== null && !pass.truncated) return merge(pass);
    }

    probe = firstRangeEndingAfter(previous, latest);
    return merge(
      lexIgnoredRanges(
        newDoc.sliceString(restart),
        restart,
        startsLine,
        resumable,
      ),
    );
  },
});

export function latexIgnoredRangesIn(
  state: EditorState,
): LatexIgnoredRange[] {
  const tracked = state.field(latexIgnoredRangesField, false);
  if (tracked) return tracked;
  const cached = documentIgnoredRanges.get(state.doc);
  if (cached) return cached;
  const computed = latexIgnoredRanges(state.doc.toString());
  documentIgnoredRanges.set(state.doc, computed);
  return computed;
}

function firstRangeEndingAfter(
  ranges: readonly LatexIgnoredRange[],
  position: number,
): number {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ranges[middle].to < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

function firstRangeStartingAtOrAfter(
  ranges: readonly LatexIgnoredRange[],
  position: number,
): number {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ranges[middle].from < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function inLatexIgnoredRegion(
  state: EditorState,
  position: number,
): boolean {
  const ranges = latexIgnoredRangesIn(state);
  for (
    let index = firstRangeEndingAfter(ranges, position);
    index < ranges.length;
    index += 1
  ) {
    const range = ranges[index];
    if (range.from >= position) return false;
    if (positionIsIgnored(range, position)) return true;
  }
  return false;
}

export function latexMaskedSlice(
  state: EditorState,
  from: number,
  to: number,
): string {
  const text = state.sliceDoc(from, to);
  const ranges = latexIgnoredRangesIn(state);
  let characters: string[] | null = null;
  for (
    let index = firstRangeEndingAfter(ranges, from + 1);
    index < ranges.length;
    index += 1
  ) {
    const range = ranges[index];
    if (range.from >= to) break;
    characters ??= text.split("");
    const start = Math.max(range.from, from);
    const end = Math.min(range.to, to);
    for (let at = start; at < end; at += 1) {
      if (characters[at - from] !== "\n") characters[at - from] = " ";
    }
  }
  return characters ? characters.join("") : text;
}

export type LatexMathDelimiter = "$" | "\\(" | "\\[" | "env";

export interface LatexMathContext {
  inMath: boolean;
  delimiter: LatexMathDelimiter | null;
  from: number | null;
  width: number;
}

type MathToken = LatexMathDelimiter | "$$";

interface OpenMath {
  token: MathToken;
  at: number;
  width: number;
}

const MATH_CONTEXT_WINDOW = 2 * 1024;

const MATH_ENVIRONMENTS = new Set([
  "equation",
  "equation*",
  "displaymath",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "flalign",
  "flalign*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
  "math",
  "split",
  "aligned",
  "gathered",
  "cases",
  "array",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
]);

function openMathTokens(text: string): OpenMath[] {
  const stack: OpenMath[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const character = text[cursor];

    if (character === "\\") {
      const next = text[cursor + 1];
      if (next === "(" || next === "[") {
        stack.push({
          token: next === "(" ? "\\(" : "\\[",
          at: cursor,
          width: 2,
        });
        cursor += 2;
        continue;
      }
      if (next === ")" || next === "]") {
        const opener = next === ")" ? String.raw`\(` : String.raw`\[`;
        if (stack.at(-1)?.token === opener) stack.pop();
        cursor += 2;
        continue;
      }
      if (commandCharacter(next)) {
        let commandEnd = cursor + 1;
        while (commandCharacter(text[commandEnd])) commandEnd += 1;
        const command = text.slice(cursor + 1, commandEnd);
        if (command === "begin" || command === "end") {
          const environment = simpleBracedValue(text, commandEnd);
          if (environment && MATH_ENVIRONMENTS.has(environment.value)) {
            if (command === "begin") {
              stack.push({
                token: "env",
                at: cursor,
                width: environment.to - cursor,
              });
            } else if (stack.at(-1)?.token === "env") {
              stack.pop();
            }
            cursor = environment.to;
            continue;
          }
        }
        cursor = commandEnd;
        continue;
      }
      cursor += 2;
      continue;
    }

    if (character === "$") {
      const doubled = text[cursor + 1] === "$";
      const open = stack.at(-1);
      if (open && (open.token === "$" || open.token === "$$")) {
        stack.pop();
        cursor += open.token === "$$" && doubled ? 2 : 1;
        continue;
      }
      const token: MathToken = doubled ? "$$" : "$";
      stack.push({ token, at: cursor, width: token.length });
      cursor += token.length;
      continue;
    }

    if (character === "\n") {
      let scan = cursor + 1;
      while (inlineWhitespace(text[scan])) scan += 1;
      if (scan >= text.length || text[scan] === "\n") stack.length = 0;
      cursor += 1;
      continue;
    }

    cursor += 1;
  }

  return stack;
}

export function mathContextAt(
  state: EditorState,
  pos: number,
): LatexMathContext {
  const from = Math.max(0, pos - MATH_CONTEXT_WINDOW);
  const stack = openMathTokens(latexMaskedSlice(state, from, pos));
  const open = stack.at(-1);
  if (!open) return { inMath: false, delimiter: null, from: null, width: 0 };
  return {
    inMath: true,
    delimiter: open.token === "$$" ? "$" : open.token,
    from: open.at + from,
    width: open.width,
  };
}
