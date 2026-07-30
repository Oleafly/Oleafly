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

function closingBlockComment(text: string, from: number): number {
  let depth = 1;
  for (let cursor = from + 2; cursor < text.length; cursor += 1) {
    if (text.startsWith("/*", cursor)) {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (!text.startsWith("*/", cursor)) continue;
    depth -= 1;
    cursor += 1;
    if (depth === 0) return cursor + 1;
  }
  return text.length;
}

function closingRawSpan(text: string, from: number): number {
  let width = 1;
  while (text[from + width] === "`") width += 1;
  const fence = "`".repeat(width);
  const close = text.indexOf(fence, from + width);
  return close < 0 ? text.length : close + width;
}

function closingMath(text: string, from: number): number {
  for (let cursor = from + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (text[cursor] === "$") return cursor + 1;
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
    if (text[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (text[cursor] === '"') {
      cursor = closingQuote(text, cursor + 1) - 1;
      continue;
    }
    if (text.startsWith("//", cursor)) {
      const newline = text.indexOf("\n", cursor + 2);
      cursor = (newline < 0 ? text.length : newline) - 1;
      continue;
    }
    if (text.startsWith("/*", cursor)) {
      cursor = closingBlockComment(text, cursor) - 1;
      continue;
    }
    if (text[cursor] === "`") {
      cursor = closingRawSpan(text, cursor) - 1;
      continue;
    }
    if (text[cursor] === "$") {
      cursor = closingMath(text, cursor) - 1;
      continue;
    }
    if (text[cursor] === open) depth += 1;
    if (text[cursor] !== close) continue;
    depth -= 1;
    if (depth === 0) return cursor + 1;
  }
  return text.length;
}

function endOfLine(text: string, from: number): number {
  const newline = text.indexOf("\n", from);
  return newline < 0 ? text.length : newline;
}

function statementEnd(text: string, from: number): number {
  let parentheses = 0;
  let braces = 0;
  let brackets = 0;
  for (let cursor = from; cursor < text.length; cursor += 1) {
    if (text[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (text[cursor] === '"') {
      cursor = closingQuote(text, cursor + 1) - 1;
      continue;
    }
    if (text.startsWith("//", cursor)) {
      return endOfLine(text, cursor);
    }
    if (text.startsWith("/*", cursor)) {
      cursor = closingBlockComment(text, cursor) - 1;
      continue;
    }
    if (text[cursor] === "`") {
      cursor = closingRawSpan(text, cursor) - 1;
      continue;
    }
    if (text[cursor] === "$") {
      cursor = closingMath(text, cursor) - 1;
      continue;
    }
    if (text[cursor] === "(") parentheses += 1;
    else if (text[cursor] === ")") parentheses = Math.max(0, parentheses - 1);
    else if (text[cursor] === "{") braces += 1;
    else if (text[cursor] === "}") braces = Math.max(0, braces - 1);
    else if (text[cursor] === "[") brackets += 1;
    else if (text[cursor] === "]") brackets = Math.max(0, brackets - 1);
    else if (
      text[cursor] === ";" &&
      parentheses === 0 &&
      braces === 0 &&
      brackets === 0
    ) {
      return cursor + 1;
    } else if (
      text[cursor] === "\n" &&
      parentheses === 0 &&
      braces === 0 &&
      brackets === 0
    ) {
      return cursor;
    }
  }
  return text.length;
}

function contentBlockStart(text: string, from: number): number {
  let parentheses = 0;
  let braces = 0;
  for (let cursor = from; cursor < text.length; cursor += 1) {
    if (text[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (text[cursor] === '"') {
      cursor = closingQuote(text, cursor + 1) - 1;
      continue;
    }
    if (text.startsWith("//", cursor) || text[cursor] === "\n") {
      return -1;
    }
    if (text.startsWith("/*", cursor)) {
      cursor = closingBlockComment(text, cursor) - 1;
      continue;
    }
    if (text[cursor] === "`") {
      cursor = closingRawSpan(text, cursor) - 1;
      continue;
    }
    if (text[cursor] === "$") {
      cursor = closingMath(text, cursor) - 1;
      continue;
    }
    if (text[cursor] === "(") parentheses += 1;
    else if (text[cursor] === ")") parentheses = Math.max(0, parentheses - 1);
    else if (text[cursor] === "{") braces += 1;
    else if (text[cursor] === "}") braces = Math.max(0, braces - 1);
    else if (
      text[cursor] === "[" &&
      parentheses === 0 &&
      braces === 0 &&
      (cursor === from || /\s/u.test(text[cursor - 1]))
    ) {
      return cursor;
    }
  }
  return -1;
}

function maskIfElseBranches(
  characters: string[],
  text: string,
  firstBlockStart: number,
): void {
  let blockStart = firstBlockStart;
  for (;;) {
    let cursor = closingBalanced(text, blockStart, "[", "]");
    while (/\s/u.test(text[cursor] ?? "")) cursor += 1;
    if (
      text.slice(cursor, cursor + 4) !== "else" ||
      isIdentifierContinue(text[cursor + 4])
    ) {
      return;
    }
    const elseStart = cursor;
    cursor += 4;
    while (text[cursor] === " " || text[cursor] === "\t") cursor += 1;
    if (
      text.slice(cursor, cursor + 2) === "if" &&
      !isIdentifierContinue(text[cursor + 2])
    ) {
      cursor += 2;
    }
    const nextBlock = contentBlockStart(text, cursor);
    const codeEnd =
      nextBlock >= 0 ? nextBlock : statementEnd(text, cursor);
    blank(characters, elseStart, codeEnd);
    if (nextBlock < 0) return;
    blockStart = nextBlock;
  }
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

    if (["if", "for", "while"].includes(identifier)) {
      const blockStart = contentBlockStart(text, cursor);
      const codeEnd =
        blockStart >= 0 ? blockStart : statementEnd(text, cursor);
      blank(characters, cursor, codeEnd);
      if (identifier === "if" && blockStart >= 0) {
        maskIfElseBranches(characters, text, blockStart);
      }
      cursor = codeEnd;
      continue;
    }
    if (
      [
        "let",
        "set",
        "show",
        "import",
        "include",
      ].includes(identifier)
    ) {
      const end = statementEnd(text, cursor);
      blank(characters, cursor, end);
      cursor = end;
      continue;
    }

    // Calls and member access are one code expression:
    // `#model.encoder.run(input).result`. Keep a following content block
    // (`[visible prose]`) available to proofreading.
    while (cursor < text.length) {
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
        text[cursor] === "." &&
        isIdentifierStart(text[cursor + 1])
      ) {
        const memberStart = cursor;
        cursor += 2;
        while (isIdentifierContinue(text[cursor])) cursor += 1;
        blank(characters, memberStart, cursor);
        continue;
      }
      break;
    }
  }

  maskRemoteTargets(characters);
  // Markup punctuation is structural rather than prose. Preserve all source
  // offsets while removing heading/list markers, content brackets, and
  // emphasis delimiters that would otherwise create synthetic Harper lints.
  const markup = characters.join("");
  for (const pattern of [
    /^[ \t]*(=+)(?=[ \t])/gmu,
    /^[ \t]*([-+])(?=[ \t])/gmu,
    /^[ \t]*(\/)(?=[ \t])/gmu,
  ]) {
    for (const match of markup.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const marker = match[1];
      const markerOffset = match[0].lastIndexOf(marker);
      blank(
        characters,
        match.index + markerOffset,
        match.index + markerOffset + marker.length,
      );
    }
  }
  for (let index = 0; index < characters.length; index += 1) {
    if (
      (characters[index] === "[" ||
        characters[index] === "]" ||
        characters[index] === "*" ||
        characters[index] === "_") &&
      (index === 0 || characters[index - 1] !== "\\")
    ) {
      blank(characters, index, index + 1);
    }
  }
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
