import type { TypstFontEntry, TypstFontSourceKind } from "@/lib/typst-options";

const SOURCE_ORDER: readonly TypstFontSourceKind[] = ["project", "pack", "system", "embedded"];

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

const ESCAPED_CSS_STRING_CHARACTER = String.raw`\$&`;

export function quotedFontFamily(name: string): string {
  const escaped = fontFamilyName(name).replace(/["\\]/gu, ESCAPED_CSS_STRING_CHARACTER);
  return `"${escaped}"`;
}

const SYSTEM_FONT_ALIASES: Readonly<Record<string, string>> = {
  "sf mono": "ui-monospace",
};

export function isSystemFontAlias(name: string): boolean {
  return fontFamilyName(name).toLowerCase() in SYSTEM_FONT_ALIASES;
}

export function fontFamilyStack(name: string, fallback: string): string {
  const family = fontFamilyName(name);
  const alias = SYSTEM_FONT_ALIASES[family.toLowerCase()];
  return [quotedFontFamily(family), alias, fallback].filter(Boolean).join(", ");
}

// Named monospace fonts without Han glyphs. A CJK font only takes over for
// characters these lack, and it has to come before ui-monospace or any generic,
// which would otherwise draw Han themselves. The system SF Mono has no usable CSS
// name, so macOS falls to Menlo here unless SF Mono is installed as a font.
const CJK_LATIN_MONO_FAMILIES = [
  "Geist Mono",
  "JetBrains Mono",
  "Menlo",
  "Consolas",
  "DejaVu Sans Mono",
  "Liberation Mono",
  "Noto Sans Mono",
  "Ubuntu Mono",
] as const;

export function editorCjkFontStack(latin: string, cjk: string, fallback: string): string {
  const latinFamily = fontFamilyName(latin);
  const families = [...(latinFamily ? [latinFamily] : []), ...CJK_LATIN_MONO_FAMILIES].map(quotedFontFamily);
  return [...families, quotedFontFamily(cjk), fallback].join(", ");
}
