export interface TypstWordRange {
  from: number;
  to: number;
  word: string;
}

const isIdentifierStart = (char: string | undefined): boolean =>
  Boolean(char && /[\p{L}_]/u.test(char));
const isIdentifierContinue = (
  char: string | undefined,
): boolean =>
  Boolean(char && /[\p{L}\p{N}_-]/u.test(char));

function blank(
  characters: string[],
  from: number,
  to: number,
): void {
  for (let index = from; index < to; index += 1) {
    if (
      characters[index] !== "\n" &&
      characters[index] !== "\r"
    ) {
      characters[index] = " ";
    }
  }
}

function closingQuote(text: string, from: number): number {
  for (let cursor = from; cursor < text.length; cursor += 1) {
    if (text[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (text[cursor] === '"') return cursor + 1;
  }
  return text.length;
}

function closingBalanced(
  text: string,
  from: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  for (let cursor = from; cursor < text.length; cursor += 1) {
    if (text[cursor] === '"') {
      cursor = closingQuote(text, cursor + 1) - 1;
      continue;
    }
    if (text.startsWith("//", cursor)) {
      const newline = text.indexOf("\n", cursor + 2);
      cursor = (newline < 0 ? text.length : newline) - 1;
      continue;
    }
    if (text[cursor] === open) depth += 1;
    if (text[cursor] !== close) continue;
    depth -= 1;
    if (depth === 0) return cursor + 1;
  }
  return text.length;
}

function maskRemoteTargets(characters: string[]): void {
  const text = characters.join("");
  const patterns = [
    /(?:https?:\/\/|www\.)[^\s<>()\[\]{}]+/giu,
    /\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}\b/giu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      blank(
        characters,
        match.index,
        match.index + match[0].length,
      );
    }
  }
}

/**
 * Produces a same-UTF-16-length Typst string containing only visible markup
 * prose. Code expressions, comments, math, raw blocks, labels, citations,
 * URLs, and email addresses become spaces while line breaks are retained.
 */
export function maskTypstToProse(text: string): string {
  const characters = text.split("");
  let cursor = 0;
  while (cursor < text.length) {
    if (text.startsWith("//", cursor)) {
      const newline = text.indexOf("\n", cursor + 2);
      const end = newline < 0 ? text.length : newline;
      blank(characters, cursor, end);
      cursor = end;
      continue;
    }
    if (text.startsWith("/*", cursor)) {
      let depth = 1;
      let end = cursor + 2;
      while (end < text.length && depth > 0) {
        if (text.startsWith("/*", end)) {
          depth += 1;
          end += 2;
        } else if (text.startsWith("*/", end)) {
          depth -= 1;
          end += 2;
        } else {
          end += 1;
        }
      }
      blank(characters, cursor, end);
      cursor = end;
      continue;
    }
    if (text[cursor] === "`") {
      let width = 1;
      while (text[cursor + width] === "`") width += 1;
      const fence = "`".repeat(width);
      const close = text.indexOf(fence, cursor + width);
      const end =
        close < 0 ? text.length : close + fence.length;
      blank(characters, cursor, end);
      cursor = end;
      continue;
    }
    if (text[cursor] === "$") {
      let end = cursor + 1;
      while (end < text.length) {
        if (text[end] === "\\") {
          end += 2;
          continue;
        }
        if (text[end] === "$") {
          end += 1;
          break;
        }
        end += 1;
      }
      blank(characters, cursor, end);
      cursor = end;
      continue;
    }
    if (text[cursor] === "<") {
      const close = text.indexOf(">", cursor + 1);
      if (
        close >= 0 &&
        !/\s/u.test(text.slice(cursor + 1, close))
      ) {
        blank(characters, cursor, close + 1);
        cursor = close + 1;
        continue;
      }
    }
    if (
      text[cursor] === "@" &&
      isIdentifierStart(text[cursor + 1])
    ) {
      let end = cursor + 2;
      while (
        isIdentifierContinue(text[end]) ||
        text[end] === ":" ||
        text[end] === "."
      ) {
        end += 1;
      }
      blank(characters, cursor, end);
      cursor = end;
      continue;
    }
    if (text[cursor] !== "#") {
      cursor += 1;
      continue;
    }

    const expressionStart = cursor;
    cursor += 1;
    if (text[cursor] === "{") {
      const end = closingBalanced(
        text,
        cursor,
        "{",
        "}",
      );
      blank(characters, expressionStart, end);
      cursor = end;
      continue;
    }
    if (text[cursor] === '"') {
      const end = closingQuote(text, cursor + 1);
      blank(characters, expressionStart, end);
      cursor = end;
      continue;
    }
    if (!isIdentifierStart(text[cursor])) {
      blank(characters, expressionStart, cursor);
      continue;
    }
    const identifierStart = cursor;
    cursor += 1;
    while (isIdentifierContinue(text[cursor])) cursor += 1;
    const identifier = text.slice(identifierStart, cursor);
    blank(characters, expressionStart, cursor);

    while (text[cursor] === " " || text[cursor] === "\t") {
      blank(characters, cursor, cursor + 1);
      cursor += 1;
    }
    if (text[cursor] === "(") {
      const end = closingBalanced(
        text,
        cursor,
        "(",
        ")",
      );
      blank(characters, cursor, end);
      cursor = end;
      continue;
    }
    if (
      [
        "let",
        "set",
        "show",
        "import",
        "include",
        "if",
        "for",
        "while",
      ].includes(identifier)
    ) {
      const newline = text.indexOf("\n", cursor);
      const end = newline < 0 ? text.length : newline;
      blank(characters, cursor, end);
      cursor = end;
    }
  }

  maskRemoteTargets(characters);
  return characters.join("");
}

export function typstToProse(text: string): {
  prose: string;
  map: number[];
} {
  const masked = maskTypstToProse(text);
  let prose = "";
  const map: number[] = [];
  let pendingSpace = -1;
  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index];
    if (/\s/u.test(character)) {
      if (prose.length > 0) pendingSpace = index;
      continue;
    }
    if (pendingSpace >= 0) {
      prose += " ";
      map.push(pendingSpace);
      pendingSpace = -1;
    }
    prose += character;
    map.push(index);
  }
  return { prose, map };
}

export function typstSpellcheckRanges(
  text: string,
): TypstWordRange[] {
  const masked = maskTypstToProse(text);
  const ranges: TypstWordRange[] = [];
  for (const match of masked.matchAll(/\p{L}[\p{L}'’]*/gu)) {
    if (match.index === undefined || match[0].length < 2) {
      continue;
    }
    ranges.push({
      from: match.index,
      to: match.index + match[0].length,
      word: text.slice(
        match.index,
        match.index + match[0].length,
      ),
    });
  }
  return ranges;
}
