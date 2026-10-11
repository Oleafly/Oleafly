import type { ComponentInfo } from "@/lib/tauri";

export const TYPST_FONT_PACK_IDS = ["typst-cjk", "typst-text", "typst-sans", "typst-mono", "typst-icons"] as const;
export type TypstFontPackId = (typeof TYPST_FONT_PACK_IDS)[number];

export function isTypstFontPackId(id: string): id is TypstFontPackId {
  return (TYPST_FONT_PACK_IDS as readonly string[]).includes(id);
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
  return packs.find(
    (pack) =>
      pack.kind === "typst-font" &&
      isTypstFontPackId(pack.id) &&
      (pack.families ?? []).some((name) => name.toLocaleLowerCase() === wanted),
  );
}
