import type { OutlineItem } from "@/lib/index/outline";

/** Where the editor viewport currently sits, in one file's coordinates. */
export interface ViewportAnchor {
  path: string;
  pos: number;
}

/**
 * Index of the outline entry that contains the editor's viewport anchor, or -1
 * when the anchor sits above the file's first heading.
 *
 * Only entries belonging to the file on screen can match. A multi-file outline
 * lists sections from every `\input` target, but the editor shows one file at a
 * time, so an entry from a sibling chapter can never be where the reader is.
 */
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
