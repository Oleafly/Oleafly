export interface SynctexRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfTextRun {
  str: string;
  x: number;
  top: number;
  width: number;
  height: number;
  hasEOL?: boolean;
}

export interface PdfPageGeometry {
  viewBox: number[];
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

let logMiss: (scope: string, message: string) => void = () => {};
/**
 * Centres `target` in its own scroll container.
 *
 * `scrollIntoView` scrolls every scrollable ancestor, so inside a docked
 * preview it drags the whole app window along with the pane.
 */
function scrollWithinPane(target: HTMLElement): void {
  let scroller: HTMLElement | null = target.parentElement;
  while (scroller) {
    const style = getComputedStyle(scroller);
    if (
      /(auto|scroll|overlay)/u.test(style.overflowY) &&
      scroller.scrollHeight > scroller.clientHeight
    ) {
      break;
    }
    scroller = scroller.parentElement;
  }
  if (!scroller) return;
  const targetBox = target.getBoundingClientRect();
  const scrollerBox = scroller.getBoundingClientRect();
  const delta =
    targetBox.top -
    scrollerBox.top -
    (scroller.clientHeight - targetBox.height) / 2;
  scroller.scrollTo({
    top: Math.max(0, scroller.scrollTop + delta),
    behavior: "smooth",
  });
}

export function setPdfLogger(fn: (scope: string, message: string) => void) {
  logMiss = fn;
}

interface PageEntry {
  pageNo: number;
  el: HTMLElement;
}

let pages: PageEntry[] = [];
let scale = 1;
let ensurePageRendered: ((pageNo: number) => void) | null = null;
let pageGeometry: ((pageNo: number) => PdfPageGeometry | undefined) | null = null;
let pageText: ((pageNo: number) => Promise<PdfTextRun[] | null>) | null = null;

export function registerPdfView(state: {
  pages: PageEntry[];
  scale: number;
  ensurePageRendered?: (pageNo: number) => void;
  pageGeometry?: (pageNo: number) => PdfPageGeometry | undefined;
  pageText?: (pageNo: number) => Promise<PdfTextRun[] | null>;
}) {
  pages = state.pages;
  scale = state.scale;
  ensurePageRendered = state.ensurePageRendered ?? null;
  pageGeometry = state.pageGeometry ?? null;
  pageText = state.pageText ?? null;
}

export function clearPdfView() {
  pages = [];
  ensurePageRendered = null;
  pageGeometry = null;
  pageText = null;
}

export function pdfPageText(pageNo: number): Promise<PdfTextRun[] | null> {
  return pageText?.(pageNo) ?? Promise.resolve(null);
}

/**
 * A SyncTeX box, in points from the top-left of the page as TeX laid it out,
 * as a box on the shown page at scale 1. The page's own `/Rotate` and the
 * viewer's rotate control both turn the shown page; SyncTeX knows neither.
 */
function shownBox(rect: SynctexRect, minHeight: number) {
  const height = Math.max(rect.height, minHeight);
  const geometry = pageGeometry?.(rect.page);
  if (!geometry) return { left: rect.x, top: rect.y, width: rect.width, height };
  const [left, , , top] = geometry.viewBox;
  const [a, b] = geometry.convertToViewportPoint(left + rect.x, top - rect.y);
  const [c, d] = geometry.convertToViewportPoint(left + rect.x + rect.width, top - rect.y - height);
  return { left: Math.min(a, c), top: Math.min(b, d), width: Math.abs(c - a), height: Math.abs(d - b) };
}

export function gotoRect(rect: SynctexRect, attempt = 0) {
  const entry = pages.find((p) => p.pageNo === rect.page);
  const wrap = entry?.el;
  if (!wrap) {
    if (attempt < 20) {
      setTimeout(() => gotoRect(rect, attempt + 1), 150);
      return;
    }
    logMiss(
      "synctex forward",
      `no page element for page ${rect.page} (have pages: ${pages.map((p) => p.pageNo).join(",") || "none"})`
    );
    return;
  }

  ensurePageRendered?.(rect.page);

  wrap.style.position = "relative";

  wrap.querySelector(".ll-synctex-hl")?.remove();

  const hl = document.createElement("div");
  hl.className = "ll-synctex-hl";
  const box = shownBox(rect, 8);
  Object.assign(hl.style, {
    position: "absolute",
    left: `${box.left * scale}px`,
    top: `${box.top * scale}px`,
    width: `${box.width * scale}px`,
    height: `${box.height * scale}px`,
    background: "rgba(37, 99, 235, 0.28)",
    border: "1px solid rgb(37, 99, 235)",
    borderRadius: "2px",
    pointerEvents: "none",
    zIndex: "30",
  } as Partial<CSSStyleDeclaration>);
  wrap.appendChild(hl);

  scrollWithinPane(hl);
  hl.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 120,
    fill: "forwards",
  });
  window.setTimeout(() => {
    const a = hl.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 450,
      fill: "forwards",
    });
    a.onfinish = () => hl.remove();
  }, 1800);
}

export async function gotoPdfPage(page: number, waitMs = 0): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, waitMs);
  for (;;) {
    const entry = pages.find((p) => p.pageNo === page);
    if (entry) {
      ensurePageRendered?.(page);
      scrollWithinPane(entry.el);
      return true;
    }
    if (Date.now() >= deadline) {
      logMiss(
        "pdf goto page",
        `no page element for page ${page} (have pages: ${pages.map((p) => p.pageNo).join(",") || "none"})`
      );
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export function pageClickToBp(
  el: HTMLElement,
  pageNo: number,
  e: { clientX: number; clientY: number }
): { page: number; x: number; y: number } | null {
  const rect = el.getBoundingClientRect();
  const x = (e.clientX - rect.left) / scale;
  const y = (e.clientY - rect.top) / scale;
  if (x < 0 || y < 0 || x > rect.width / scale || y > rect.height / scale) {
    return null;
  }
  const geometry = pageGeometry?.(pageNo);
  if (!geometry) return { page: pageNo, x, y };
  const [pdfX, pdfY] = geometry.convertToPdfPoint(x, y);
  return { page: pageNo, x: pdfX - geometry.viewBox[0], y: geometry.viewBox[3] - pdfY };
}
