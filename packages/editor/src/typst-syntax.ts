const IDENTIFIER_START = /[\p{L}\p{Nl}_]/u;
const IDENTIFIER_CONTINUE = /[\p{L}\p{M}\p{N}\p{Pc}\u200C\u200D-]/u;
const LABEL_START = /[\p{L}\p{M}\p{N}\p{Pc}]/u;
const LABEL_CONTINUE = /[\p{L}\p{M}\p{N}\p{Pc}\u200C\u200D.:-]/u;
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
  return name.replace(/[.:]+$/u, "");
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
