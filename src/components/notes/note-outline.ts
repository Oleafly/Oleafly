import { noteHeadings, uniqueSlugs } from "./note-link-format";

export interface OutlineHeading {
  index: number;
  level: number;
  text: string;
  slug: string;
}

export interface OutlineRow {
  heading: OutlineHeading;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
}

export const HEADING_SELECTOR = [1, 2, 3, 4, 5, 6].map((level) => `:scope > h${level}`).join(", ");
export const ACTIVE_OFFSET_PX = 72;

export function markdownOutline(markdown: string): OutlineHeading[] {
  return noteHeadings(markdown).map((heading, index) => ({ index, ...heading }));
}

export function domOutline(root: ParentNode): { headings: OutlineHeading[]; elements: HTMLElement[] } {
  const found = [...root.querySelectorAll<HTMLElement>(HEADING_SELECTOR)]
    .map((element) => ({ element, text: `${element.textContent}`.replaceAll(/\s+/gu, " ").trim() }))
    .filter((entry) => entry.text !== "");
  const elements = found.map((entry) => entry.element);
  const texts = found.map((entry) => entry.text);
  const slugs = uniqueSlugs(texts);
  return {
    headings: elements.map((element, index) => ({
      index,
      level: Number(element.tagName.slice(1)),
      text: texts[index],
      slug: slugs[index],
    })),
    elements,
  };
}

export function outlineRows(
  headings: readonly OutlineHeading[],
  collapsed: ReadonlySet<number>,
  maxLevel: number,
): OutlineRow[] {
  const shown = headings.filter((heading) => heading.level <= maxLevel);
  const rows: OutlineRow[] = [];
  const stack: number[] = [];
  let hiddenBelow: number | null = null;
  shown.forEach((heading, at) => {
    while (stack.length > 0 && (stack.at(-1) as number) >= heading.level) stack.pop();
    const depth = stack.length;
    stack.push(heading.level);
    if (hiddenBelow !== null && heading.level > hiddenBelow) return;
    hiddenBelow = null;
    const hasChildren = (shown[at + 1]?.level ?? 0) > heading.level;
    const folded = hasChildren && collapsed.has(heading.index);
    rows.push({ heading, depth, hasChildren, collapsed: folded });
    if (folded) hiddenBelow = heading.level;
  });
  return rows;
}

export function activeHeadingIndex(tops: readonly number[], threshold = ACTIVE_OFFSET_PX): number {
  let active = -1;
  for (let index = 0; index < tops.length; index++) {
    if (tops[index] > threshold) break;
    active = index;
  }
  return active;
}

export function noteEditorRoot(noteId: string, doc: Document = document): HTMLElement | null {
  const views = doc.querySelectorAll<HTMLElement>("[data-note-view]");
  for (const view of views) {
    if (view.dataset.noteView !== noteId) continue;
    const root = view.querySelector<HTMLElement>(".ProseMirror");
    if (root) return root;
  }
  return null;
}

export function scrollParent(element: HTMLElement): HTMLElement | null {
  const marked = element.closest<HTMLElement>("[data-note-width]");
  if (marked) return marked;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll") return parent;
  }
  return null;
}

export function headingTops(elements: readonly HTMLElement[], container: HTMLElement): number[] {
  const top = container.getBoundingClientRect().top;
  return elements.map((element) => element.getBoundingClientRect().top - top);
}
