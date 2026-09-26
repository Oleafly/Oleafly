const CASED_LETTER = /[\p{Lu}\p{Ll}\p{Lt}]/u;

export function preserveCase(matched: string, replacement: string): string {
  if (!matched || !replacement) return replacement;
  const letters = Array.from(matched)
    .filter((character) => CASED_LETTER.test(character))
    .join("");
  if (!letters) return replacement;
  const lower = letters.toLowerCase();
  const upper = letters.toUpperCase();

  if (letters === upper && letters !== lower) return replacement.toUpperCase();
  if (letters === lower) return replacement.toLowerCase();
  const [first = "", ...rest] = Array.from(letters);
  const tail = rest.join("");
  if (first === first.toUpperCase() && tail === tail.toLowerCase()) {
    const [head = "", ...remainder] = Array.from(replacement);
    return head.toUpperCase() + remainder.join("");
  }
  return replacement;
}
