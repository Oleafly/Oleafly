import type { TypstFontEntry, TypstFontSourceKind } from "@/lib/typst-options";

const SOURCE_ORDER: readonly TypstFontSourceKind[] = ["project", "system", "embedded"];

export function matchingFamilies(families: readonly TypstFontEntry[], query: string): TypstFontEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...families];
  return families.filter((family) => family.name.toLocaleLowerCase().includes(needle));
}

export function sourceKinds(family: TypstFontEntry): TypstFontSourceKind[] {
  const kinds = new Set(family.sources.map((source) => source.kind));
  return SOURCE_ORDER.filter((kind) => kinds.has(kind));
}

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "math",
  "emoji",
  "fangsong",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
]);

export function withoutControlCharacters(value: string): string {
  return value.replace(/\p{Cc}/gu, "");
}

export function fontFamilyName(value: string): string {
  return withoutControlCharacters(value.replace(/\s+/gu, " ")).trim();
}

export function primaryFontFamily(stack: string): string {
  const trimmed = stack.trim();
  const quote = trimmed[0];
  let first = "";
  if (quote === '"' || quote === "'") {
    for (let index = 1; index < trimmed.length; index += 1) {
      const character = trimmed[index];
      if (character === quote) break;
      if (character === "\\") index += 1;
      first += trimmed[index] ?? "";
    }
  } else {
    first = trimmed.split(",", 1)[0] ?? "";
  }
  const name = fontFamilyName(first);
  return GENERIC_FAMILIES.has(name.toLowerCase()) ? "" : name;
}

export function quotedFontFamily(name: string): string {
  return `"${fontFamilyName(name).replace(/["\\]/gu, String.raw`\$&`)}"`;
}
