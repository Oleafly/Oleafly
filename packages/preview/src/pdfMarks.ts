import type { SynctexRect } from "./pdfController";
import { type ShownPageGeometry, shownBox } from "./pdfShownBox";
import { wordRangeInText } from "./textHit";

export interface PdfMark {
  id: string;
  label: string;
  rects: readonly SynctexRect[];
  active?: boolean;
}

export interface PdfTextSelectionInfo {
  page: number;
  rects: SynctexRect[];
  text: string;
  before: string;
  after: string;
  start: { page: number; x: number; y: number };
  end: { page: number; x: number; y: number };
  clientRect: { left: number; top: number; width: number; height: number };
}

export interface PdfRegionSelectionInfo {
  page: number;
  rect: SynctexRect;
  clientRect: { left: number; top: number; width: number; height: number };
}

interface MarkGeometry extends ShownPageGeometry {
  width: number;
  height: number;
}

export interface PageFraction {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MARK_LAYER_CLASS = "pdf-mark-layer";
const MARK_COLORS = {
  fill: "color-mix(in srgb, var(--comment-underline, #a5b4fc) 30%, transparent)",
  activeFill: "color-mix(in srgb, var(--comment-active-underline, #4f46e5) 28%, transparent)",
  line: "var(--comment-underline, #a5b4fc)",
  activeLine: "var(--comment-active-underline, #4f46e5)",
  badge: "var(--comment-ink, #3730a3)",
  activeBadge: "var(--comment-active-underline, #4f46e5)",
} as const;
export const MARK_BADGE_CLASS = "pdf-mark-badge";
const PAGE_WRAP_SELECTOR = "[data-page]";
const MIN_MARK_HEIGHT = 4;
const MAX_SELECTION_RECTS = 400;
const MAX_SELECTION_CHARS = 4_000;
export const QUOTE_CONTEXT_LENGTH = 32;

export function markFraction(rect: SynctexRect, geometry: MarkGeometry): PageFraction | null {
  if (!(geometry.width > 0) || !(geometry.height > 0)) return null;
  if (!Array.isArray(geometry.viewBox) || typeof geometry.convertToViewportPoint !== "function") return null;
  const shown = shownBox(rect, geometry, MIN_MARK_HEIGHT);
  const box = {
    left: shown.left / geometry.width,
    top: shown.top / geometry.height,
    width: shown.width / geometry.width,
    height: shown.height / geometry.height,
  };
  if (![box.left, box.top, box.width, box.height].every(Number.isFinite)) return null;
  return box;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(4)}%`;
}

export function clearPdfMarks(wrap: HTMLElement): void {
  for (const layer of wrap.querySelectorAll(`:scope > .${MARK_LAYER_CLASS}`)) layer.remove();
}

export function paintPdfMarks(
  wrap: HTMLElement,
  pageNumber: number,
  geometry: MarkGeometry | undefined,
  marks: readonly PdfMark[],
  options: { badgeLabel: (mark: PdfMark) => string; onActivate?: (id: string) => void },
): void {
  clearPdfMarks(wrap);
  if (!geometry) return;
  const onPage = marks.filter((mark) => mark.rects.some((rect) => rect.page === pageNumber));
  if (onPage.length === 0) return;
  const layer = document.createElement("div");
  layer.className = MARK_LAYER_CLASS;
  Object.assign(layer.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    zIndex: "3",
  } as Partial<CSSStyleDeclaration>);
  for (const mark of onPage) {
    let badgePlaced = false;
    for (const rect of mark.rects) {
      if (rect.page !== pageNumber) continue;
      const box = markFraction(rect, geometry);
      if (!box) continue;
      const highlight = document.createElement("div");
      highlight.className = "pdf-mark";
      highlight.dataset.markId = mark.id;
      highlight.setAttribute("aria-hidden", "true");
      Object.assign(highlight.style, {
        position: "absolute",
        left: percent(box.left),
        top: percent(box.top),
        width: percent(box.width),
        height: percent(box.height),
        borderRadius: "2px",
        background: mark.active ? MARK_COLORS.activeFill : MARK_COLORS.fill,
        borderBottom: mark.active ? `2px solid ${MARK_COLORS.activeLine}` : `1px solid ${MARK_COLORS.line}`,
      } as Partial<CSSStyleDeclaration>);
      layer.appendChild(highlight);
      if (badgePlaced) continue;
      badgePlaced = true;
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = MARK_BADGE_CLASS;
      badge.dataset.markId = mark.id;
      badge.textContent = mark.label;
      badge.setAttribute("aria-label", options.badgeLabel(mark));
      Object.assign(badge.style, {
        position: "absolute",
        left: percent(box.left),
        top: percent(box.top),
        transform: "translate(-60%, -70%)",
        minWidth: "1rem",
        height: "1rem",
        padding: "0 0.25rem",
        borderRadius: "0.5rem",
        border: "1px solid rgba(255, 255, 255, 0.9)",
        background: mark.active ? MARK_COLORS.activeBadge : MARK_COLORS.badge,
        color: "white",
        font: "500 0.625rem/0.875rem system-ui, sans-serif",
        textAlign: "center",
        cursor: "pointer",
        pointerEvents: "auto",
      } as Partial<CSSStyleDeclaration>);
      const activate = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        options.onActivate?.(mark.id);
      };
      badge.addEventListener("pointerdown", (event) => event.stopPropagation());
      badge.addEventListener("mousedown", (event) => event.stopPropagation());
      badge.addEventListener("click", activate);
      const resting = mark.active ? MARK_COLORS.activeBadge : MARK_COLORS.badge;
      badge.addEventListener("focus", () => {
        badge.style.background = mark.active ? MARK_COLORS.badge : MARK_COLORS.activeBadge;
      });
      badge.addEventListener("blur", () => {
        badge.style.background = resting;
      });
      layer.appendChild(badge);
    }
  }
  wrap.appendChild(layer);
}

type ToPagePoint = (
  wrap: HTMLElement,
  page: number,
  point: { clientX: number; clientY: number },
) => { page: number; x: number; y: number } | null;

interface ClientBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function clientBoxToPageRect(
  box: ClientBox,
  page: number,
  wrap: HTMLElement,
  toPagePoint: ToPagePoint,
): SynctexRect | null {
  const a = toPagePoint(wrap, page, { clientX: box.left, clientY: box.top });
  const b = toPagePoint(wrap, page, { clientX: box.right, clientY: box.bottom });
  if (!a || !b) return null;
  return {
    page,
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

type Side = "start" | "end";

function isTextNode(node: Node | null | undefined): node is Text {
  return node?.nodeType === Node.TEXT_NODE;
}

function elementAt(node: Node | null | undefined, offset: number, side: Side): Element | null {
  if (!node) return null;
  if (node.nodeType !== Node.ELEMENT_NODE) return node.parentElement;
  const child = node.childNodes[side === "start" ? offset : offset - 1];
  if (child?.nodeType === Node.ELEMENT_NODE) return child as Element;
  return node as Element;
}

interface PageAt {
  page: number;
  wrap: HTMLElement;
}

interface PageHit extends PageAt {
  bounds: DOMRect;
}

function pageAt(node: Node | null | undefined, offset: number, side: Side, container: HTMLElement): PageAt | null {
  const wrap = elementAt(node, offset, side)?.closest<HTMLElement>(PAGE_WRAP_SELECTOR);
  if (!wrap || !container.contains(wrap)) return null;
  const page = Number(wrap.dataset.page);
  if (!Number.isInteger(page) || page < 1) return null;
  return { page, wrap };
}

function centredIn(bounds: DOMRect, box: ClientBox): boolean {
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function collapseWhitespace(text: string, normalize: (text: string) => string): string {
  return normalize(text).replace(/\s+/gu, " ").trim();
}

function renderedPiece(node: Node): string {
  if (isTextNode(node)) return node.data;
  return node.nodeName === "BR" ? " " : "";
}

function quoteContext(
  range: Range,
  page: PageAt | null,
  side: Side,
  normalize: (text: string) => string,
): string {
  const node = side === "start" ? range.startContainer : range.endContainer;
  const offset = side === "start" ? range.startOffset : range.endOffset;
  if (!node || !page || typeof range.comparePoint !== "function") return "";
  const layer = elementAt(node, offset, side)?.closest(".textLayer") ?? page.wrap.querySelector(".textLayer");
  if (!layer) return "";
  const pieces: string[] = [];
  const walker = (layer.ownerDocument ?? document).createTreeWalker(
    layer,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const piece = renderedPiece(current);
    if (!piece) continue;
    if (current === node) {
      pieces.push(side === "start" ? piece.slice(0, offset) : piece.slice(offset));
      continue;
    }
    let position: number;
    try {
      position = range.comparePoint(current, 0);
    } catch {
      continue;
    }
    if ((side === "start" && position < 0) || (side === "end" && position > 0)) pieces.push(piece);
  }
  const characters = Array.from(normalize(pieces.join("")).replace(/\s+/gu, " "));
  const kept =
    side === "start" ? characters.slice(-QUOTE_CONTEXT_LENGTH) : characters.slice(0, QUOTE_CONTEXT_LENGTH);
  const context = kept.join("");
  return side === "start" ? context.trimStart() : context.trimEnd();
}

function snapPoint(node: Node, offset: number, side: Side): number {
  if (!isTextNode(node)) return offset;
  const word = wordRangeInText(node.data, offset);
  if (!word || word.start >= offset || word.end <= offset) return offset;
  return side === "start" ? word.start : word.end;
}

export function snapRangeToWords(range: AbstractRange): { start: number; end: number } | null {
  const start = snapPoint(range.startContainer, range.startOffset, "start");
  const end = snapPoint(range.endContainer, range.endOffset, "end");
  if (start === range.startOffset && end === range.endOffset) return null;
  return { start, end };
}

export function snapSelectionToWords(selection: Selection, container: HTMLElement): boolean {
  if (selection.isCollapsed || selection.rangeCount !== 1) return false;
  const range = selection.getRangeAt(0);
  const { startContainer, endContainer } = range;
  if (!isTextNode(startContainer) || !isTextNode(endContainer)) return false;
  if (!container.contains(startContainer) || !container.contains(endContainer)) return false;
  const snapped = snapRangeToWords(range);
  if (!snapped) return false;
  const backward =
    selection.anchorNode === endContainer &&
    selection.anchorOffset === range.endOffset &&
    selection.focusNode === startContainer &&
    selection.focusOffset === range.startOffset;
  if (backward) selection.setBaseAndExtent(endContainer, snapped.end, startContainer, snapped.start);
  else selection.setBaseAndExtent(startContainer, snapped.start, endContainer, snapped.end);
  return true;
}

export function describePdfSelection(
  selection: Selection,
  container: HTMLElement,
  toPagePoint: ToPagePoint,
  normalize: (text: string) => string,
): PdfTextSelectionInfo | null {
  if (selection.isCollapsed || selection.rangeCount === 0) return null;
  const firstRange = selection.getRangeAt(0);
  const lastRange = selection.getRangeAt(selection.rangeCount - 1);
  const startPage = pageAt(firstRange.startContainer, firstRange.startOffset, "start", container);
  const endPage = pageAt(lastRange.endContainer, lastRange.endOffset, "end", container);
  const pages = [startPage, endPage].filter((page): page is PageAt => page !== null);
  if (pages.length === 0) return null;
  const hits: PageHit[] = [];
  for (const page of pages) {
    if (hits.some((hit) => hit.wrap === page.wrap)) continue;
    hits.push({ ...page, bounds: page.wrap.getBoundingClientRect() });
  }
  const placed: { box: ClientBox; hit: PageHit }[] = [];
  for (let index = 0; index < selection.rangeCount && placed.length < MAX_SELECTION_RECTS; index++) {
    const range = selection.getRangeAt(index);
    try {
      if (!range.intersectsNode(container)) continue;
    } catch {
      continue;
    }
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const hit = hits.find((candidate) => centredIn(candidate.bounds, rect));
      if (!hit) continue;
      placed.push({ box: rect, hit });
      if (placed.length >= MAX_SELECTION_RECTS) break;
    }
  }
  const text = collapseWhitespace(selection.toString(), normalize).slice(0, MAX_SELECTION_CHARS);
  if (placed.length === 0 || !text) return null;
  const rects: SynctexRect[] = [];
  for (const { box, hit } of placed) {
    const rect = clientBoxToPageRect(box, hit.page, hit.wrap, toPagePoint);
    if (rect && rect.width > 0 && rect.height > 0) rects.push(rect);
  }
  if (rects.length === 0) return null;
  const head = placed[0];
  const tail = placed[placed.length - 1];
  const start = toPagePoint(head.hit.wrap, head.hit.page, {
    clientX: head.box.left + 1,
    clientY: head.box.top + head.box.height / 2,
  });
  const end = toPagePoint(tail.hit.wrap, tail.hit.page, {
    clientX: tail.box.right - 1,
    clientY: tail.box.top + tail.box.height / 2,
  });
  if (!start || !end) return null;
  const boxes = placed.map(({ box }) => box);
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return {
    page: rects[0].page,
    rects,
    text,
    before: quoteContext(firstRange, startPage, "start", normalize),
    after: quoteContext(lastRange, endPage, "end", normalize),
    start,
    end,
    clientRect: { left, top, width: right - left, height: bottom - top },
  };
}

export function readPdfTextSelection(
  container: HTMLElement,
  toPagePoint: ToPagePoint,
  normalize: (text: string) => string,
): PdfTextSelectionInfo | null {
  const selection = document.getSelection();
  if (!selection) return null;
  snapSelectionToWords(selection, container);
  return describePdfSelection(selection, container, toPagePoint, normalize);
}

export function watchRegionSelect(
  container: HTMLElement,
  toPagePoint: ToPagePoint,
  onRegion: (region: PdfRegionSelectionInfo) => void,
): () => void {
  const previousCursor = container.style.cursor;
  const previousUserSelect = container.style.userSelect;
  container.style.cursor = "crosshair";
  container.style.userSelect = "none";
  container.dataset.pdfRegionSelect = "true";
  let drag: {
    page: number;
    wrap: HTMLElement;
    x: number;
    y: number;
    box: HTMLElement;
    pointerId: number;
  } | null = null;
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const boxFor = (current: { wrap: HTMLElement; x: number; y: number }, clientX: number, clientY: number) => {
    const bounds = current.wrap.getBoundingClientRect();
    const x = clamp(clientX, bounds.left, bounds.right);
    const y = clamp(clientY, bounds.top, bounds.bottom);
    const left = Math.min(current.x, x);
    const top = Math.min(current.y, y);
    const right = Math.max(current.x, x);
    const bottom = Math.max(current.y, y);
    return { left, top, right, bottom, width: right - left, height: bottom - top, bounds };
  };
  const cancel = () => {
    drag?.box.remove();
    drag = null;
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const wrap = target?.closest?.<HTMLElement>(PAGE_WRAP_SELECTOR);
    if (!wrap || !container.contains(wrap)) return;
    if (target?.closest?.(`.${MARK_BADGE_CLASS}`)) return;
    const page = Number(wrap.dataset.page);
    if (!Number.isInteger(page)) return;
    event.preventDefault();
    cancel();
    const box = document.createElement("div");
    box.className = "pdf-region-selection";
    box.setAttribute("aria-hidden", "true");
    Object.assign(box.style, {
      position: "absolute",
      zIndex: "4",
      pointerEvents: "none",
      border: `1px dashed ${MARK_COLORS.activeLine}`,
      background: MARK_COLORS.fill,
    } as Partial<CSSStyleDeclaration>);
    wrap.appendChild(box);
    drag = { page, wrap, x: event.clientX, y: event.clientY, box, pointerId: event.pointerId };
    try {
      container.setPointerCapture?.(event.pointerId);
    } catch {
      return;
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const box = boxFor(drag, event.clientX, event.clientY);
    Object.assign(drag.box.style, {
      left: `${box.left - box.bounds.left}px`,
      top: `${box.top - box.bounds.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag;
    cancel();
    const box = boxFor(current, event.clientX, event.clientY);
    if (box.width < 6 || box.height < 6) return;
    const rect = clientBoxToPageRect(box, current.page, current.wrap, toPagePoint);
    if (!rect) return;
    onRegion({
      page: current.page,
      rect,
      clientRect: { left: box.left, top: box.top, width: box.width, height: box.height },
    });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && drag) {
      event.stopPropagation();
      cancel();
    }
  };
  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    cancel();
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerUp);
    container.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", onKeyDown, true);
    container.style.cursor = previousCursor;
    container.style.userSelect = previousUserSelect;
    delete container.dataset.pdfRegionSelect;
  };
}

export interface PdfAnnotationLayer {
  badgeClass: string;
  paint: typeof paintPdfMarks;
  readSelection: typeof readPdfTextSelection;
  watchRegion: typeof watchRegionSelect;
}

export const pdfAnnotationLayer: PdfAnnotationLayer = {
  badgeClass: MARK_BADGE_CLASS,
  paint: paintPdfMarks,
  readSelection: readPdfTextSelection,
  watchRegion: watchRegionSelect,
};
