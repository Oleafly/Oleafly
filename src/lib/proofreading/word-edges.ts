const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const LETTER = /\p{L}/u;

function trimEdges(text: string, keep: RegExp): string {
  const chars = Array.from(text);
  let start = 0;
  let end = chars.length;
  while (start < end && !keep.test(chars[start] as string)) start++;
  while (end > start && !keep.test(chars[end - 1] as string)) end--;
  return start === 0 && end === chars.length ? text : chars.slice(start, end).join("");
}

export function trimToWordCharacters(text: string): string {
  return trimEdges(text, WORD_CHARACTER);
}

export function trimToLetters(text: string): string {
  return trimEdges(text, LETTER);
}
