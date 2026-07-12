import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
// A wrapper worker that polyfills newer JS (Map.getOrInsert*) before loading the
// real pdf.js worker, so PDFs render on older WebViews too. `?worker&url` lets
// pdf.js manage the worker lifecycle as it does with the stock worker URL.
import workerSrc from "./pdf.worker?worker&url";
// Styles for the selectable text layer + clickable annotation (link) layer.
import "pdfjs-dist/web/pdf_viewer.css";
import { registerPdfView, clearPdfView, pageClickToBp } from "./pdfController";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

/** The word under a screen point in the PDF text layer, for word-precise inverse
 *  SyncTeX. Returns null over whitespace, an image, or when no text is hit. */
function wordAtPoint(clientX: number, clientY: number): string | null {
  const d = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const range = d.caretRangeFromPoint?.(clientX, clientY); // WebKit + Chromium
  if (range) {
    node = range.startContainer;
    offset = range.startOffset;
  } else {
    const pos = d.caretPositionFromPoint?.(clientX, clientY); // Firefox / standard
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? "";
  const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  let s = Math.min(Math.max(0, offset), text.length);
  let e = s;
  while (s > 0 && isWordChar(text[s - 1])) s--;
  while (e < text.length && isWordChar(text[e])) e++;
  const w = text.slice(s, e);
  return w.length ? w : null;
}

// Render pages within this many CSS pixels of the viewport (above and below), so
// scrolling reveals already-rasterized pages. Larger = smoother scroll, more memory.
const RENDER_MARGIN_PX = 1200;
// Hard cap on simultaneously-rasterized pages, a safety net against unbounded
// memory on very tall/zoomed documents regardless of scroll behavior.
const MAX_RENDERED_PAGES = 14;

interface RenderState {
  renderScale: number;
  tasks: pdfjsLib.RenderTask[];
}

/** Page arrangement: one column (continuous) or two-up spreads (both scroll). */
export type PdfLayout = "single" | "double";

export interface PdfViewerProps {
  data: Uint8Array | null;
  scale: number;
  /** Inverse SyncTeX: invoked on Cmd/Ctrl-click with (page, x, y) in PDF bp, plus
   *  the word under the click (from the text layer) to place the cursor precisely. */
  onInverse?: (page: number, x: number, y: number, word?: string) => void;
  /** Reports the page at the top of the viewport and the total page count, so a
   *  toolbar can show "N of M" and drive prev/next/jump. */
  onPageChange?: (current: number, total: number) => void;
  /** Continuous single column (default) or two pages side by side. */
  layout?: PdfLayout;
  /** Open an external link (http/mailto/tel) from a PDF annotation, e.g. in the
   *  system browser. Without it, links fall back to the anchor's default. */
  onOpenLink?: (url: string) => void;
}

/** Imperative handle: scroll the viewer to a 1-based page number. */
export interface PdfViewerHandle {
  gotoPage: (n: number) => void;
}

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer(
  { data, scale, onInverse, onPageChange, layout = "single", onOpenLink },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onInverseRef = useRef(onInverse);
  onInverseRef.current = onInverse;
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;
  // Last page we reported, so scroll churn doesn't spam setState.
  const currentPageRef = useRef(1);

  // Bumped on every (re)load and on unmount, so async work from a superseded
  // document aborts instead of painting into the current one.
  const loadSeqRef = useRef(0);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  // Page number -> its persistent wrapper element (a lightweight placeholder that
  // always exists so scroll geometry and SyncTeX work even when unrasterized).
  const wrapsRef = useRef<Map<number, HTMLElement>>(new Map());
  // Page number -> its live rasterization (canvas/text/annotation + render tasks).
  const renderedRef = useRef<Map<number, RenderState>>(new Map());
  // Pages currently within the observer's margin (candidates to keep rendered).
  const visibleRef = useRef<Set<number>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  // Page dimensions at scale 1 (from page 1), for sizing not-yet-rendered pages.
  const baseDimsRef = useRef<{ w: number; h: number }>({ w: 612, h: 792 });
  // Debounce for crisp re-rasterization: zoom resizes instantly (cheap) and only
  // re-renders at full resolution once the scale settles, so pinch stays smooth.
  const rasterTimerRef = useRef<number | null>(null);

  // Minimal link service: open external links in the system browser, ignore
  // internal destinations (no in-app page router).
  const linkServiceRef = useRef<any>({
    externalLinkEnabled: true,
    externalLinkRel: "noopener noreferrer nofollow",
    externalLinkTarget: 2, // BLANK
    isPageVisible: () => true,
    isPageHidden: () => false,
    getDestinationHash: () => "#",
    getAnchorUrl: (hash: string) => hash,
    navigateTo: () => {},
    addLinkAttributes: (link: HTMLAnchorElement) => {
      try {
        link.rel = "noopener noreferrer nofollow";
        link.target = "_blank";
      } catch {
        /* ignore */
      }
    },
  });

  // Drop a page's rasterization (canvas/text/annotation layers) and cancel its
  // in-flight render, keeping the placeholder wrapper (sized) so layout holds.
  const unrenderPage = useCallback((pageNo: number) => {
    const st = renderedRef.current.get(pageNo);
    if (!st) return;
    for (const t of st.tasks) {
      try {
        t.cancel();
      } catch {
        /* already settled */
      }
    }
    renderedRef.current.delete(pageNo);
    const wrap = wrapsRef.current.get(pageNo);
    if (wrap) {
      for (const n of wrap.querySelectorAll(".pdf-canvas, .textLayer, .annotationLayer")) n.remove();
      const s = scaleRef.current;
      wrap.style.width = `${Math.floor(baseDimsRef.current.w * s)}px`;
      wrap.style.height = `${Math.floor(baseDimsRef.current.h * s)}px`;
    }
  }, []);

  // Evict rasterized pages farthest from the viewport until under the cap.
  const enforceCap = useCallback(() => {
    if (renderedRef.current.size <= MAX_RENDERED_PAGES) return;
    const visible = visibleRef.current;
    const rendered = [...renderedRef.current.keys()];
    const center =
      visible.size > 0 ? [...visible].reduce((a, b) => a + b, 0) / visible.size : rendered[0];
    // Evict the off-screen rendered pages farthest from the viewport first.
    const evictable = rendered
      .filter((p) => !visible.has(p))
      .sort((a, b) => Math.abs(b - center) - Math.abs(a - center));
    for (const p of evictable) {
      if (renderedRef.current.size <= MAX_RENDERED_PAGES) break;
      unrenderPage(p);
    }
  }, [unrenderPage]);

  // Rasterize one page at the given scale (skips if already current). Idempotent
  // and cancellation-safe.
  const renderPage = useCallback(async (pageNo: number, renderScale: number) => {
    const doc = docRef.current;
    const wrap = wrapsRef.current.get(pageNo);
    if (!doc || !wrap) return;
    const existing = renderedRef.current.get(pageNo);
    if (existing && existing.renderScale === renderScale) return; // already correct
    if (existing) {
      for (const t of existing.tasks) {
        try {
          t.cancel();
        } catch {
          /* ignore */
        }
      }
      for (const n of wrap.querySelectorAll(".pdf-canvas, .textLayer, .annotationLayer")) n.remove();
    }

    const seq = loadSeqRef.current;
    const tasks: pdfjsLib.RenderTask[] = [];
    renderedRef.current.set(pageNo, { renderScale, tasks });

    try {
      const page = await doc.getPage(pageNo);
      if (seq !== loadSeqRef.current || renderedRef.current.get(pageNo)?.tasks !== tasks) return;

      const viewport = page.getViewport({ scale: renderScale });
      wrap.style.width = `${Math.floor(viewport.width)}px`;
      wrap.style.height = `${Math.floor(viewport.height)}px`;
      wrap.style.setProperty("--scale-factor", String(renderScale));

      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement("canvas");
      canvas.className = "pdf-canvas";
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;
      wrap.appendChild(canvas);

      const textDiv = document.createElement("div");
      textDiv.className = "textLayer";
      textDiv.style.position = "absolute";
      textDiv.style.inset = "0";
      textDiv.style.overflow = "hidden";
      wrap.appendChild(textDiv);

      const annotDiv = document.createElement("div");
      annotDiv.className = "annotationLayer";
      annotDiv.style.position = "absolute";
      annotDiv.style.inset = "0";
      wrap.appendChild(annotDiv);

      const renderTask = page.render({ canvas, canvasContext: ctx, viewport, transform });
      tasks.push(renderTask);
      try {
        await renderTask.promise;
      } catch (err) {
        if (String(err).includes("RenderingCancelled")) return;
        throw err;
      }
      if (seq !== loadSeqRef.current) return;

      // Selectable text layer (best-effort; never blocks the page).
      try {
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: page.streamTextContent(),
          container: textDiv,
          viewport,
        } as any);
        await textLayer.render();
      } catch {
        /* text selection is a non-fatal enhancement */
      }

      // Links/annotations (best-effort).
      try {
        const annotations = await page.getAnnotations({ intent: "display" });
        if (seq !== loadSeqRef.current) return;
        const annotationLayer = new pdfjsLib.AnnotationLayer({
          div: annotDiv,
          linkService: linkServiceRef.current,
          annotationStorage: doc.annotationStorage,
          page,
          viewport,
        } as any);
        await annotationLayer.render({
          viewport,
          div: annotDiv,
          annotations,
          page,
          linkService: linkServiceRef.current,
          annotationStorage: doc.annotationStorage,
          renderForms: false,
          enableScripting: false,
        } as any);
        annotDiv.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
          const href = a.getAttribute("href") ?? "";
          if (/^(https?:|mailto:|tel:)/i.test(href)) {
            a.addEventListener("click", (e) => {
              const open = onOpenLinkRef.current;
              if (!open) return; // no injected opener: keep the anchor's default
              e.preventDefault();
              open(href);
            });
          }
        });
      } catch {
        /* annotation rendering is a non-fatal enhancement */
      }
    } catch (err) {
      if (!String(err).includes("RenderingCancelled")) {
        const container = containerRef.current;
        if (container && renderedRef.current.size === 0) {
          container.textContent = `Failed to render PDF: ${String(err)}`;
        }
      }
      renderedRef.current.delete(pageNo);
    }
  }, []);

  // Forward SyncTeX may target an off-screen page; render it on demand.
  const ensurePageRendered = useCallback(
    (pageNo: number) => {
      void renderPage(pageNo, scaleRef.current);
    },
    [renderPage]
  );

  // The "current" page is the one straddling the top of the viewport. We only
  // scan pages the observer already flagged visible (a handful), so this is cheap
  // even for a 400+ page book.
  const emitCurrentPage = useCallback(() => {
    const scrollParent = containerRef.current?.parentElement;
    const doc = docRef.current;
    if (!scrollParent || !doc) return;
    const parentTop = scrollParent.getBoundingClientRect().top;
    const pages = [...visibleRef.current].sort((a, b) => a - b);
    let current = pages[0] ?? 1;
    for (const p of pages) {
      const wrap = wrapsRef.current.get(p);
      if (!wrap) continue;
      // The first visible page whose bottom is still below the viewport top is
      // the top-most page on screen. Works for one- and two-column layouts (in a
      // two-up spread this reports the left page of the pair).
      if (wrap.getBoundingClientRect().bottom > parentTop + 4) {
        current = p;
        break;
      }
    }
    if (current !== currentPageRef.current) {
      currentPageRef.current = current;
      onPageChangeRef.current?.(current, doc.numPages);
    }
  }, []);

  // Scroll the viewer to a page (prev/next/jump from the toolbar), rendering it
  // on demand since virtualization may not have rasterized it yet.
  useImperativeHandle(
    ref,
    () => ({
      gotoPage: (n: number) => {
        const doc = docRef.current;
        if (!doc) return;
        const clamped = Math.max(1, Math.min(doc.numPages, Math.floor(n)));
        const wrap = wrapsRef.current.get(clamped);
        if (!wrap) return;
        void renderPage(clamped, scaleRef.current);
        wrap.scrollIntoView({ block: "start" });
      },
    }),
    [renderPage]
  );

  // Build the placeholder layout for every page and start observing them.
  const buildLayout = useCallback(
    async (doc: pdfjsLib.PDFDocumentProxy) => {
      const container = containerRef.current;
      if (!container) return;
      const seq = loadSeqRef.current;

      container.innerHTML = "";
      wrapsRef.current.clear();
      renderedRef.current.clear();
      visibleRef.current.clear();

      // Base dimensions from page 1 (most PDFs are uniform; per-page rendering
      // corrects the exact size when a page is rasterized).
      try {
        const first = await doc.getPage(1);
        if (seq !== loadSeqRef.current) return;
        const vp = first.getViewport({ scale: 1 });
        baseDimsRef.current = { w: vp.width, h: vp.height };
      } catch {
        /* keep the US-Letter default */
      }

      const s = scaleRef.current;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const p = Number((entry.target as HTMLElement).dataset.page);
            if (!p) continue;
            if (entry.isIntersecting) {
              visibleRef.current.add(p);
              void renderPage(p, scaleRef.current);
            } else {
              visibleRef.current.delete(p);
              unrenderPage(p);
            }
          }
          enforceCap();
        },
        { root: container.parentElement ?? null, rootMargin: `${RENDER_MARGIN_PX}px 0px` }
      );
      observerRef.current = observer;

      for (let p = 1; p <= doc.numPages; p++) {
        const wrap = document.createElement("div");
        // Spacing between pages comes from the container's `gap`, not a per-page
        // margin, so single-column and two-up grids stay evenly spaced.
        wrap.className =
          "relative shadow-md ring-1 ring-black/5 rounded-sm overflow-hidden bg-white";
        wrap.dataset.page = String(p);
        wrap.style.width = `${Math.floor(baseDimsRef.current.w * s)}px`;
        wrap.style.height = `${Math.floor(baseDimsRef.current.h * s)}px`;
        wrap.style.setProperty("--scale-factor", String(s));
        wrap.addEventListener("click", (ev: MouseEvent) => {
          if (!(ev.metaKey || ev.ctrlKey)) return;
          if ((ev.target as HTMLElement)?.closest?.("a")) return;
          const hit = pageClickToBp(wrap, p, ev);
          if (hit) {
            const word = wordAtPoint(ev.clientX, ev.clientY);
            onInverseRef.current?.(hit.page, hit.x, hit.y, word ?? undefined);
          }
        });
        container.appendChild(wrap);
        wrapsRef.current.set(p, wrap);
        observer.observe(wrap);
      }

      // Render the first page eagerly: occluded windows (CI, restored
      // minimized apps) suspend IntersectionObserver delivery, and the
      // initial view must not depend on it. The observer corrects the
      // visible set as soon as it fires.
      visibleRef.current.add(1);
      void renderPage(1, s);

      registerPdfView({
        pages: [...wrapsRef.current.entries()].map(([pageNo, el]) => ({ pageNo, el })),
        scale: s,
        ensurePageRendered,
      });

      currentPageRef.current = 1;
      onPageChangeRef.current?.(1, doc.numPages);
    },
    [renderPage, unrenderPage, enforceCap, ensurePageRendered]
  );

  // Load (parse) the document when the PDF bytes change - NOT on zoom.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !data) return;

    loadSeqRef.current++;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    let cancelled = false;

    (async () => {
      try {
        loadingTask = pdfjsLib.getDocument({ data: data.slice() });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        docRef.current = doc;
        await buildLayout(doc);
      } catch (e) {
        if (!cancelled) container.textContent = `Failed to render PDF: ${String(e)}`;
      }
    })();

    return () => {
      cancelled = true;
      loadSeqRef.current++;
      observerRef.current?.disconnect();
      observerRef.current = null;
      for (const st of renderedRef.current.values()) {
        for (const t of st.tasks) {
          try {
            t.cancel();
          } catch {
            /* ignore */
          }
        }
      }
      renderedRef.current.clear();
      wrapsRef.current.clear();
      visibleRef.current.clear();
      clearPdfView();
      docRef.current = null;
      if (container) container.innerHTML = "";
      loadingTask?.destroy().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, buildLayout]);

  // Re-render on zoom without reloading. Rasterizing pages is expensive, so a
  // pinch that fires dozens of scale changes a second must NOT rasterize on each
  // one, or the main thread stalls and the gesture stutters (one jump per pinch).
  // Instead: resize every placeholder and CSS-stretch the already-rendered
  // canvases instantly (cheap, smooth), then re-rasterize crisply once the scale
  // settles (debounced).
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    scaleRef.current = scale;
    const w = Math.floor(baseDimsRef.current.w * scale);
    const h = Math.floor(baseDimsRef.current.h * scale);

    // Instant + cheap: keep scroll geometry correct and scale the existing
    // bitmaps so the zoom tracks the gesture (they sharpen a moment later).
    for (const [, wrap] of wrapsRef.current) {
      wrap.style.width = `${w}px`;
      wrap.style.height = `${h}px`;
      wrap.style.setProperty("--scale-factor", String(scale));
      const canvas = wrap.querySelector<HTMLElement>(".pdf-canvas");
      if (canvas) {
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
    }

    // Trailing: re-rasterize the visible pages at full resolution once zooming
    // stops, drop off-screen pages left at the old scale, and refresh SyncTeX's
    // scale (none of which needs to run on every event of a pinch).
    if (rasterTimerRef.current) window.clearTimeout(rasterTimerRef.current);
    rasterTimerRef.current = window.setTimeout(() => {
      const target = scaleRef.current;
      for (const p of [...renderedRef.current.keys()]) {
        if (!visibleRef.current.has(p)) unrenderPage(p);
      }
      for (const p of visibleRef.current) void renderPage(p, target);
      registerPdfView({
        pages: [...wrapsRef.current.entries()].map(([pageNo, el]) => ({ pageNo, el })),
        scale: target,
        ensurePageRendered,
      });
    }, 120);

    return () => {
      if (rasterTimerRef.current) window.clearTimeout(rasterTimerRef.current);
    };
  }, [scale, renderPage, unrenderPage, ensurePageRendered]);

  // Track the page at the top of the viewport as the user scrolls (rAF-throttled).
  useEffect(() => {
    const scrollParent = containerRef.current?.parentElement;
    if (!scrollParent) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        emitCurrentPage();
      });
    };
    scrollParent.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollParent.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [emitCurrentPage, data]);

  // Crosshair cursor only while ⌘/Ctrl is held - the SyncTeX-click hint.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const set = (on: boolean) => {
      container.style.cursor = on ? "crosshair" : "";
    };
    const down = (e: KeyboardEvent) => set(e.metaKey || e.ctrlKey);
    const up = (e: KeyboardEvent) => set(e.metaKey || e.ctrlKey);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [data]);

  if (!data) return null;
  // The page wrappers are appended imperatively; switching the container between
  // a single column and a two-column grid re-flows them into spreads with no
  // re-render of the pages. (React only patches this element's className; the
  // imperative children are outside its vdom and are left untouched.)
  return (
    <div
      ref={containerRef}
      className={
        layout === "double"
          ? "grid grid-cols-[auto_auto] content-start justify-center gap-4 p-4"
          : "flex flex-col items-center gap-4 p-4"
      }
    />
  );
});
