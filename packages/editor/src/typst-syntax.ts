const IDENTIFIER_START = /[\p{L}\p{Nl}_]/u;
const IDENTIFIER_CONTINUE = /[\p{L}\p{M}\p{N}\p{Pc}-]|\u200C|\u200D/u;
const LABEL_START = /[\p{L}\p{M}\p{N}\p{Pc}]/u;
const LABEL_CONTINUE = /[\p{L}\p{M}\p{N}\p{Pc}.:-]|\u200C|\u200D/u;
const AUTOLINK_CHARACTER = /[0-9A-Za-z!#$%&*+,\-./:;=?@_~']/;
const AUTOLINK_TRAILING_PUNCTUATION = "!,.:;?'";

export const TYPST_IDENTIFIER_PATTERN = String.raw`[\p{L}\p{Nl}_][\p{L}\p{M}\p{N}\p{Pc}\u200C\u200D-]*`;
export const TYPST_LABEL_PATTERN = String.raw`[\p{L}\p{M}\p{N}\p{Pc}][\p{L}\p{M}\p{N}\p{Pc}\u200C\u200D.:-]*`;
export const TYPST_NAME_CHARACTER_PATTERN = String.raw`[\p{L}\p{M}\p{N}\p{Pc}]`;
export const TYPST_NUMBER_END_PATTERN = String.raw`(?![\p{L}\p{M}\p{N}\p{Pc}\u200C\u200D])`;
export const TYPST_IDENTIFIER_END_PATTERN = String.raw`(?![\p{L}\p{M}\p{N}\p{Pc}\u200C\u200D-])`;

function characterAt(text: string, index: number): string | undefined {
  const codePoint = text.codePointAt(index);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

function runEnd(
  text: string,
  from: number,
  start: RegExp,
  rest: RegExp,
): number {
  let character = characterAt(text, from);
  if (!character || !start.test(character)) return from;
  let end = from + character.length;
  for (;;) {
    character = characterAt(text, end);
    if (!character || !rest.test(character)) return end;
    end += character.length;
  }
}

export function isTypstIdentifierContinueAt(
  text: string,
  index: number,
): boolean {
  const character = characterAt(text, index);
  return Boolean(character && IDENTIFIER_CONTINUE.test(character));
}

export function typstIdentifierEnd(text: string, from: number): number {
  return runEnd(text, from, IDENTIFIER_START, IDENTIFIER_CONTINUE);
}

export function trimTypstReference(name: string): string {
  let end = name.length;
  while (end > 0 && (name[end - 1] === "." || name[end - 1] === ":")) end -= 1;
  return name.slice(0, end);
}

export function typstReferenceEnd(text: string, from: number): number {
  const end = runEnd(text, from, LABEL_START, LABEL_CONTINUE);
  return from + trimTypstReference(text.slice(from, end)).length;
}

export function isTypstEscaped(text: string, offset: number): boolean {
  let backslashes = 0;
  for (let cursor = offset - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function closesAutolinkBracket(character: string, brackets: string[]): boolean {
  if (character !== "]" && character !== ")") return false;
  return brackets.pop() === (character === "]" ? "[" : "(");
}

export function typstAutolinkEnd(text: string, from: number): number | null {
  if (
    text[from] !== "h" ||
    (!text.startsWith("http://", from) && !text.startsWith("https://", from))
  ) {
    return null;
  }
  const brackets: string[] = [];
  let end = from;
  while (end < text.length) {
    const character = text[end];
    if (character === "[" || character === "(") brackets.push(character);
    else if (character === "]" || character === ")") {
      if (!closesAutolinkBracket(character, brackets)) break;
    } else if (!AUTOLINK_CHARACTER.test(character)) break;
    end += 1;
  }
  while (
    end > from &&
    AUTOLINK_TRAILING_PUNCTUATION.includes(text[end - 1])
  ) {
    end -= 1;
  }
  return end;
}

export const TYPST_VENDOR_DIRECTORY = "typst-packages";

export function isVendoredTypstPackagePath(path: string | null | undefined): boolean {
  if (!path) return false;
  const [head] = path.replaceAll("\\", "/").replace(/^\/+/, "").split("/");
  return head === TYPST_VENDOR_DIRECTORY;
}

type Masks = { readonly text: string[]; readonly code: string[] };

function blockCommentEnd(text: string, from: number): number {
  let depth = 0;
  let i = from;
  while (i < text.length) {
    if (text.startsWith("/*", i)) {
      depth++;
      i += 2;
    } else if (text.startsWith("*/", i)) {
      depth--;
      i += 2;
      if (depth === 0) return i;
    } else {
      i++;
    }
  }
  return text.length;
}

export function typstRawEnd(text: string, from: number): number {
  let width = 1;
  while (text[from + width] === "`") width++;
  if (width === 2) return from + 2;
  const close = text.indexOf("`".repeat(width), from + width);
  return close < 0 ? from + width : close + width;
}

function opaqueEnd(text: string, i: number): number | null {
  if (text.startsWith("//", i)) {
    const end = text.indexOf("\n", i);
    return end < 0 ? text.length : end;
  }
  if (text.startsWith("/*", i)) return blockCommentEnd(text, i);
  if (text[i] === "`") return typstRawEnd(text, i);
  return null;
}

function blankOpaque(
  text: string,
  masks: Masks,
  from: number,
  to: number,
): number {
  for (let index = from; index < to; index++) {
    if (text[index] === "\n") continue;
    masks.text[index] = " ";
    masks.code[index] = " ";
  }
  return to;
}

type MarkupFrame = { mode: "markup"; close: boolean; brackets: number };
type CodeFrame = {
  mode: "code";
  line: boolean;
  started: boolean;
  parens: number;
  braces: number;
  quoted: boolean;
};
type Frame = MarkupFrame | CodeFrame;

const LINE_CODE_KEYWORDS = ["let", "set", "show", "import", "include"];

function opensLineCode(text: string, hash: number): boolean {
  let start = hash + 1;
  while (text[start] === " " || text[start] === "\t") start++;
  return LINE_CODE_KEYWORDS.some((word) => {
    if (!text.startsWith(word, start)) return false;
    const next = text[start + word.length];
    return next === undefined || !/\w/.test(next);
  });
}

function maskMarkupStep(
  text: string,
  masks: Masks,
  i: number,
  frame: MarkupFrame,
  frames: Frame[],
): number {
  const char = text[i];
  if (char === "\\") return i + 2;
  const link = typstAutolinkEnd(text, i);
  if (link !== null) {
    for (let index = i; index < link; index++) masks.code[index] = " ";
    return link;
  }
  const opaque = opaqueEnd(text, i);
  if (opaque !== null) return blankOpaque(text, masks, i, opaque);
  if (frame.close && char === "]" && frame.brackets === 0) {
    frames.pop();
    return i + 1;
  }
  if (frame.close && char === "[") {
    frame.brackets++;
    return i + 1;
  }
  if (frame.close && char === "]") {
    frame.brackets--;
    return i + 1;
  }
  if (char === "#") {
    frames.push({
      mode: "code",
      line: opensLineCode(text, i),
      started: false,
      parens: 0,
      braces: 0,
      quoted: false,
    });
  }
  return i + 1;
}

function maskQuotedStep(
  text: string,
  chars: string[],
  i: number,
  frame: CodeFrame,
): number {
  const char = text[i];
  let cursor = i;
  if (char !== "\n") chars[cursor] = " ";
  if (char === "\\" && cursor + 1 < text.length) {
    cursor++;
    if (text[cursor] !== "\n") chars[cursor] = " ";
  } else if (char === '"') {
    frame.quoted = false;
  }
  return cursor + 1;
}

function maskCodeStep(
  text: string,
  masks: Masks,
  i: number,
  frame: CodeFrame,
  frames: Frame[],
): number {
  const char = text[i];
  const opaque = opaqueEnd(text, i);
  if (opaque !== null) {
    frame.started = true;
    return blankOpaque(text, masks, i, opaque);
  }
  if (char === '"') {
    frame.quoted = true;
    masks.code[i] = " ";
    frame.started = true;
    return i + 1;
  }
  if (char === "[") {
    frame.started = true;
    frames.push({ mode: "markup", close: true, brackets: 0 });
    return i + 1;
  }
  if (char === "(") {
    frame.parens++;
    frame.started = true;
    return i + 1;
  }
  if (char === "{") {
    frame.braces++;
    frame.started = true;
    return i + 1;
  }
  if (char === ")" && frame.parens > 0) {
    frame.parens--;
    return i + 1;
  }
  if (char === "}" && frame.braces > 0) {
    frame.braces--;
    return i + 1;
  }
  if (char === "\n" && frame.line) {
    frames.pop();
    return i;
  }
  if (
    frame.started &&
    !frame.line &&
    frame.parens === 0 &&
    frame.braces === 0 &&
    /\s/.test(char)
  ) {
    frames.pop();
    return i;
  }
  if (!/\s/.test(char)) frame.started = true;
  return i + 1;
}

export function maskTypstSource(rawText: string): { text: string; code: string } {
  const masks: Masks = { text: rawText.split(""), code: rawText.split("") };
  const frames: Frame[] = [{ mode: "markup", close: false, brackets: 0 }];
  let i = 0;
  while (i < rawText.length) {
    const frame = frames.at(-1) as Frame;
    if (frame.mode === "markup") i = maskMarkupStep(rawText, masks, i, frame, frames);
    else if (frame.quoted) i = maskQuotedStep(rawText, masks.code, i, frame);
    else i = maskCodeStep(rawText, masks, i, frame, frames);
  }
  return { text: masks.text.join(""), code: masks.code.join("") };
}
