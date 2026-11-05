import type { ComponentInfo } from "@/lib/tauri";

export const TYPST_FONT_PACK_IDS = ["typst-cjk", "typst-text", "typst-sans", "typst-mono", "typst-icons"] as const;
export type TypstFontPackId = (typeof TYPST_FONT_PACK_IDS)[number];

export const CJK_FONT_PACK_ID: TypstFontPackId = "typst-cjk";

export const TEMPLATE_FONT_PACK_IDS = ["lato", "ptsans", "ptserif"] as const;
export type TemplateFontPackId = (typeof TEMPLATE_FONT_PACK_IDS)[number];
export type FontPackId = TypstFontPackId | TemplateFontPackId;

const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

export function cjkCharacters(texts: Iterable<string>, limit = 32): string {
  const found = new Set<string>();
  for (const text of texts) {
    for (const [character] of text.matchAll(CJK_CHARACTER)) {
      found.add(character);
      if (found.size >= limit) return [...found].join("");
    }
  }
  return [...found].join("");
}

export function isTypstFontPackId(id: string): id is TypstFontPackId {
  return (TYPST_FONT_PACK_IDS as readonly string[]).includes(id);
}

export function isTemplateFontPackId(id: string): id is TemplateFontPackId {
  return (TEMPLATE_FONT_PACK_IDS as readonly string[]).includes(id);
}

export function isFontPackId(id: string): id is FontPackId {
  return isTypstFontPackId(id) || isTemplateFontPackId(id);
}

const UNKNOWN_FONT_PREFIX = "unknown font family:";

export function missingTypstFont(message: string): string | null {
  const text = message.trim();
  if (!text.toLowerCase().startsWith(UNKNOWN_FONT_PREFIX)) return null;
  const family = text.slice(UNKNOWN_FONT_PREFIX.length).trim().replace(/^"|"$/g, "").trim();
  return family || null;
}

export function packForFamily(packs: readonly ComponentInfo[], family: string): ComponentInfo | undefined {
  const wanted = family.toLocaleLowerCase();
  const carriers = packs.filter(
    (pack) =>
      isFontPackId(pack.id) &&
      (pack.families ?? []).some((name) => name.toLocaleLowerCase() === wanted),
  );
  return carriers.find((pack) => pack.installed) ?? carriers[0];
}
