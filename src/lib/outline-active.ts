import type { OutlineItem } from "@/lib/index/outline";

export interface ViewportAnchor {
  path: string;
  pos: number;
}

export function activeOutlineIndex(
  items: readonly OutlineItem[],
  anchor: ViewportAnchor | null,
): number {
  if (!anchor) return -1;
  let active = -1;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.file !== anchor.path) continue;
    if (item.from > anchor.pos) break;
    active = i;
  }
  return active;
}
