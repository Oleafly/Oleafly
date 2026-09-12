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

// Escapes, strings, block comments, raw spans, and math are opaque to the
// bracket and statement scanners: each returns the offset just past the span,
// or null when the cursor is on ordinary code.
function opaqueSpanEnd(text: string, cursor: number): number | null {
  if (text[cursor] === "\\") return cursor + 2;
  if (text[cursor] === '"') return closingQuote(text, cursor + 1);
  if (text.startsWith("/*", cursor)) return closingBlockComment(text, cursor);
  if (text[cursor] === "`") return closingRawSpan(text, cursor);
  if (text[cursor] === "$") return closingMath(text, cursor);
  return null;
}

function closingBalanced(
  text: string,
  from: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  let cursor = from;
  while (cursor < text.length) {
    if (text.startsWith("//", cursor)) {
      const newline = text.indexOf("\n", cursor + 2);
      cursor = newline < 0 ? text.length : newline;
      continue;
    }
    const opaque = opaqueSpanEnd(text, cursor);
    if (opaque !== null) {
      cursor = opaque;
      continue;
    }
    if (text[cursor] === open) depth += 1;
    if (text[cursor] === close) {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
    cursor += 1;
  }
  return text.length;
}

function endOfLine(text: string, from: number): number {
  const newline = text.indexOf("\n", from);
  return newline < 0 ? text.length : newline;
}

interface TypstNesting {
  parentheses: number;
  braces: number;
  brackets: number;
}

function trackTypstNesting(character: string, nesting: TypstNesting): void {
  if (character === "(") nesting.parentheses += 1;
  else if (character === ")") {
    nesting.parentheses = Math.max(0, nesting.parentheses - 1);
  } else if (character === "{") nesting.braces += 1;
  else if (character === "}") nesting.braces = Math.max(0, nesting.braces - 1);
  else if (character === "[") nesting.brackets += 1;
  else if (character === "]") {
    nesting.brackets = Math.max(0, nesting.brackets - 1);
  }
}

function statementEnd(text: string, from: number): number {
  const nesting: TypstNesting = { parentheses: 0, braces: 0, brackets: 0 };
  let cursor = from;
  while (cursor < text.length) {
    if (text.startsWith("//", cursor)) {
      return endOfLine(text, cursor);
    }
    const opaque = opaqueSpanEnd(text, cursor);
    if (opaque !== null) {
      cursor = opaque;
      continue;
    }
    const balanced =
      nesting.parentheses === 0 &&
      nesting.braces === 0 &&
      nesting.brackets === 0;
    const character = text[cursor];
    if (balanced && character === ";") return cursor + 1;
    if (balanced && character === "\n") return cursor;
    trackTypstNesting(character, nesting);
    cursor += 1;
  }
  return text.length;
}

function contentBlockStart(text: string, from: number): number {
  let parentheses = 0;
  let braces = 0;
  let cursor = from;
  while (cursor < text.length) {
    if (text.startsWith("//", cursor) || text[cursor] === "\n") {
      return -1;
    }
    const opaque = opaqueSpanEnd(text, cursor);
    if (opaque !== null) {
      cursor = opaque;
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
    cursor += 1;
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
    /(?:https?:\/\/|www\.)[^\s<>()[\]{}]+/giu,
    /\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}\b/giu,
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

function typstLineCommentEnd(text: string, cursor: number): number {
  const newline = text.indexOf("\n", cursor + 2);
  return newline < 0 ? text.length : newline;
}

function typstBlockCommentEnd(text: string, cursor: number): number {
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
  return end;
}

function typstRawFenceEnd(text: string, cursor: number): number {
  let width = 1;
  while (text[cursor + width] === "`") width += 1;
  const fence = "`".repeat(width);
  const close = text.indexOf(fence, cursor + width);
  return close < 0 ? text.length : close + fence.length;
}

function typstInlineMathEnd(text: string, cursor: number): number {
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
  return end;
}

function typstLabelEnd(text: string, cursor: number): number | null {
  const close = text.indexOf(">", cursor + 1);
  if (close >= 0 && !/\s/u.test(text.slice(cursor + 1, close))) {
    return close + 1;
  }
  return null;
}

function typstCitationEnd(text: string, cursor: number): number {
  let end = cursor + 2;
  while (
    isIdentifierContinue(text[end]) ||
    text[end] === ":" ||
    text[end] === "."
  ) {
    end += 1;
  }
  return end;
}

const TYPST_BLOCK_KEYWORDS = new Set(["if", "for", "while"]);
const TYPST_STATEMENT_KEYWORDS = new Set([
  "let",
  "set",
  "show",
  "import",
  "include",
]);

function typstBlockKeywordEnd(
  characters: string[],
  text: string,
  cursor: number,
  identifier: string,
): number {
  const blockStart = contentBlockStart(text, cursor);
  const codeEnd =
    blockStart >= 0 ? blockStart : statementEnd(text, cursor);
  blank(characters, cursor, codeEnd);
  if (identifier === "if" && blockStart >= 0) {
    maskIfElseBranches(characters, text, blockStart);
  }
  return codeEnd;
}

// Calls and member access are one code expression:
// `#model.encoder.run(input).result`. Keep a following content block
// (`[visible prose]`) available to proofreading.
function typstCallChainEnd(
  characters: string[],
  text: string,
  cursor: number,
): number {
  let at = cursor;
  while (at < text.length) {
    while (text[at] === " " || text[at] === "\t") {
      blank(characters, at, at + 1);
      at += 1;
    }
    if (text[at] === "(") {
      const end = closingBalanced(text, at, "(", ")");
      blank(characters, at, end);
      at = end;
      continue;
    }
    if (text[at] === "." && isIdentifierStart(text[at + 1])) {
      const memberStart = at;
      at += 2;
      while (isIdentifierContinue(text[at])) at += 1;
      blank(characters, memberStart, at);
      continue;
    }
    break;
  }
  return at;
}

function typstHashExpressionEnd(
  characters: string[],
  text: string,
  cursor: number,
): number {
  const expressionStart = cursor;
  let at = cursor + 1;
  if (text[at] === "{") {
    const end = closingBalanced(text, at, "{", "}");
    blank(characters, expressionStart, end);
    return end;
  }
  if (text[at] === '"') {
    const end = closingQuote(text, at + 1);
    blank(characters, expressionStart, end);
    return end;
  }
  if (!isIdentifierStart(text[at])) {
    blank(characters, expressionStart, at);
    return at;
  }
  const identifierStart = at;
  at += 1;
  while (isIdentifierContinue(text[at])) at += 1;
  const identifier = text.slice(identifierStart, at);
  blank(characters, expressionStart, at);

  if (TYPST_BLOCK_KEYWORDS.has(identifier)) {
    return typstBlockKeywordEnd(characters, text, at, identifier);
  }
  if (TYPST_STATEMENT_KEYWORDS.has(identifier)) {
    const end = statementEnd(text, at);
    blank(characters, at, end);
    return end;
  }
  return typstCallChainEnd(characters, text, at);
}

function maskTypstToken(
  characters: string[],
  text: string,
  cursor: number,
): number {
  if (text.startsWith("//", cursor)) {
    const end = typstLineCommentEnd(text, cursor);
    blank(characters, cursor, end);
    return end;
  }
  if (text.startsWith("/*", cursor)) {
    const end = typstBlockCommentEnd(text, cursor);
    blank(characters, cursor, end);
    return end;
  }
  if (text[cursor] === "`") {
    const end = typstRawFenceEnd(text, cursor);
    blank(characters, cursor, end);
    return end;
  }
  if (text[cursor] === "$") {
    const end = typstInlineMathEnd(text, cursor);
    blank(characters, cursor, end);
    return end;
  }
  if (text[cursor] === "<") {
    const end = typstLabelEnd(text, cursor);
    if (end !== null) {
      blank(characters, cursor, end);
      return end;
    }
  }
  if (text[cursor] === "@" && isIdentifierStart(text[cursor + 1])) {
    const end = typstCitationEnd(text, cursor);
    blank(characters, cursor, end);
    return end;
  }
  if (text[cursor] !== "#") return cursor + 1;
  return typstHashExpressionEnd(characters, text, cursor);
}

const TYPST_MARKUP_MARKERS = [
  /^[ \t]*(=+)(?=[ \t])/gmu,
  /^[ \t]*([-+])(?=[ \t])/gmu,
  /^[ \t]*(\/)(?=[ \t])/gmu,
];

function maskTypstMarkupMarkers(characters: string[]): void {
  const markup = characters.join("");
  for (const pattern of TYPST_MARKUP_MARKERS) {
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
}

function maskTypstDelimiters(characters: string[]): void {
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
    cursor = maskTypstToken(characters, text, cursor);
  }

  maskRemoteTargets(characters);
  // Markup punctuation is structural rather than prose. Preserve all source
  // offsets while removing heading/list markers, content brackets, and
  // emphasis delimiters that would otherwise create synthetic Harper lints.
  maskTypstMarkupMarkers(characters);
  maskTypstDelimiters(characters);
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
