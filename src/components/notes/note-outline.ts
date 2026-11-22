import { scrollBehavior } from "@/lib/reduced-motion";
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

export interface DomOutline {
  headings: OutlineHeading[];
  elements: HTMLElement[];
}

export const HEADING_SELECTOR = [1, 2, 3, 4, 5, 6].map((level) => `:scope > h${level}`).join(", ");
export const ACTIVE_OFFSET_PX = 72;
const READ_DELAY_MS = 120;
const HEADING = "h1, h2, h3, h4, h5, h6";

export function markdownOutline(markdown: string): OutlineHeading[] {
  return noteHeadings(markdown).map((heading, index) => ({ index, ...heading }));
}

export function domOutline(root: ParentNode): DomOutline {
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

export function scrollToHeading(element: HTMLElement): void {
  element.scrollIntoView?.({ block: "start", behavior: scrollBehavior() });
}

function touchesHeading(node: Node): boolean {
  if (!(node instanceof Element)) return node.parentElement?.closest(HEADING) != null;
  return node.matches(HEADING) || node.closest(HEADING) !== null || node.querySelector(HEADING) !== null;
}

function changesHeadings(root: HTMLElement, records: readonly MutationRecord[]): boolean {
  return records.some(
    (record) =>
      record.target === root ||
      touchesHeading(record.target) ||
      [...record.addedNodes, ...record.removedNodes].some(touchesHeading),
  );
}

export interface HeadingWatch {
  readonly onRead: (outline: DomOutline) => void;
  readonly onActive: (index: number) => void;
}

export function watchHeadings(root: HTMLElement, { onRead, onActive }: HeadingWatch): () => void {
  const container = scrollParent(root);
  let elements: readonly HTMLElement[] = [];
  let readTimer = 0;
  let frame = 0;
  const measure = () => {
    frame = 0;
    if (container) onActive(activeHeadingIndex(headingTops(elements, container)));
  };
  const onScroll = () => {
    if (frame === 0) frame = window.requestAnimationFrame(measure);
  };
  const read = () => {
    const outline = domOutline(root);
    elements = outline.elements;
    onRead(outline);
    measure();
  };
  const observer = new MutationObserver((records) => {
    if (!changesHeadings(root, records)) return;
    window.clearTimeout(readTimer);
    readTimer = window.setTimeout(read, READ_DELAY_MS);
  });
  container?.addEventListener("scroll", onScroll, { passive: true });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  read();
  return () => {
    window.clearTimeout(readTimer);
    observer.disconnect();
    container?.removeEventListener("scroll", onScroll);
    if (frame !== 0) window.cancelAnimationFrame(frame);
  };
}
