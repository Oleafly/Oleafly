import type { ComponentInfo } from "@/lib/tauri";

export const TYPST_FONT_PACK_IDS = ["typst-cjk", "typst-text", "typst-sans", "typst-mono", "typst-icons"] as const;
export type TypstFontPackId = (typeof TYPST_FONT_PACK_IDS)[number];

export function isTypstFontPackId(id: string): id is TypstFontPackId {
  return (TYPST_FONT_PACK_IDS as readonly string[]).includes(id);
}

const UNKNOWN_FONT = /^unknown font family:\s*"?(.+?)"?\s*$/i;

export function missingTypstFont(message: string): string | null {
  const family = UNKNOWN_FONT.exec(message.trim())?.[1]?.trim();
  return family ? family : null;
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
