import { scanMathExpressions } from "./math-source";

export interface MarkdownRange {
  from: number;
  to: number;
  word: string;
}

const TRAILING_PUNCT = new Set([".", ",", ":", "!", "?", ")", "]", "}", "'"]);

function blank(chars: string[], from: number, to: number) {
  for (let i = from; i < to; i++) if (chars[i] !== "\n") chars[i] = " ";
}

export function maskMarkdown(text: string): string {
  const chars = text.split("");

  // YAML frontmatter is metadata, not document prose. Only recognize it at the
  // start of the document so a horizontal rule later in the body is untouched.
  const frontmatter = /^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/u.exec(
    text,
  );
  if (frontmatter) blank(chars, 0, frontmatter[0].length);

  const lines = text.split(/(?<=\n)/);
  let offset = 0;
  let fence: { char: string; length: number } | null = null;
  let footnoteContinuation = false;
  for (const line of lines) {
    const marker = line.match(
      /^(?:(?:[ \t]{0,3}>[ \t]?)+)?[ \t]{0,3}(`{3,}|~{3,})/u,
    );
    const footnote = /^[ \t]{0,3}\[\^[^\]\n]+\]:[ \t]*/u.exec(
      line,
    );
    if (fence) {
      blank(chars, offset, offset + line.length);
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length) fence = null;
    } else if (marker) {
      fence = { char: marker[1][0], length: marker[1].length };
      blank(chars, offset, offset + line.length);
      footnoteContinuation = false;
    } else if (footnote) {
      // The footnote label is metadata, but its body is rendered prose.
      blank(chars, offset, offset + footnote[0].length);
      footnoteContinuation = true;
    } else if (
      footnoteContinuation &&
      (/^[ \t]*$/u.test(line) || /^(?: {2,}|\t)/u.test(line))
    ) {
      // Indented footnote continuations remain visible prose.
    } else {
      footnoteContinuation = false;
      if (/^(?: {4}|\t)\S/u.test(line)) {
        // Standard indented code block. Keeping newlines preserves all offsets.
        blank(chars, offset, offset + line.length);
      } else if (
        /^[ \t]{0,3}\[(?!\^)[^\]\n]+\]:[ \t]*\S+/u.test(line)
      ) {
        // Reference-link definitions contain an identifier, target, and optional
        // title; none are rendered body prose.
        blank(chars, offset, offset + line.length);
      }
    }
    offset += line.length;
  }

  for (const match of chars.join("").matchAll(/<!--[\s\S]*?-->/gu)) {
    blank(chars, match.index!, match.index! + match[0].length);
  }
  for (const match of chars
    .join("")
    .matchAll(
      /<(script|style|pre)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
    )) {
    blank(chars, match.index!, match.index! + match[0].length);
  }
  for (const match of chars.join("").matchAll(/<\/?[A-Za-z][^>\n]*>/gu)) {
    blank(chars, match.index!, match.index! + match[0].length);
  }
  const codeSource = chars.join("");
  for (let index = 0; index < codeSource.length; index++) {
    if (codeSource[index] !== "`") continue;
    let runEnd = index + 1;
    while (codeSource[runEnd] === "`") runEnd++;
    const delimiter = codeSource.slice(index, runEnd);
    let close = codeSource.indexOf(delimiter, runEnd);
    while (
      close >= 0 &&
      (codeSource[close - 1] === "`" ||
        codeSource[close + delimiter.length] === "`")
    ) {
      close = codeSource.indexOf(delimiter, close + delimiter.length);
    }
    if (close < 0) {
      index = runEnd - 1;
      continue;
    }
    const end = close + delimiter.length;
    blank(chars, index, end);
    index = end - 1;
  }
  const links = chars.join("");
  for (let index = 0; index < links.length - 1; index++) {
    if (links[index] !== "]" || links[index + 1] !== "(") continue;
    let depth = 1;
    let cursor = index + 2;
    while (cursor < links.length && links[cursor] !== "\n") {
      if (links[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (links[cursor] === "(") depth++;
      if (links[cursor] === ")" && --depth === 0) {
        cursor++;
        break;
      }
      cursor++;
    }
    blank(chars, index + 1, cursor);
    index = Math.max(index, cursor - 1);
  }
  for (const match of chars.join("").matchAll(/!?\[[^\]\n]*\]\[[^\]\n]*\]/gu)) {
    const separator = match[0].lastIndexOf("[");
    blank(
      chars,
      match.index! + separator,
      match.index! + match[0].length,
    );
  }
  for (const pattern of [
    /<(?:https?:\/\/|mailto:)[^>\n]+>/giu,
    /<[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}>/giu,
    /(?:https?:\/\/|www\.)[^\s<>()]+/giu,
    /\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}\b/giu,
  ]) {
    for (const match of chars.join("").matchAll(pattern)) {
      blank(chars, match.index!, match.index! + match[0].length);
    }
  }
  for (const expression of scanMathExpressions(chars.join(""), {
    format: "markdown",
  })) {
    blank(chars, expression.from, expression.to);
  }
  return chars.join("");
}

export function markdownToProse(text: string): { prose: string; map: number[] } {
  const masked = maskMarkdown(text);
  let prose = "";
  const map: number[] = [];
  let pending = false;
  for (let i = 0; i < masked.length; i++) {
    const char = masked[i];
    if (/\s/.test(char)) {
      if (prose.length > 0) pending = true;
      continue;
    }
    if (pending) {
      pending = false;
      if (!TRAILING_PUNCT.has(char)) {
        prose += " ";
        map.push(i);
      }
    }
    prose += char;
    map.push(i);
  }
  return { prose, map };
}

export function markdownSpellcheckRanges(text: string): MarkdownRange[] {
  const masked = maskMarkdown(text);
  const ranges: MarkdownRange[] = [];
  for (const match of masked.matchAll(/[A-Za-z][A-Za-z']*/g)) {
    ranges.push({ from: match.index!, to: match.index! + match[0].length, word: match[0] });
  }
  return ranges;
}
