export interface SynctexRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
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
  // Always present even before the page is rasterized, so SyncTeX positioning
  // works against a virtualized page.
  el: HTMLElement;
}

let pages: PageEntry[] = [];
let scale = 1;
// Set by the active PdfViewer; used by forward SyncTeX to force-render a page
// that virtualization has not rendered yet.
let ensurePageRendered: ((pageNo: number) => void) | null = null;

export function registerPdfView(state: {
  pages: PageEntry[];
  scale: number;
  ensurePageRendered?: (pageNo: number) => void;
}) {
  pages = state.pages;
  scale = state.scale;
  ensurePageRendered = state.ensurePageRendered ?? null;
}

export function clearPdfView() {
  pages = [];
  ensurePageRendered = null;
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

  // The page may not be rasterized yet (virtualized); ask the viewer to render
  // it. Positioning below is geometric (off the wrapper), so it works regardless.
  ensurePageRendered?.(rect.page);

  wrap.style.position = "relative";

  wrap.querySelector(".ll-synctex-hl")?.remove();

  const hl = document.createElement("div");
  hl.className = "ll-synctex-hl";
  const h = Math.max(rect.height, 8) * scale;
  Object.assign(hl.style, {
    position: "absolute",
    left: `${rect.x * scale}px`,
    top: `${rect.y * scale}px`,
    width: `${rect.width * scale}px`,
    height: `${h}px`,
    background: "rgba(37, 99, 235, 0.28)",
    border: "1px solid rgb(37, 99, 235)",
    boxShadow: "0 0 0 1px rgba(37, 99, 235, 0.2)",
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
  return { page: pageNo, x, y };
}
