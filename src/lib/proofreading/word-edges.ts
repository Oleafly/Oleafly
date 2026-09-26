const WORD_START = /[\p{L}\p{N}]/u;
const WORD_END = /[\p{L}\p{M}\p{N}]/u;
const LETTER_START = /\p{L}/u;
const LETTER_END = /[\p{L}\p{M}]/u;
const SOFT_HYPHENS = /\u00AD/gu;

function trimEdges(text: string, start: RegExp, end: RegExp): string {
  const chars = Array.from(text);
  let from = 0;
  let to = chars.length;
  while (from < to && !start.test(chars[from] as string)) from++;
  while (to > from && !end.test(chars[to - 1] as string)) to--;
  return from === 0 && to === chars.length ? text : chars.slice(from, to).join("");
}

export function withoutSoftHyphens(text: string): string {
  return text.replace(SOFT_HYPHENS, "");
}

export function trimToWordCharacters(text: string): string {
  return trimEdges(text, WORD_START, WORD_END);
}

export function trimToLetters(text: string): string {
  return trimEdges(text, LETTER_START, LETTER_END);
}
