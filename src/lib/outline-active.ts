import type { IncludeStep, OutlineItem } from "@/lib/index/outline";

export interface ViewportAnchor {
  path: string;
  pos: number;
}

function positionIn(
  item: OutlineItem,
  trail: readonly IncludeStep[] | undefined,
  path: string,
): number | undefined {
  if (item.file === path) return item.from;
  return trail?.find((step) => step.file === path)?.from;
}

export function activeOutlineIndex(
  items: readonly OutlineItem[],
  anchor: ViewportAnchor | null,
  trails: readonly (readonly IncludeStep[])[],
): number {
  if (!anchor) return -1;
  let active = -1;
  let before = -1;
  let reached = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const at = positionIn(item, trails[i], anchor.path);
    if (at === undefined) {
      if (reached) break;
      if (item.kind === "section") before = i;
      continue;
    }
    reached = true;
    if (at > anchor.pos) break;
    if (item.kind === "section") active = i;
  }
  if (!reached) return -1;
  return active >= 0 ? active : before;
}
