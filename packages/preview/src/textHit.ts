export function wordInText(text: string, offset: number): string | null {
  const isWordChar = (character: string | undefined) =>
    !!character && /[\p{L}\p{N}]/u.test(character);
  let start = Math.min(Math.max(0, offset), text.length);
  let end = start;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  const word = text.slice(start, end);
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
