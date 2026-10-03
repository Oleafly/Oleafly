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
