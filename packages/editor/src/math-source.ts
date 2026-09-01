export type MathSourceFormat = "latex" | "markdown";
export type MathDelimiter = "$" | "$$" | "\\(" | "\\[";
export type MathExpressionStatus = "complete" | "incomplete";

export interface MathExpression {
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
  source: string;
  body: string;
  display: boolean;
  delimiter: MathDelimiter;
  status: MathExpressionStatus;
}

export interface MathScanOptions {
  format: MathSourceFormat;
  from?: number;
  to?: number;
  excluded?: readonly { from: number; to: number }[];
}

const MAX_SCANNED_EXPRESSIONS = 10_000;

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

function startsAtLinePrefix(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return /^[ \t]{0,3}$/u.test(text.slice(lineStart, index));
}

function fenceAt(
  text: string,
  index: number,
): { char: string; length: number } | null {
  if (!startsAtLinePrefix(text, index)) return null;
  const match = /^(`{3,}|~{3,})/u.exec(text.slice(index));
  return match ? { char: match[1][0], length: match[1].length } : null;
}

function afterMarkdownFence(
  text: string,
  index: number,
  limit: number,
  fence: { char: string; length: number },
): number {
  let cursor = text.indexOf("\n", index + fence.length);
  if (cursor < 0 || cursor >= limit) return limit;
  cursor++;
  while (cursor < limit) {
    const lineEnd = text.indexOf("\n", cursor);
    const end = lineEnd < 0 || lineEnd > limit ? limit : lineEnd;
    const line = text.slice(cursor, end);
    const match = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line);
    if (
      match &&
      match[1][0] === fence.char &&
      match[1].length >= fence.length
    ) {
      return end < limit ? end + 1 : end;
    }
    if (end >= limit) break;
    cursor = end + 1;
  }
  return limit;
}

function afterInlineCode(text: string, index: number, limit: number): number {
  let run = 1;
  while (text[index + run] === "`") run++;
  const marker = "`".repeat(run);
  const close = text.indexOf(marker, index + run);
  if (close < 0 || close >= limit) {
    const lineEnd = text.indexOf("\n", index + run);
    return lineEnd < 0 || lineEnd > limit ? limit : lineEnd;
  }
  return close + run;
}

function afterMarkdownLinkDestination(
  text: string,
  openingParen: number,
  limit: number,
): number {
  let depth = 1;
  for (let cursor = openingParen + 1; cursor < limit; cursor++) {
    const char = text[cursor];
    if (char === "\n") return cursor;
    if (isEscaped(text, cursor)) continue;
    if (char === "(") depth++;
    if (char === ")" && --depth === 0) return cursor + 1;
  }
  return limit;
}

function afterMarkdownTag(text: string, index: number, limit: number): number {
  const close = text.indexOf(">", index + 1);
  const lineEnd = text.indexOf("\n", index + 1);
  if (close < 0 || close >= limit || (lineEnd >= 0 && lineEnd < close)) {
    return index + 1;
  }
  return close + 1;
}

function afterPlainUrl(text: string, index: number, limit: number): number | null {
  if (!/[hHwW]/u.test(text[index] ?? "")) return null;
  const match = /^(?:https?:\/\/|www\.)[^\s<>()]+/iu.exec(text.slice(index, limit));
  return match ? index + match[0].length : null;
}

function afterLatexVerb(
  text: string,
  index: number,
  limit: number,
): number | null {
  const match = /^\\verb\*?/u.exec(text.slice(index));
  if (!match || isEscaped(text, index)) return null;
  const delimiterIndex = index + match[0].length;
  const delimiter = text[delimiterIndex];
  if (!delimiter || /\s/u.test(delimiter)) return null;
  const close = text.indexOf(delimiter, delimiterIndex + 1);
  return close < 0 || close >= limit ? limit : close + 1;
}

function afterLatexVerbatim(
  text: string,
  index: number,
  limit: number,
): number | null {
  const match =
    /^\\begin\{(verbatim\*?|Verbatim|lstlisting|minted)\}/u.exec(
      text.slice(index),
    );
  if (!match || isEscaped(text, index)) return null;
  const environment = match[1];
  const close = text.indexOf(
    `\\end{${environment}}`,
    index + match[0].length,
  );
  return close < 0 || close >= limit
    ? limit
    : close + `\\end{${environment}}`.length;
}

function normalizeExcluded(
  excluded: readonly { from: number; to: number }[],
  from: number,
  to: number,
): Array<{ from: number; to: number }> {
  return excluded
    .filter((range) => range.to > from && range.from < to)
    .map((range) => ({
      from: Math.max(from, range.from),
      to: Math.min(to, range.to),
    }))
    .sort((left, right) => left.from - right.from || left.to - right.to);
}

function markdownDollarCanOpen(text: string, index: number): boolean {
  const next = text[index + 1];
  return !!next && next !== "$" && !/\s/u.test(next);
}

function markdownDollarCanClose(text: string, index: number): boolean {
  const previous = text[index - 1];
  const next = text[index + 1];
  return !!previous && !/\s/u.test(previous) && !(next && /\d/u.test(next));
}

function isInLatexComment(
  text: string,
  index: number,
  lowerBound: number,
): boolean {
  const lineStart = Math.max(
    lowerBound,
    text.lastIndexOf("\n", index - 1) + 1,
  );
  for (let cursor = lineStart; cursor < index; cursor++) {
    if (text[cursor] === "%" && !isEscaped(text, cursor)) return true;
  }
  return false;
}

function findClosingDelimiter(
  text: string,
  start: number,
  limit: number,
  delimiter: MathDelimiter,
  format: MathSourceFormat,
  excluded: readonly { from: number; to: number }[],
): number {
  const close =
    delimiter === "\\(" ? "\\)" : delimiter === "\\[" ? "\\]" : delimiter;
  let cursor = start;
  while (cursor < limit) {
    const found = text.indexOf(close, cursor);
    if (found < 0 || found >= limit) return -1;
    const protectedDelimiter = excluded.some(
      (range) => range.from <= found && range.to > found,
    );
    if (
      !protectedDelimiter &&
      !isEscaped(text, found) &&
      (format !== "latex" || !isInLatexComment(text, found, start))
    ) {
      if (close === "$") {
        if (
          text[found - 1] !== "$" &&
          text[found + 1] !== "$" &&
          (format !== "markdown" || markdownDollarCanClose(text, found))
        ) {
          return found;
        }
      } else if (close === "$$") {
        if (text[found - 1] !== "$" && text[found + 2] !== "$") return found;
      } else {
        return found;
      }
    }
    cursor = found + Math.max(1, close.length);
  }
  return -1;
}

function incompleteEnd(text: string, bodyFrom: number, limit: number): number {
  const lineEnd = text.indexOf("\n", bodyFrom);
  return lineEnd < 0 || lineEnd > limit ? limit : lineEnd;
}

/**
 * Recognizes math without changing the input. The returned ranges always point
 * into the exact source string. Escaped delimiters, Markdown code/fences and
 * comments, plus LaTeX comments/verbatim regions are ignored.
 */
export function scanMathExpressions(
  text: string,
  options: MathScanOptions,
): MathExpression[] {
  const from = Math.max(0, Math.min(options.from ?? 0, text.length));
  const to = Math.max(from, Math.min(options.to ?? text.length, text.length));
  const excluded = normalizeExcluded(options.excluded ?? [], from, to);
  const expressions: MathExpression[] = [];
  let excludedIndex = 0;
  let cursor = from;

  const skipExcluded = (at: number): number | null => {
    while (
      excludedIndex < excluded.length &&
      excluded[excludedIndex].to <= at
    ) {
      excludedIndex++;
    }
    const range = excluded[excludedIndex];
    return range && range.from <= at && range.to > at ? range.to : null;
  };

  while (cursor < to && expressions.length < MAX_SCANNED_EXPRESSIONS) {
    const excludedEnd = skipExcluded(cursor);
    if (excludedEnd !== null) {
      cursor = excludedEnd;
      continue;
    }

    if (options.format === "markdown") {
      if (text.startsWith("<!--", cursor)) {
        const commentEnd = text.indexOf("-->", cursor + 4);
        cursor = commentEnd < 0 || commentEnd >= to ? to : commentEnd + 3;
        continue;
      }
      const fence = text[cursor] === "`" || text[cursor] === "~"
        ? fenceAt(text, cursor)
        : null;
      if (fence) {
        cursor = afterMarkdownFence(text, cursor, to, fence);
        continue;
      }
      if (text[cursor] === "`" && !isEscaped(text, cursor)) {
        cursor = afterInlineCode(text, cursor, to);
        continue;
      }
      if (text[cursor] === "]" && text[cursor + 1] === "(") {
        cursor = afterMarkdownLinkDestination(text, cursor + 1, to);
        continue;
      }
      if (text[cursor] === "<") {
        cursor = afterMarkdownTag(text, cursor, to);
        continue;
      }
      const urlEnd = afterPlainUrl(text, cursor, to);
      if (urlEnd !== null) {
        cursor = urlEnd;
        continue;
      }
    } else {
      if (text[cursor] === "%" && !isEscaped(text, cursor)) {
        const lineEnd = text.indexOf("\n", cursor + 1);
        cursor = lineEnd < 0 || lineEnd >= to ? to : lineEnd + 1;
        continue;
      }
      const verbEnd = afterLatexVerb(text, cursor, to);
      if (verbEnd !== null) {
        cursor = verbEnd;
        continue;
      }
      const environmentEnd = afterLatexVerbatim(text, cursor, to);
      if (environmentEnd !== null) {
        cursor = environmentEnd;
        continue;
      }
    }

    let delimiter: MathDelimiter | null = null;
    let openerLength = 0;
    if (
      text.startsWith("$$", cursor) &&
      !isEscaped(text, cursor) &&
      text[cursor - 1] !== "$" &&
      text[cursor + 2] !== "$"
    ) {
      delimiter = "$$";
      openerLength = 2;
    } else if (
      text[cursor] === "$" &&
      !isEscaped(text, cursor) &&
      text[cursor - 1] !== "$" &&
      text[cursor + 1] !== "$" &&
      (options.format !== "markdown" || markdownDollarCanOpen(text, cursor))
    ) {
      delimiter = "$";
      openerLength = 1;
    } else if (
      text.startsWith("\\(", cursor) &&
      !isEscaped(text, cursor)
    ) {
      delimiter = "\\(";
      openerLength = 2;
    } else if (
      text.startsWith("\\[", cursor) &&
      !isEscaped(text, cursor)
    ) {
      delimiter = "\\[";
      openerLength = 2;
    }

    if (!delimiter) {
      cursor++;
      continue;
    }

    const display = delimiter === "$$" || delimiter === "\\[";
    const bodyFrom = cursor + openerLength;
    const closeAt = findClosingDelimiter(
      text,
      bodyFrom,
      to,
      delimiter,
      options.format,
      excluded,
    );
    if (closeAt >= 0) {
      const expressionTo = closeAt + openerLength;
      expressions.push({
        from: cursor,
        to: expressionTo,
        bodyFrom,
        bodyTo: closeAt,
        source: text.slice(cursor, expressionTo),
        body: text.slice(bodyFrom, closeAt),
        display,
        delimiter,
        status: "complete",
      });
      cursor = expressionTo;
      continue;
    }

    // Avoid treating ordinary unmatched currency such as "$20" as damaged
    // Pandoc math. A completed "$20$" expression is still recognized above.
    if (
      options.format === "markdown" &&
      delimiter === "$" &&
      /\d/u.test(text[bodyFrom] ?? "")
    ) {
      cursor += openerLength;
      continue;
    }

    // An unterminated opener must not swallow the rest of the document.
    const expressionTo = incompleteEnd(text, bodyFrom, to);
    expressions.push({
      from: cursor,
      to: expressionTo,
      bodyFrom,
      bodyTo: expressionTo,
      source: text.slice(cursor, expressionTo),
      body: text.slice(bodyFrom, expressionTo),
      display,
      delimiter,
      status: "incomplete",
    });
    cursor = Math.max(cursor + openerLength, expressionTo);
  }

  return expressions;
}
