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

export function latexBalancedGroupEnd(
  text: string,
  start: number,
  opening = "{",
  closing = "}",
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
): LatexInlineVerbatimSpan | null {
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

  let cursor = commandEnd;
  if (text[cursor] === "*") cursor += 1;

  if (command === "verb") {
    const body = delimitedBodyEnd(text, cursor);
    if (!body) return null;
    return { from: start, to: body.to, command, complete: body.complete };
  }

  cursor = skipInlineWhitespace(text, cursor);
  if (text[cursor] === "[") {
    const optionEnd = latexBalancedGroupEnd(text, cursor, "[", "]");
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
    const languageEnd = latexBalancedGroupEnd(text, cursor);
    if (languageEnd === null) return null;
    cursor = skipInlineWhitespace(text, languageEnd);
    if (text[cursor] === "{") {
      const bodyEnd = latexBalancedGroupEnd(text, cursor);
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
): { value: string; to: number } | null {
  const opening = skipInlineWhitespace(text, start);
  const end = latexBalancedGroupEnd(text, opening);
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
  const ranges: LatexIgnoredRange[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const character = text[cursor];
    if (character === "%") {
      const to = lineEnd(text, cursor + 1);
      ranges.push({
        from: cursor,
        to,
        kind: "comment",
        complete: text[to] === "\n",
      });
      cursor = to;
      continue;
    }
    if (character !== "\\") {
      cursor += 1;
      continue;
    }

    const inline = latexInlineVerbatimSpan(text, cursor);
    if (inline) {
      ranges.push({
        from: inline.from,
        to: inline.to,
        kind: "inline-verbatim",
        complete: inline.complete,
      });
      cursor = Math.max(cursor + 1, inline.to);
      continue;
    }

    let commandEnd = cursor + 1;
    while (commandCharacter(text[commandEnd])) commandEnd += 1;
    const command = text.slice(cursor + 1, commandEnd);
    if (command === "begin") {
      const environment = simpleBracedValue(text, commandEnd);
      if (
        environment &&
        OPAQUE_ENVIRONMENTS.has(environment.value)
      ) {
        const closing = `\\end{${environment.value}}`;
        const to = verbatimEnvironmentEnd(
          text,
          environment.to,
          environment.value,
        );
        ranges.push({
          from: cursor,
          to,
          kind: "verbatim-environment",
          complete: text.slice(to - closing.length, to) === closing,
        });
        cursor = to;
        continue;
      }
    }

    // Skip a control sequence/control symbol as a unit. In particular, this
    // prevents an escaped percent sign from being mistaken for a comment.
    cursor =
      commandEnd > cursor + 1
        ? commandEnd
        : Math.min(text.length, cursor + 2);
  }

  return ranges;
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
  return !latexIgnoredRanges(text).some(
    (range) =>
      position > range.from &&
      (position < range.to ||
        position === range.to &&
          (range.kind === "comment" || !range.complete)),
  );
}
