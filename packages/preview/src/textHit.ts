const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;
const WORD_JOINER = /[\u200C\u200D]/u;

export function wordInText(text: string, offset: number): string | null {
  const characters = Array.from(text);
  const isWordChar = (index: number) => {
    const character = characters[index];
    if (character === undefined) return false;
    if (WORD_CHARACTER.test(character)) return true;
    return (
      WORD_JOINER.test(character) &&
      WORD_CHARACTER.test(characters[index - 1] ?? "") &&
      WORD_CHARACTER.test(characters[index + 1] ?? "")
    );
  };
  const target = Math.min(Math.max(0, offset), text.length);
  let index = 0;
  for (let unit = 0; index < characters.length; index++) {
    unit += characters[index].length;
    if (unit > target) break;
  }
  let start = index;
  let end = index;
  while (start > 0 && isWordChar(start - 1)) start--;
  while (end < characters.length && isWordChar(end)) end++;
  const word = characters.slice(start, end).join("");
  return word.length ? word : null;
}

export function closestMatchingElement<T extends Element>(
  target: EventTarget | null | undefined,
  selector: string,
): T | null {
  const closest = (target as { closest?: (value: string) => Element | null } | null)?.closest;
  return typeof closest === "function" ? (closest.call(target, selector) as T | null) : null;
}

export function wordAtHorizontalPosition(
  text: string,
  left: number,
  width: number,
  clientX: number,
): string | null {
  if (!text || width <= 0) return null;
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
  const offset = Math.min(text.length - 1, Math.floor(ratio * text.length));
  return wordInText(text, offset);
}
