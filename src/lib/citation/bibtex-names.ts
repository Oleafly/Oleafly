export function splitTopLevel(value: string, separator: (text: string, index: number) => number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let index = 0;
  while (index < value.length) {
    const character = value[index];
    let step = 1;
    if (character === "\\") step = 2;
    else if (character === "{") depth += 1;
    else if (character === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const length = separator(value, index);
      if (length > 0) {
        parts.push(value.slice(start, index));
        start = index + length;
        step = length;
      }
    }
    index += step;
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim());
}

export function andSeparator(text: string, index: number): number {
  if (text[index].trim() !== "") return 0;
  let cursor = index;
  while (text[cursor]?.trim() === "") cursor += 1;
  if (text.slice(cursor, cursor + 3).toLowerCase() !== "and") return 0;
  const after = text[cursor + 3];
  if (after?.trim() !== "") return 0;
  let end = cursor + 3;
  while (text[end]?.trim() === "") end += 1;
  return end - index;
}

export function commaSeparator(text: string, index: number): number {
  return text[index] === "," ? 1 : 0;
}

function spaceSeparator(text: string, index: number): number {
  if (text[index].trim() !== "") return 0;
  let end = index;
  while (text[end]?.trim() === "") end += 1;
  return end - index;
}

function startsLowercase(word: string): boolean {
  const letter = word.replace(/^[{\\]+/, "")[0] ?? "";
  return letter !== letter.toUpperCase() && letter === letter.toLowerCase();
}

export function splitFirstVonLast(name: string): { given: string; family: string } {
  const words = splitTopLevel(name, spaceSeparator).filter(Boolean);
  if (words.length <= 1) return { given: "", family: words[0] ?? "" };
  const lastIndex = words.length - 1;
  const von = words.slice(0, lastIndex).findIndex(startsLowercase);
  if (von < 0) return { given: words.slice(0, lastIndex).join(" "), family: words[lastIndex] };
  return { given: words.slice(0, von).join(" "), family: words.slice(von).join(" ") };
}
