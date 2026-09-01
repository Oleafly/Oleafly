import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type {
  PDFLinkService,
  StructTreeLayerBuilder,
} from "pdfjs-dist/web/pdf_viewer.mjs";
// A wrapper worker that polyfills newer JS (Map.getOrInsert*) before loading the
// real pdf.js worker, so PDFs render on older WebViews too. `?worker&url` lets
// pdf.js manage the worker lifecycle as it does with the stock worker URL.
import workerSrc from "./pdf.worker?worker&url";
// Styles for the selectable text layer + clickable annotation (link) layer.
import "pdfjs-dist/web/pdf_viewer.css";
import { registerPdfView, clearPdfView, pageClickToBp } from "./pdfController";
import { installMainThreadPdfWorker } from "./mainThreadWorker";
import { PdfTextAccessibilityManager } from "./pdfAccessibility";
import {
  applyPdfLayerViewport,
  applyPdfPlaceholderViewport,
  releasePdfRenderNodes,
  visitPdfPlaceholderBatch,
} from "./pdfLayerGeometry";
import { createPdfLoadAttempts } from "./pdfLoadStrategy";
import {
  loadPdfPageViewport,
  type PdfPageGeometryScan,
  type PdfPageViewport,
  scanPdfPageViewports,
} from "./pdfPageGeometry";
import { calibratePdfTextLayerWidths } from "./pdfTextLayerGeometry";
import { registerPdfTextSelection } from "./pdfTextSelection";
import {
  normalizePdfOutline,
  type PdfOutlineItem,
  type PdfOutlineTarget,
} from "./pdfOutline";
import {
  searchPdfDocument,
  type PdfSearchMatch,
  type PdfSearchProgress,
} from "./pdfSearch";
import { safePdfExternalUrl } from "./pdfSecurity";
import { createPdfScreenReaderLayer } from "./pdfScreenReader";
import { closestMatchingElement } from "./textHit";
import { textTargetAtPoint, wordAtPoint, wordForTextTarget } from "./textTarget";
import type { PreviewTextTarget } from "./typingEcho";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

// Last-resort recovery for a worker subsystem wedged by a long-occluded
// WKWebView. This is intentionally session-wide: once real worker creation is
// no longer viable, the main-thread loopback worker keeps preview usable.
let mainThreadWorkerInstall: Promise<void> | null = null;
type PdfViewerRuntime = typeof import("pdfjs-dist/web/pdf_viewer.mjs");
type PdfDownloadManager = InstanceType<PdfViewerRuntime["DownloadManager"]>;
let pdfViewerRuntimePromise: Promise<PdfViewerRuntime> | null = null;
const PDF_WORKER_LOAD_TIMEOUT_MS = 10_000;
const TEXT_CONTENT_PARAMS = {
  includeMarkedContent: true,
  disableNormalization: true,
} as const;

const PDF_SEARCH_PROGRESS_INTERVAL_MS = 100;

function normalizeRotation(value: number): 0 | 90 | 180 | 270 {
  return (((Math.round(value / 90) * 90) % 360 + 360) % 360) as
    | 0
    | 90
    | 180
    | 270;
}

class PdfPasswordRequiredError extends Error {
  readonly incorrect: boolean;

  constructor(incorrect: boolean) {
    super(
      incorrect
        ? "The PDF password was not accepted."
        : "This PDF is password protected.",
    );
    this.name = "PdfPasswordRequiredError";
    this.incorrect = incorrect;
  }
}

function pdfLoadFailure(
  error: unknown,
): {
  status: Extract<
    PdfLoadStatus,
    | "password_required"
    | "invalid"
    | "unavailable"
    | "error"
  >;
  message: string;
} {
  if (error instanceof PdfPasswordRequiredError) {
    return {
      status: "password_required",
      message: error.message,
    };
  }
  const name =
    error instanceof Error
      ? error.name
      : typeof error === "object" && error && "name" in error
        ? String(error.name)
        : "";
  if (
    name === "InvalidPDFException" ||
    name === "FormatError" ||
    /invalid pdf|corrupt|bad xref|missing pdf header/iu.test(String(error))
  ) {
    return {
      status: "invalid",
      message:
        "The compiled output is not a valid PDF. Recompile or inspect the compile log.",
    };
  }
  if (
    name === "MissingPDFException" ||
    name === "UnexpectedResponseException" ||
    /worker setup|main-thread pdf worker|failed to fetch/iu.test(String(error))
  ) {
    return {
      status: "unavailable",
      message:
        "The PDF renderer is unavailable in this window. Retry after restoring the window or restarting the app.",
    };
  }
  return {
    status: "error",
    message:
      "The PDF could not be loaded. Recompile the current revision and try again.",
  };
}

async function forceMainThreadWorker(): Promise<void> {
  if (!mainThreadWorkerInstall) {
    mainThreadWorkerInstall = installMainThreadPdfWorker().catch((error) => {
      mainThreadWorkerInstall = null;
      throw error;
    });
  }
  await mainThreadWorkerInstall;
}

function loadPdfViewerRuntime(): Promise<PdfViewerRuntime> {
  return (pdfViewerRuntimePromise ??= import("pdfjs-dist/web/pdf_viewer.mjs"));
}

function destroyPdfWorker(worker: pdfjsLib.PDFWorker): void {
  try {
    worker.destroy();
  } catch {
    /* already destroyed */
  }
}

async function createPdfWorker(signal: AbortSignal): Promise<pdfjsLib.PDFWorker> {
  const usingMainThread = mainThreadWorkerInstall !== null;
  if (mainThreadWorkerInstall) {
    await mainThreadWorkerInstall;
  }
  const worker = new pdfjsLib.PDFWorker();
  let rejectAborted: ((reason: DOMException) => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = reject;
  });
  const onAbort = () => {
    destroyPdfWorker(worker);
    rejectAborted?.(new DOMException("PDF load cancelled", "AbortError"));
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    await withTimeout(
      Promise.race([worker.promise, aborted]),
      PDF_WORKER_LOAD_TIMEOUT_MS,
      usingMainThread ? "main-thread PDF worker setup" : "PDF worker setup",
    );
    if (signal.aborted) {
      throw new DOMException("PDF load cancelled", "AbortError");
    }
    return worker;
  } catch (error) {
    destroyPdfWorker(worker);
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

type PageTextContent = Awaited<ReturnType<pdfjsLib.PDFPageProxy["getTextContent"]>>;
const probedPageText = new WeakMap<pdfjsLib.PDFDocumentProxy, PageTextContent>();

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// A pdf.js worker that wedges mid-session makes text calls hang or return empty
// while the canvas still renders (pdf.js has no timeout for this and no
// recovery). Probe page 1's text pipe, time-boxed, and throw when it is empty or
// hangs so the caller can reload on a fresh worker. This runs only for documents
// we expect to have text; image/figure projects skip the probe entirely (the
// `expectText` gate in the load ladder), so a legitimately text-less page never
// triggers the main-thread fallback and its session-wide downgrade.
async function probePageText(doc: pdfjsLib.PDFDocumentProxy): Promise<PageTextContent | null> {
  if (doc.numPages < 1) return null;
  const page = await withTimeout(doc.getPage(1), 8_000, "text probe page");
  try {
    const tc = await withTimeout(
      page.getTextContent(TEXT_CONTENT_PARAMS),
      8_000,
      "text probe",
    );
    if (!tc.items.some((it) => "str" in it && it.str.trim().length > 0)) {
      throw new Error("text pipe returned empty");
    }
    return tc;
  } finally {
    page.cleanup();
  }
}

// Render pages within this many CSS pixels of the viewport (above and below), so
// scrolling reveals already-rasterized pages. Larger = smoother scroll, more memory.
const RENDER_MARGIN_PX = 1200;
// Hard cap on simultaneously-rasterized pages, a safety net against unbounded
// memory on very tall/zoomed documents regardless of scroll behavior.
const MAX_RENDERED_PAGES = 14;
const PLACEHOLDER_ZOOM_BATCH_SIZE = 32;
const PDF_SPREAD_GAP_PX = 16;
const PDF_VIEWPORT_PADDING_PX = 32;
const PENDING_PAGE_VIEWPORT = {
  width: 640,
  height: 820,
  scale: 1,
  userUnit: 1,
  rotation: 0,
} as const;

function pendingPageViewport(rotation: PdfRotation) {
  return rotation === 90 || rotation === 270
    ? {
        ...PENDING_PAGE_VIEWPORT,
        width: PENDING_PAGE_VIEWPORT.height,
        height: PENDING_PAGE_VIEWPORT.width,
        rotation,
      }
    : { ...PENDING_PAGE_VIEWPORT, rotation };
}

interface RenderState {
  renderScale: number;
  tasks: pdfjsLib.RenderTask[];
  textLayer: pdfjsLib.TextLayer | null;
  renderedTextLayer: PdfRenderedTextLayer | null;
  annotationLayer: pdfjsLib.AnnotationLayer | null;
  accessibilityManager: PdfTextAccessibilityManager | null;
  structTreeLayer: StructTreeLayerBuilder | null;
  screenReaderLayer: HTMLElement | null;
  page: pdfjsLib.PDFPageProxy | null;
  removeTextSelection: (() => void) | null;
  nodes: HTMLElement[];
  searchNodes: HTMLElement[];
}

function setPdfScreenReaderWrapStyle(
  wrap: HTMLElement,
  active: boolean,
): void {
  wrap.dataset.pdfScreenReader = active ? "true" : "false";
  wrap.classList.toggle("rounded-sm", !active);
  wrap.classList.toggle("rounded-xl", active);
  wrap.classList.toggle("bg-white", !active);
  wrap.classList.toggle("bg-background", active);
  wrap.classList.toggle("ring-black/5", !active);
  wrap.classList.toggle("ring-white/10", active);
  if (active) {
    if (wrap.style.height && wrap.style.height !== "auto") {
      wrap.dataset.pdfVisualHeight = wrap.style.height;
    }
    wrap.style.minHeight = wrap.dataset.pdfVisualHeight ?? "";
    wrap.style.height = "auto";
  } else {
    if (wrap.style.height === "auto" && wrap.dataset.pdfVisualHeight) {
      wrap.style.height = wrap.dataset.pdfVisualHeight;
    }
    wrap.style.minHeight = "";
    delete wrap.dataset.pdfVisualHeight;
  }
}

function clearPdfSearchHighlights(state: RenderState): void {
  for (const node of state.searchNodes) node.remove();
  state.searchNodes.length = 0;
}

function cancelRenderState(state: RenderState): void {
  clearPdfSearchHighlights(state);
  state.removeTextSelection?.();
  state.removeTextSelection = null;
  try {
    state.annotationLayer?.destroy();
  } catch {
    /* already destroyed */
  }
  state.annotationLayer = null;
  state.structTreeLayer?.hide();
  state.structTreeLayer = null;
  state.screenReaderLayer?.remove();
  state.screenReaderLayer = null;
  state.accessibilityManager?.disable();
  state.accessibilityManager = null;
  try {
    state.textLayer?.cancel();
  } catch {
    /* already settled */
  }
  state.textLayer = null;
  state.renderedTextLayer = null;
  for (const task of state.tasks) {
    try {
      task.cancel();
    } catch {
      /* already settled */
    }
  }
  state.tasks.length = 0;
  try {
    state.page?.cleanup();
  } catch {
    /* page resources are already released */
  }
  state.page = null;
  releasePdfRenderNodes(state.nodes);
}

function firstTextNode(element: HTMLElement): Text | null {
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  );
  const node = walker.nextNode();
  return node instanceof Text ? node : null;
}

function paintPdfSearchHighlights(
  wrap: HTMLElement,
  state: RenderState,
  textDivs: HTMLElement[],
  matches: Array<{ match: PdfSearchMatch; index: number }>,
  activeIndex: number,
): void {
  clearPdfSearchHighlights(state);
  if (!matches.length) return;
  const wrapRect = wrap.getBoundingClientRect();
  for (const { match, index } of matches) {
    const first = textDivs[match.startItem];
    const last = textDivs[match.endItem];
    if (!first || !last) continue;
    const firstNode = firstTextNode(first);
    const lastNode = firstTextNode(last);
    if (!firstNode || !lastNode) continue;
    const range = document.createRange();
    try {
      range.setStart(
        firstNode,
        Math.max(0, Math.min(firstNode.length, match.startOffset)),
      );
      range.setEnd(
        lastNode,
        Math.max(0, Math.min(lastNode.length, match.endOffset)),
      );
      for (const rect of range.getClientRects()) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        const marker = document.createElement("div");
        marker.className =
          index === activeIndex
            ? "pdf-search-highlight pdf-search-highlight-current"
            : "pdf-search-highlight";
        marker.setAttribute("aria-hidden", "true");
        marker.hidden = wrap.dataset.pdfScreenReader === "true";
        Object.assign(marker.style, {
          position: "absolute",
          left: `${rect.left - wrapRect.left}px`,
          top: `${rect.top - wrapRect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          pointerEvents: "none",
          zIndex: "2",
          borderRadius: "2px",
          background:
            index === activeIndex
              ? "rgba(245, 158, 11, 0.56)"
              : "rgba(250, 204, 21, 0.32)",
          boxShadow:
            index === activeIndex
              ? "0 0 0 1px rgba(180, 83, 9, 0.82)"
              : "none",
        } as Partial<CSSStyleDeclaration>);
        wrap.appendChild(marker);
        state.searchNodes.push(marker);
      }
    } catch {
      // A virtualized text layer may be released while range geometry is
      // resolving. The next page render/search navigation repaints it.
    } finally {
      range.detach();
    }
  }
}

export function prioritizePdfPages(
  pages: Iterable<number>,
  focusPage: number,
  limit = MAX_RENDERED_PAGES,
): number[] {
  return [...pages]
    .sort((a, b) => Math.abs(a - focusPage) - Math.abs(b - focusPage) || a - b)
    .slice(0, Math.max(0, Math.floor(limit)));
}

export interface PdfPagePosition {
  pageNumber: number;
  top: number;
  bottom: number;
}

/**
 * Pick the page that best represents the viewport.
 *
 * A page with only a few pixels left above the viewport must not win over the
 * next page that fills almost all of it. Equal vertical geometry is resolved
 * to the lower page number so a two-page spread consistently reports its left
 * page. IntersectionObserver uses a generous render margin, so the final
 * nearest-distance fallback also handles a callback arriving between two
 * actually visible pages.
 */
export function selectCurrentPdfPage(
  pages: Iterable<PdfPagePosition>,
  viewportTop: number,
  viewportBottom: number,
  fallbackPage = 1,
): number {
  const candidates = [...pages]
    .filter(
      ({ pageNumber, top, bottom }) =>
        Number.isFinite(pageNumber) &&
        pageNumber >= 1 &&
        Number.isFinite(top) &&
        Number.isFinite(bottom) &&
        bottom >= top,
    )
    .sort((a, b) => a.pageNumber - b.pageNumber);
  if (!candidates.length) return fallbackPage;

  let best = candidates[0];
  let bestOverlap = Math.max(
    0,
    Math.min(best.bottom, viewportBottom) - Math.max(best.top, viewportTop),
  );
  let bestTopDistance = Math.abs(best.top - viewportTop);
  let bestViewportDistance =
    bestOverlap > 0
      ? 0
      : best.bottom < viewportTop
        ? viewportTop - best.bottom
        : best.top - viewportBottom;

  for (const candidate of candidates.slice(1)) {
    const overlap = Math.max(
      0,
      Math.min(candidate.bottom, viewportBottom) -
        Math.max(candidate.top, viewportTop),
    );
    const topDistance = Math.abs(candidate.top - viewportTop);
    const viewportDistance =
      overlap > 0
        ? 0
        : candidate.bottom < viewportTop
          ? viewportTop - candidate.bottom
          : candidate.top - viewportBottom;
    if (
      overlap > bestOverlap ||
      (overlap === bestOverlap &&
        (viewportDistance < bestViewportDistance ||
          (viewportDistance === bestViewportDistance &&
            topDistance < bestTopDistance)))
    ) {
      best = candidate;
      bestOverlap = overlap;
      bestTopDistance = topDistance;
      bestViewportDistance = viewportDistance;
    }
  }
  return best.pageNumber;
}

type PdfOptionalContentConfig = Awaited<
  ReturnType<pdfjsLib.PDFDocumentProxy["getOptionalContentConfig"]>
>;

export interface PdfRenderedTextLayer {
  div: HTMLElement;
  numTextDivs: number;
}

export interface PdfLinkEventBus {
  dispatch: (eventName: string, data: object) => void;
}

function dispatchPdfTextLayerRendered(
  eventBus: PdfLinkEventBus,
  pageNumber: number,
  renderedTextLayer: PdfRenderedTextLayer,
): void {
  eventBus.dispatch("textlayerrendered", {
    source: { textLayer: { div: renderedTextLayer.div } },
    pageNumber,
    numTextDivs: renderedTextLayer.numTextDivs,
    error: null,
  });
}

export interface PdfLinkScrollRequest {
  pageNumber: number;
  destArray?: unknown[];
  allowNegativeOffset?: boolean;
  ignoreDestinationZoom?: boolean;
  behavior?: ScrollBehavior;
}

export interface PdfLinkViewerAdapter {
  currentPageNumber: number;
  pagesRotation: number;
  readonly isInPresentationMode: boolean;
  optionalContentConfigPromise: Promise<PdfOptionalContentConfig>;
  pageLabelToPageNumber: (label: string) => number | null;
  scrollPageIntoView: (request: PdfLinkScrollRequest) => void;
  nextPage: () => boolean;
  previousPage: () => boolean;
}

export interface PdfLinkViewerAdapterOptions {
  pagesCount: number;
  getCurrentPage: () => number;
  setCurrentPage: (pageNumber: number) => void;
  scrollPageIntoView: (request: PdfLinkScrollRequest) => void;
  optionalContentConfigPromise: Promise<PdfOptionalContentConfig>;
  eventBus?: PdfLinkEventBus;
  getRenderedTextLayer?: (
    pageNumber: number,
  ) => PdfRenderedTextLayer | null;
  onOptionalContentConfigChange?: (
    promise: Promise<PdfOptionalContentConfig>,
  ) => void;
  pageLabelToPageNumber?: (label: string) => number | null;
}

export function createPdfLinkViewerAdapter(
  options: PdfLinkViewerAdapterOptions,
): PdfLinkViewerAdapter {
  let rotation = 0;
  let optionalContentConfigPromise = options.optionalContentConfigPromise;
  const clampPage = (value: number) =>
    Math.max(1, Math.min(options.pagesCount, Math.floor(value)));

  return {
    get currentPageNumber() {
      return clampPage(options.getCurrentPage());
    },
    set currentPageNumber(value: number) {
      options.setCurrentPage(clampPage(value));
    },
    get pagesRotation() {
      return rotation;
    },
    set pagesRotation(value: number) {
      if (Number.isInteger(value) && value % 90 === 0) rotation = value;
    },
    get isInPresentationMode() {
      return false;
    },
    get optionalContentConfigPromise() {
      return optionalContentConfigPromise;
    },
    set optionalContentConfigPromise(promise: Promise<PdfOptionalContentConfig>) {
      optionalContentConfigPromise = promise;
      options.onOptionalContentConfigChange?.(promise);
    },
    pageLabelToPageNumber: (label: string) => {
      if (options.pageLabelToPageNumber) {
        return options.pageLabelToPageNumber(label);
      }
      if (!/^\d+$/.test(label)) return null;
      const pageNumber = Number(label);
      return pageNumber >= 1 && pageNumber <= options.pagesCount
        ? pageNumber
        : null;
    },
    scrollPageIntoView: (request) => {
      options.scrollPageIntoView(request);
      const eventBus = options.eventBus;
      const renderedTextLayer =
        options.getRenderedTextLayer?.(request.pageNumber) ?? null;
      if (!eventBus || !renderedTextLayer) return;

      // PDFLinkService registers its one-shot focus listener immediately after
      // scrollPageIntoView returns. Re-emit an already-completed text layer in
      // a microtask so that listener observes it and aborts itself. Pages still
      // rendering use the normal completion dispatch below.
      queueMicrotask(() => {
        dispatchPdfTextLayerRendered(
          eventBus,
          request.pageNumber,
          renderedTextLayer,
        );
      });
    },
    nextPage: () => {
      const current = clampPage(options.getCurrentPage());
      if (current >= options.pagesCount) return false;
      options.setCurrentPage(current + 1);
      return true;
    },
    previousPage: () => {
      const current = clampPage(options.getCurrentPage());
      if (current <= 1) return false;
      options.setCurrentPage(current - 1);
      return true;
    },
  };
}

function instantiatePdfLinkService(runtime: PdfViewerRuntime): PDFLinkService {
  return new runtime.PDFLinkService({
    eventBus: new runtime.EventBus(),
    externalLinkTarget: runtime.LinkTarget.BLANK,
    externalLinkRel: "noopener noreferrer nofollow",
    ignoreDestinationZoom: true,
  });
}

export async function createPdfLinkService(options?: {
  pdfDocument?: pdfjsLib.PDFDocumentProxy;
  pdfViewer?: PdfLinkViewerAdapter;
}): Promise<PDFLinkService> {
  const service = instantiatePdfLinkService(await loadPdfViewerRuntime());
  if (options?.pdfDocument) service.setDocument(options.pdfDocument);
  if (options?.pdfViewer) service.setViewer(options.pdfViewer);
  return service;
}

export interface CalculatePdfFitScaleOptions {
  mode: "width" | "height";
  layout: PdfLayout;
  currentPage: number;
  pagesCount: number;
  pageViewports: ReadonlyMap<number, Pick<PdfPageViewport, "width" | "height">>;
  viewportWidth: number;
  viewportHeight: number;
}

export function calculatePdfFitScale({
  mode,
  layout,
  currentPage,
  pagesCount,
  pageViewports,
  viewportWidth,
  viewportHeight,
}: CalculatePdfFitScaleOptions): number | null {
  const clamped = Math.max(1, Math.min(pagesCount, Math.floor(currentPage)));
  const pageNumbers =
    layout === "double" && pagesCount > 1
      ? (() => {
          const left = clamped % 2 === 0 ? clamped - 1 : clamped;
          return left + 1 <= pagesCount ? [left, left + 1] : [left];
        })()
      : [clamped];
  const viewports = pageNumbers.map((pageNumber) => pageViewports.get(pageNumber));
  if (viewports.some((viewport) => !viewport)) return null;

  const exact = viewports as Array<Pick<PdfPageViewport, "width" | "height">>;
  const spreadWidth =
    exact.reduce((sum, viewport) => sum + viewport.width, 0) +
    PDF_SPREAD_GAP_PX * Math.max(0, exact.length - 1);
  const spreadHeight = Math.max(...exact.map((viewport) => viewport.height));
  if (spreadWidth <= 0 || spreadHeight <= 0) return null;

  const availableWidth = Math.max(1, viewportWidth - PDF_VIEWPORT_PADDING_PX);
  const availableHeight = Math.max(1, viewportHeight - PDF_VIEWPORT_PADDING_PX);
  return {
    width: availableWidth / spreadWidth,
    height: availableHeight / spreadHeight,
  }[mode];
}

export type PdfLayout = "single" | "double";
export type PdfRotation = 0 | 90 | 180 | 270;

export type PdfLoadStatus =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "password_required"
  | "invalid"
  | "unavailable"
  | "error";

export interface PdfLoadState {
  status: PdfLoadStatus;
  documentIdentity: string;
  message?: string;
  progress?: number;
}

export type PdfSearchStatus =
  | "idle"
  | "searching"
  | "success"
  | "error";

export interface PdfSearchState {
  status: PdfSearchStatus;
  query: string;
  current: number;
  total: number;
  scannedPages: number;
  totalPages: number;
  message?: string;
}

export interface PdfOutlineState {
  status: "idle" | "loading" | "success" | "unavailable" | "error";
  items: PdfOutlineItem[];
  message?: string;
}

export interface PdfViewerProps {
  data: Uint8Array | null;
  /** Exact compile/PDF-load identity; never use a filename as this value. */
  documentIdentity?: string;
  scale: number;
  onInverse?: (
    page: number,
    x: number,
    y: number,
    word?: string,
    textTarget?: PreviewTextTarget,
  ) => void;
  onPageChange?: (current: number, total: number) => void;
  layout?: PdfLayout;
  onOpenLink?: (url: string) => void;
  onLoadStateChange?: (state: PdfLoadState) => void;
  searchQuery?: string;
  onSearchStateChange?: (state: PdfSearchState) => void;
  onOutlineStateChange?: (state: PdfOutlineState) => void;
  password?: string;
  rotation?: PdfRotation;
  // true (default): the loader probes the text pipe and recovers a wedged
  // worker. false: skip the probe so a legitimately text-less page (image/figure
  // projects) doesn't force the session onto the main-thread worker.
  expectText?: boolean;
  screenReaderMode?: boolean;
}

export interface PdfViewerHandle {
  gotoPage: (n: number) => void;
  getFitScale: (mode: "width" | "height") => number | null;
  findNext: () => void;
  findPrevious: () => void;
  activateOutlineItem: (id: string) => void;
}

/** Honours the OS "reduce motion" setting for preview scrolling. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer(
  {
    data,
    documentIdentity = "unidentified-pdf",
    scale,
    onInverse,
    onPageChange,
    layout = "single",
    onOpenLink,
    onLoadStateChange,
    searchQuery = "",
    onSearchStateChange,
    onOutlineStateChange,
    password,
    rotation = 0,
    expectText = true,
    screenReaderMode = false,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onInverseRef = useRef(onInverse);
  onInverseRef.current = onInverse;
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;
  const onLoadStateChangeRef = useRef(onLoadStateChange);
  onLoadStateChangeRef.current = onLoadStateChange;
  const onSearchStateChangeRef = useRef(onSearchStateChange);
  onSearchStateChangeRef.current = onSearchStateChange;
  const onOutlineStateChangeRef = useRef(onOutlineStateChange);
  onOutlineStateChangeRef.current = onOutlineStateChange;
  const documentIdentityRef = useRef(documentIdentity);
  documentIdentityRef.current = documentIdentity;
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
  const rotationRef = useRef<PdfRotation>(normalizeRotation(rotation));
  rotationRef.current = normalizeRotation(rotation);
  const screenReaderModeRef = useRef(screenReaderMode);
  screenReaderModeRef.current = screenReaderMode;
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
  // Exact scale-1 viewports retain mixed media boxes, rotation and UserUnit.
  const pageViewportsRef = useRef<Map<number, PdfPageViewport>>(new Map());
  const geometryPromisesRef = useRef<Map<number, Promise<PdfPageViewport>>>(new Map());
  // Render states whose bookkeeping has been dropped but whose canvases are
  // still on screen. Releasing a state removes its nodes, so doing it when a
  // reload *starts* empties the pane for the whole parse; these are held until
  // the replacement layout is ready to swap in, or until the load is abandoned
  // with no successor. Nothing else may read them: they are already detached
  // from `renderedRef`.
  const pendingReleaseRef = useRef<RenderState[]>([]);
  const releasePendingRenders = useCallback(() => {
    const pending = pendingReleaseRef.current;
    pendingReleaseRef.current = [];
    for (const state of pending) cancelRenderState(state);
  }, []);
  const retirePendingRenders = useCallback(() => {
    for (const state of renderedRef.current.values()) {
      pendingReleaseRef.current.push(state);
    }
    renderedRef.current.clear();
  }, []);
  const geometryScanRef = useRef<PdfPageGeometryScan | null>(null);
  const documentAbortRef = useRef<AbortController | null>(null);
  // Debounce for crisp re-rasterization: zoom resizes instantly (cheap) and only
  // re-renders at full resolution once the scale settles, so pinch stays smooth.
  const rasterTimerRef = useRef<number | null>(null);
  const placeholderResizeFrameRef = useRef<number | null>(null);
  const textContentRef = useRef<Map<number, PageTextContent>>(new Map());
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchSequenceRef = useRef(0);
  const searchMatchesRef = useRef<PdfSearchMatch[]>([]);
  const searchMatchesByPageRef = useRef<
    Map<number, Array<{ match: PdfSearchMatch; index: number }>>
  >(new Map());
  const searchActiveIndexRef = useRef(-1);
  const outlineSequenceRef = useRef(0);
  const outlineTargetsRef = useRef<Map<string, PdfOutlineTarget>>(
    new Map(),
  );
  const outlineItemsRef = useRef<PdfOutlineItem[]>([]);

  // pdf.js' real PDFLinkService is bound to our lightweight viewer adapter once
  // the document opens. This keeps internal destinations, named actions, OCG
  // actions and attachment lookup functional without pulling in PDFViewer's
  // heavyweight rendering/scroll stack.
  const pdfViewerRuntimeRef = useRef<PdfViewerRuntime | null>(null);
  const linkServiceRef = useRef<PDFLinkService | null>(null);
  const linkViewerAdapterRef = useRef<PdfLinkViewerAdapter | null>(null);
  const downloadManagerRef = useRef<PdfDownloadManager | null>(null);
  const optionalContentConfigPromiseRef =
    useRef<Promise<PdfOptionalContentConfig> | null>(null);

  const applyExactPageViewport = useCallback(
    (pageNumber: number, viewport: PdfPageViewport) => {
      const wrap = wrapsRef.current.get(pageNumber);
      const scrollParent = containerRef.current?.parentElement;
      const rootTop = scrollParent?.getBoundingClientRect().top ?? 0;
      const anchor =
        scrollParent &&
        [
          ...new Set([
            currentPageRef.current,
            ...visibleRef.current,
          ]),
        ]
          .sort((a, b) => a - b)
          .map((candidate) => wrapsRef.current.get(candidate))
          .filter((element): element is HTMLElement => Boolean(element))
          .find((element) => element.getBoundingClientRect().bottom > rootTop + 1);
      const anchorTopBefore = anchor?.getBoundingClientRect().top;

      pageViewportsRef.current.set(pageNumber, viewport);
      if (wrap) {
        wrap.dataset.pdfGeometry = "exact";
        wrap.dataset.pdfRotation = String(viewport.rotation);
        wrap.dataset.pdfUserUnit = String(viewport.userUnit);
        if (!renderedRef.current.has(pageNumber)) {
          applyPdfPlaceholderViewport(
            wrap,
            viewport,
            scaleRef.current,
            window.devicePixelRatio || 1,
          );
        }
      }

      // Replacing an approximate page above the viewport must not move the
      // reader's current line. Preserve the first on-screen page as an anchor.
      if (scrollParent && anchor && anchorTopBefore !== undefined) {
        const anchorTopAfter = anchor.getBoundingClientRect().top;
        const delta = anchorTopAfter - anchorTopBefore;
        if (Number.isFinite(delta) && Math.abs(delta) >= 0.5) {
          scrollParent.scrollTop += delta;
        }
      }
    },
    [],
  );

  const ensurePageGeometry = useCallback(
    (pageNumber: number): Promise<PdfPageViewport> => {
      const exact = pageViewportsRef.current.get(pageNumber);
      if (exact) return Promise.resolve(exact);
      const existing = geometryPromisesRef.current.get(pageNumber);
      if (existing) return existing;

      const doc = docRef.current;
      const lifecycle = documentAbortRef.current;
      const seq = loadSeqRef.current;
      if (!doc || !lifecycle) {
        return Promise.reject(new Error("PDF document geometry is unavailable"));
      }

      const promise = loadPdfPageViewport(
        doc,
        pageNumber,
        lifecycle.signal,
        undefined,
        rotationRef.current,
      )
        .then((viewport) => {
          if (
            lifecycle.signal.aborted ||
            seq !== loadSeqRef.current ||
            docRef.current !== doc
          ) {
            throw new DOMException("PDF geometry superseded", "AbortError");
          }
          applyExactPageViewport(pageNumber, viewport);
          return viewport;
        })
        .finally(() => {
          if (geometryPromisesRef.current.get(pageNumber) === promise) {
            geometryPromisesRef.current.delete(pageNumber);
          }
        });
      geometryPromisesRef.current.set(pageNumber, promise);
      return promise;
    },
    [applyExactPageViewport],
  );

  // Drop a page's rasterization (canvas/text/annotation layers) and cancel its
  // in-flight render, keeping the placeholder wrapper (sized) so layout holds.
  const unrenderPage = useCallback((pageNo: number) => {
    const state = renderedRef.current.get(pageNo);
    if (!state) return;
    const wrap = wrapsRef.current.get(pageNo);
    if (screenReaderModeRef.current && state.screenReaderLayer) {
      state.screenReaderLayer = null;
    }
    cancelRenderState(state);
    renderedRef.current.delete(pageNo);
    textContentRef.current.delete(pageNo);
    if (wrap) {
      const baseViewport = pageViewportsRef.current.get(pageNo);
      if (!baseViewport) return;
      applyPdfPlaceholderViewport(
        wrap,
        baseViewport,
        scaleRef.current,
        window.devicePixelRatio || 1,
      );
      if (screenReaderModeRef.current) {
        setPdfScreenReaderWrapStyle(wrap, true);
      }
    }
  }, []);

  // Reserve a live raster slot before any async page work starts. This is the
  // common admission path for intersection, toolbar, SyncTeX and zoom renders,
  // so even concurrent/off-screen requests cannot exceed the memory budget.
  const reserveRenderSlot = useCallback((requestedPage: number) => {
    if (renderedRef.current.has(requestedPage)) return;
    while (renderedRef.current.size >= MAX_RENDERED_PAGES) {
      const focus = currentPageRef.current || requestedPage;
      const desiredVisible = new Set(
        prioritizePdfPages(visibleRef.current, focus, MAX_RENDERED_PAGES),
      );
      const victim = [...renderedRef.current.keys()]
        .filter((pageNumber) => pageNumber !== requestedPage)
        .sort((a, b) => {
          const aDesired = desiredVisible.has(a) ? 1 : 0;
          const bDesired = desiredVisible.has(b) ? 1 : 0;
          return (
            aDesired - bDesired ||
            Math.abs(b - focus) - Math.abs(a - focus) ||
            b - a
          );
        })[0];
      if (victim === undefined) return;
      unrenderPage(victim);
    }
  }, [unrenderPage]);

  const syncScreenReaderLayer = useCallback(
    async (pageNo: number, state: RenderState, wrap: HTMLElement) => {
      const screenReaderActive = screenReaderModeRef.current;
      const visualLayers = state.nodes.filter(
        (node) => !node.classList.contains("pdf-screen-reader-layer"),
      );
      for (const node of visualLayers) {
        if (screenReaderActive) node.setAttribute("aria-hidden", "true");
        else node.removeAttribute("aria-hidden");
        node.hidden = screenReaderActive;
      }
      for (const node of state.searchNodes) node.hidden = screenReaderActive;
      setPdfScreenReaderWrapStyle(wrap, screenReaderActive);

      for (const existingLayer of wrap.querySelectorAll(
        ":scope > .pdf-screen-reader-layer",
      )) {
        existingLayer.remove();
      }
      state.screenReaderLayer = null;
      const page = state.page;
      const textContent = textContentRef.current.get(pageNo);
      const doc = docRef.current;
      if (!screenReaderActive || !page || !textContent || !doc) return;

      const fallbackLayer = createPdfScreenReaderLayer({
        pageNumber: pageNo,
        totalPages: doc.numPages,
        textContent,
      });
      wrap.appendChild(fallbackLayer);
      state.screenReaderLayer = fallbackLayer;

      try {
        const structureTree = await page.getStructTree();
        if (
          !screenReaderModeRef.current ||
          state.page !== page ||
          renderedRef.current.get(pageNo) !== state ||
          wrapsRef.current.get(pageNo) !== wrap ||
          state.screenReaderLayer !== fallbackLayer
        ) {
          return;
        }
        const structuredLayer = createPdfScreenReaderLayer({
          pageNumber: pageNo,
          totalPages: doc.numPages,
          textContent,
          structureTree,
        });
        fallbackLayer.replaceWith(structuredLayer);
        state.screenReaderLayer = structuredLayer;
      } catch {
        // Untagged PDFs keep the plain-text fallback.
      }
    },
    [],
  );

  // Rasterize one page at the given scale (skips if already current). Idempotent
  // and cancellation-safe.
  const renderPage = useCallback(async (pageNo: number, renderScale: number) => {
    const requestedDoc = docRef.current;
    const requestedSeq = loadSeqRef.current;
    if (!requestedDoc) return;
    try {
      // A page is never rasterized against a borrowed/approximate wrapper.
      // Exact rotation, UserUnit and MediaBox geometry must win first.
      await ensurePageGeometry(pageNo);
    } catch (error) {
      if (
        requestedSeq === loadSeqRef.current &&
        docRef.current === requestedDoc
      ) {
        const failedWrap = wrapsRef.current.get(pageNo);
        if (failedWrap) {
          failedWrap.dataset.pdfGeometry = "error";
          failedWrap.dataset.pdfGeometryError = String(error);
        }
      }
      return;
    }

    const doc = docRef.current;
    const wrap = wrapsRef.current.get(pageNo);
    const viewerRuntime = pdfViewerRuntimeRef.current;
    const linkService = linkServiceRef.current;
    if (
      !doc ||
      doc !== requestedDoc ||
      requestedSeq !== loadSeqRef.current ||
      !wrap ||
      !viewerRuntime ||
      !linkService
    ) {
      return;
    }
    const existing = renderedRef.current.get(pageNo);
    if (existing && existing.renderScale === renderScale) return; // already correct
    if (existing) cancelRenderState(existing);
    else reserveRenderSlot(pageNo);

    const seq = loadSeqRef.current;
    const state: RenderState = {
      renderScale,
      tasks: [],
      textLayer: null,
      renderedTextLayer: null,
      annotationLayer: null,
      accessibilityManager: null,
      structTreeLayer: null,
      screenReaderLayer: null,
      page: null,
      removeTextSelection: null,
      nodes: [],
      searchNodes: [],
    };
    renderedRef.current.set(pageNo, state);
    const isCurrent = () =>
      seq === loadSeqRef.current &&
      docRef.current === doc &&
      wrapsRef.current.get(pageNo) === wrap &&
      renderedRef.current.get(pageNo) === state;

    try {
      const page = await doc.getPage(pageNo);
      state.page = page;
      if (!isCurrent()) {
        page.cleanup();
        state.page = null;
        return;
      }

      const viewport = page.getViewport({
        scale: renderScale,
        rotation: normalizeRotation(
          page.rotate + rotationRef.current,
        ),
      });
      const dpr = window.devicePixelRatio || 1;
      const geometry = applyPdfLayerViewport(wrap, viewport, dpr);
      const baseViewport = page.getViewport({
        scale: 1,
        rotation: normalizeRotation(
          page.rotate + rotationRef.current,
        ),
      });
      applyExactPageViewport(pageNo, baseViewport);
      wrap.dataset.pdfRasterScale = String(renderScale);
      wrap.dataset.pdfCanvasScaling = geometry.restrictedScaling
        ? "restricted"
        : "native";
      wrap.dataset.pdfRotation = String(viewport.rotation);
      wrap.dataset.pdfUserUnit = String(viewport.userUnit);

      const canvas = document.createElement("canvas");
      canvas.className = "pdf-canvas";
      canvas.setAttribute("role", "presentation");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2D canvas context is unavailable");
      canvas.width = geometry.canvasWidth;
      canvas.height = geometry.canvasHeight;
      canvas.style.width = geometry.cssWidth;
      canvas.style.height = geometry.cssHeight;
      // All interactive layers share the page wrapper's exact (0, 0) origin.
      // Leaving a canvas as an inline replaced element lets line-box/baseline
      // metrics shift its painted pixels by a fraction of a CSS pixel in
      // WebKit, while the absolute text layer stays at the wrapper origin.
      canvas.style.position = "absolute";
      canvas.style.inset = "0";
      canvas.style.display = "block";
      const transform =
        geometry.outputScaleX !== 1 || geometry.outputScaleY !== 1
          ? [geometry.outputScaleX, 0, 0, geometry.outputScaleY, 0, 0]
          : undefined;
      wrap.appendChild(canvas);
      state.nodes.push(canvas);

      const textDiv = document.createElement("div");
      textDiv.className = "textLayer";
      textDiv.tabIndex = -1;
      wrap.appendChild(textDiv);
      state.nodes.push(textDiv);

      const annotDiv = document.createElement("div");
      annotDiv.className = "annotationLayer";
      annotDiv.style.position = "absolute";
      annotDiv.style.inset = "0";
      wrap.appendChild(annotDiv);
      state.nodes.push(annotDiv);

      const optionalContentConfigPromise =
        optionalContentConfigPromiseRef.current ?? undefined;
      const renderTask = page.render({
        canvas,
        canvasContext: ctx,
        viewport,
        transform,
        optionalContentConfigPromise,
      });
      state.tasks.push(renderTask);

      const accessibilityManager = new PdfTextAccessibilityManager();
      state.accessibilityManager = accessibilityManager;
      const structTreeLayer = new viewerRuntime.StructTreeLayerBuilder(
        page,
        viewport.rawDims,
      );
      state.structTreeLayer = structTreeLayer;

      // Selectable text layer (best-effort; never blocks the page). pdf.js does
      // not export TextAccessibilityManager/TextHighlighter from its component
      // runtime. We wire TextLayer's public mapping into the compatible
      // accessibility contract; a highlighter is intentionally absent because
      // this lightweight preview has no PDFFindController.
      try {
        const textContent =
          (pageNo === 1 ? probedPageText.get(doc) : undefined) ??
          textContentRef.current.get(pageNo) ??
          (await withTimeout(
            page.getTextContent(TEXT_CONTENT_PARAMS),
            15_000,
            "page text",
          ));
        if (!isCurrent()) return;
        textContentRef.current.set(pageNo, textContent);
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textDiv,
          viewport,
        });
        state.textLayer = textLayer;
        // Time-box: a worker that wedges after load can hang streamTextContent
        // forever, which would stall this async render loop.
        try {
          await withTimeout(textLayer.render(), 15_000, "text layer");
        } catch (error) {
          textLayer.cancel();
          throw error;
        }
        if (!isCurrent()) {
          textLayer.cancel();
          return;
        }
        try {
          calibratePdfTextLayerWidths(
            textDiv,
            textLayer.textDivs,
            textContent,
            viewport,
          );
        } catch {
          // Keep pdf.js' stock geometry if a browser refuses synchronous DOM
          // measurement; text selection is still more useful than no layer.
        }
        accessibilityManager.setTextMapping(textLayer.textDivs);
        accessibilityManager.enable();
        state.removeTextSelection = registerPdfTextSelection(
          textDiv,
          pageNo,
          pdfjsLib.normalizeUnicode,
        );
        state.renderedTextLayer = {
          div: textDiv,
          numTextDivs: textLayer.textDivs.length,
        };
        dispatchPdfTextLayerRendered(
          linkService.eventBus,
          pageNo,
          state.renderedTextLayer,
        );
        paintPdfSearchHighlights(
          wrap,
          state,
          textLayer.textDivs,
          searchMatchesByPageRef.current.get(pageNo) ?? [],
          searchActiveIndexRef.current,
        );
      } catch {
        state.textLayer = null;
        state.renderedTextLayer = null;
        accessibilityManager.disable();
        if (!isCurrent()) return;
        textDiv.replaceChildren();
        /* text selection is a non-fatal enhancement */
      }

      void syncScreenReaderLayer(pageNo, state, wrap);

      try {
        await renderTask.promise;
      } catch (err) {
        if (String(err).includes("RenderingCancelled")) return;
        throw err;
      }
      if (!isCurrent()) return;

      // Preserve tagged-PDF reading order and structure semantics. The current
      // pdf.js type declaration says `void`, while the 6.1.200 implementation
      // returns the generated structure-tree DOM, hence the narrow `unknown`
      // bridge here.
      try {
        const structureDom = (await structTreeLayer.render()) as unknown;
        if (!isCurrent()) return;
        structTreeLayer.updateTextLayer();
        if (structureDom instanceof HTMLElement && structureDom.parentNode !== canvas) {
          canvas.append(structureDom);
        }
        structTreeLayer.show();
      } catch {
        /* untagged PDFs legitimately have no structure tree */
      }

      // Links/annotations (best-effort).
      try {
        const [annotations, optionalContentConfig] = await Promise.all([
          page.getAnnotations({ intent: "display" }),
          optionalContentConfigPromise,
        ]);
        if (!isCurrent()) return;
        const annotationLayer = new pdfjsLib.AnnotationLayer({
          div: annotDiv,
          accessibilityManager,
          annotationCanvasMap: null,
          annotationEditorUIManager: null,
          commentManager: null,
          linkService,
          annotationStorage: doc.annotationStorage,
          page,
          structTreeLayer,
          viewport: viewport.clone({ dontFlip: true }),
        });
        state.annotationLayer = annotationLayer;
        await annotationLayer.render({
          viewport: viewport.clone({ dontFlip: true }),
          div: annotDiv,
          annotations,
          page,
          linkService,
          annotationStorage: doc.annotationStorage,
          downloadManager: downloadManagerRef.current ?? undefined,
          renderForms: false,
          enableScripting: false,
          optionalContentConfig,
        });
        if (!isCurrent()) return;
        annotDiv.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
          const href = a.getAttribute("href") ?? "";
          if (href.startsWith("#")) return;
          const safeUrl = safePdfExternalUrl(href);
          if (!safeUrl) {
            a.removeAttribute("href");
            a.setAttribute("aria-disabled", "true");
            a.setAttribute(
              "title",
              "This PDF link uses a blocked URL scheme.",
            );
            return;
          }
          a.href = safeUrl;
          a.rel = "noopener noreferrer nofollow";
          a.addEventListener("click", (event) => {
            event.preventDefault();
            onOpenLinkRef.current?.(safeUrl);
          });
        });
      } catch {
        /* annotation rendering is a non-fatal enhancement */
      }
    } catch (err) {
      if (!String(err).includes("RenderingCancelled")) {
        const container = containerRef.current;
        if (container && isCurrent() && renderedRef.current.size === 1) {
          container.dataset.pdfRenderError = String(err);
          container.textContent =
            "The PDF opened, but its first page could not be rendered.";
          onLoadStateChangeRef.current?.({
            status: "error",
            documentIdentity: documentIdentityRef.current,
            message:
              "The PDF opened, but its first page could not be rendered.",
          });
        }
      }
      if (renderedRef.current.get(pageNo) === state) {
        cancelRenderState(state);
        renderedRef.current.delete(pageNo);
      }
    }
  }, [
    applyExactPageViewport,
    ensurePageGeometry,
    reserveRenderSlot,
    syncScreenReaderLayer,
  ]);

  useEffect(() => {
    screenReaderModeRef.current = screenReaderMode;
    for (const wrap of wrapsRef.current.values()) {
      if (!screenReaderMode) {
        for (const layer of wrap.querySelectorAll(
          ":scope > .pdf-screen-reader-layer",
        )) {
          layer.remove();
        }
      }
      setPdfScreenReaderWrapStyle(wrap, screenReaderMode);
    }
    for (const [pageNo, state] of renderedRef.current) {
      const wrap = wrapsRef.current.get(pageNo);
      if (wrap) void syncScreenReaderLayer(pageNo, state, wrap);
    }
  }, [screenReaderMode, syncScreenReaderLayer]);

  // Forward SyncTeX may target an off-screen page; render it on demand.
  const ensurePageRendered = useCallback(
    (pageNo: number) => {
      void renderPage(pageNo, scaleRef.current);
    },
    [renderPage]
  );

  const reconcileVisiblePages = useCallback(() => {
    const desired = new Set(
      prioritizePdfPages(
        visibleRef.current,
        currentPageRef.current,
        MAX_RENDERED_PAGES,
      ),
    );
    // When more than 14 pages fit inside the observer margin, keep the pages
    // nearest the current viewport and leave the rest as exact placeholders.
    // Scroll reconciliation rotates that bounded window as the reader moves.
    for (const pageNumber of [...renderedRef.current.keys()]) {
      if (visibleRef.current.has(pageNumber) && !desired.has(pageNumber)) {
        unrenderPage(pageNumber);
      }
    }
    for (const pageNumber of desired) {
      void renderPage(pageNumber, scaleRef.current);
    }
  }, [renderPage, unrenderPage]);

  // The "current" page is the one occupying most of the viewport. Include the
  // commanded page as well as observer candidates because a scroll event can
  // arrive one frame before IntersectionObserver publishes its new set.
  const emitCurrentPage = useCallback(() => {
    const scrollParent = containerRef.current?.parentElement;
    const doc = docRef.current;
    if (!scrollParent || !doc) return;
    const parentRect = scrollParent.getBoundingClientRect();
    const pageNumbers = new Set([
      currentPageRef.current,
      ...visibleRef.current,
    ]);
    const current = selectCurrentPdfPage(
      [...pageNumbers].flatMap((pageNumber) => {
        const wrap = wrapsRef.current.get(pageNumber);
        if (!wrap) return [];
        const rect = wrap.getBoundingClientRect();
        return [{ pageNumber, top: rect.top, bottom: rect.bottom }];
      }),
      parentRect.top,
      parentRect.bottom,
      currentPageRef.current,
    );
    if (current !== currentPageRef.current) {
      currentPageRef.current = current;
      onPageChangeRef.current?.(current, doc.numPages);
    }
    reconcileVisiblePages();
  }, [reconcileVisiblePages]);

  const scrollPageIntoView = useCallback(
    (request: PdfLinkScrollRequest) => {
      const doc = docRef.current;
      if (!doc) return;
      const pageNumber = Math.max(
        1,
        Math.min(doc.numPages, Math.floor(request.pageNumber)),
      );
      const wrap = wrapsRef.current.get(pageNumber);
      if (!wrap) return;

      currentPageRef.current = pageNumber;
      onPageChangeRef.current?.(pageNumber, doc.numPages);
      void renderPage(pageNumber, scaleRef.current);
      // Scroll this pane only. `scrollIntoView` walks every scrollable ancestor,
      // which drags the whole app window when the preview sits inside one.
      const pageScroller = containerRef.current?.parentElement;
      if (pageScroller) {
        pageScroller.scrollTo({
          top: Math.max(0, wrap.offsetTop),
          behavior:
            request.behavior ??
            (prefersReducedMotion() ? "auto" : "smooth"),
        });
      }

      // Honor the vertical component of common PDF destinations after exact
      // geometry is available. Fit/XYZ zoom is intentionally ignored because
      // zoom remains under the preview toolbar's control.
      const destination = request.destArray;
      const destinationType = destination?.[1] as { name?: string } | undefined;
      const pdfY =
        destinationType?.name === "XYZ"
          ? destination?.[3]
          : destinationType?.name === "FitH" ||
              destinationType?.name === "FitBH"
            ? destination?.[2]
            : null;
      if (typeof pdfY !== "number") return;

      void ensurePageGeometry(pageNumber).then((baseViewport) => {
        if (
          docRef.current !== doc ||
          wrapsRef.current.get(pageNumber) !== wrap
        ) {
          return;
        }
        const scrollParent = containerRef.current?.parentElement;
        if (!scrollParent) return;
        const viewport = baseViewport.clone({ scale: scaleRef.current });
        const convert = viewport.convertToViewportPoint?.bind(viewport);
        if (!convert) return;
        const [, viewportY] = convert(0, pdfY);
        const target = wrap.offsetTop + viewportY;
        scrollParent.scrollTop = request.allowNegativeOffset
          ? target
          : Math.max(0, target);
      });
    },
    [ensurePageGeometry, renderPage],
  );

  const repaintSearchHighlights = useCallback(() => {
    for (const [pageNumber, state] of renderedRef.current) {
      const wrap = wrapsRef.current.get(pageNumber);
      const textDivs = state.textLayer?.textDivs;
      if (!wrap || !textDivs) {
        clearPdfSearchHighlights(state);
        continue;
      }
      paintPdfSearchHighlights(
        wrap,
        state,
        textDivs,
        searchMatchesByPageRef.current.get(pageNumber) ?? [],
        searchActiveIndexRef.current,
      );
    }
  }, []);

  const publishSearchState = useCallback(
    (
      status: PdfSearchStatus,
      progress?: Partial<PdfSearchProgress>,
      message?: string,
    ) => {
      const matches = searchMatchesRef.current;
      const active = searchActiveIndexRef.current;
      onSearchStateChangeRef.current?.({
        status,
        query: searchQueryRef.current.trim(),
        current: active >= 0 && matches.length ? active + 1 : 0,
        total: matches.length,
        scannedPages: progress?.scannedPages ?? 0,
        totalPages: progress?.totalPages ?? docRef.current?.numPages ?? 0,
        ...(message ? { message } : {}),
      });
    },
    [],
  );

  const goToSearchIndex = useCallback(
    (requestedIndex: number) => {
      const matches = searchMatchesRef.current;
      if (!matches.length) {
        searchActiveIndexRef.current = -1;
        publishSearchState("success", {
          scannedPages: docRef.current?.numPages ?? 0,
          totalPages: docRef.current?.numPages ?? 0,
        });
        return;
      }
      const index =
        ((requestedIndex % matches.length) + matches.length) %
        matches.length;
      searchActiveIndexRef.current = index;
      repaintSearchHighlights();
      const match = matches[index];
      scrollPageIntoView({ pageNumber: match.pageNumber });
      publishSearchState("success", {
        scannedPages: docRef.current?.numPages ?? 0,
        totalPages: docRef.current?.numPages ?? 0,
      });
    },
    [
      publishSearchState,
      repaintSearchHighlights,
      scrollPageIntoView,
    ],
  );

  const runSearch = useCallback(
    async (requestedQuery: string) => {
      const query = requestedQuery.trim();
      searchAbortRef.current?.abort("A newer PDF search started");
      const controller = new AbortController();
      searchAbortRef.current = controller;
      const sequence = ++searchSequenceRef.current;
      const documentSequence = loadSeqRef.current;
      const document = docRef.current;
      searchMatchesRef.current = [];
      searchMatchesByPageRef.current.clear();
      searchActiveIndexRef.current = -1;
      repaintSearchHighlights();

      if (!query) {
        publishSearchState("idle");
        return;
      }
      if (!document) {
        publishSearchState("searching");
        return;
      }

      let lastProgressAt = 0;
      publishSearchState("searching", {
        scannedPages: 0,
        totalPages: document.numPages,
      });
      try {
        const matches = await searchPdfDocument(
          document,
          query,
          controller.signal,
          (progress) => {
            if (
              controller.signal.aborted ||
              sequence !== searchSequenceRef.current ||
              documentSequence !== loadSeqRef.current ||
              docRef.current !== document ||
              searchQueryRef.current.trim() !== query
            ) {
              return;
            }
            const now = performance.now();
            if (
              progress.scannedPages !== progress.totalPages &&
              now - lastProgressAt < PDF_SEARCH_PROGRESS_INTERVAL_MS
            ) {
              return;
            }
            lastProgressAt = now;
            publishSearchState("searching", progress);
          },
        );
        if (
          controller.signal.aborted ||
          sequence !== searchSequenceRef.current ||
          documentSequence !== loadSeqRef.current ||
          docRef.current !== document ||
          searchQueryRef.current.trim() !== query
        ) {
          return;
        }

        searchMatchesRef.current = matches;
        const byPage = new Map<
          number,
          Array<{ match: PdfSearchMatch; index: number }>
        >();
        matches.forEach((match, index) => {
          const pageMatches = byPage.get(match.pageNumber) ?? [];
          pageMatches.push({ match, index });
          byPage.set(match.pageNumber, pageMatches);
        });
        searchMatchesByPageRef.current = byPage;
        searchActiveIndexRef.current = matches.length ? 0 : -1;
        repaintSearchHighlights();
        publishSearchState("success", {
          scannedPages: document.numPages,
          totalPages: document.numPages,
        });
        if (matches.length) {
          scrollPageIntoView({ pageNumber: matches[0].pageNumber });
        }
      } catch (error) {
        if (
          controller.signal.aborted ||
          sequence !== searchSequenceRef.current ||
          documentSequence !== loadSeqRef.current
        ) {
          return;
        }
        publishSearchState(
          "error",
          {
            scannedPages: 0,
            totalPages: document.numPages,
          },
          "Search could not read every page. Retry after reloading the PDF.",
        );
      }
    },
    [
      publishSearchState,
      repaintSearchHighlights,
      scrollPageIntoView,
    ],
  );

  const loadOutline = useCallback(
    async (
      document: pdfjsLib.PDFDocumentProxy,
      documentSequence: number,
    ) => {
      const sequence = ++outlineSequenceRef.current;
      outlineTargetsRef.current.clear();
      outlineItemsRef.current = [];
      onOutlineStateChangeRef.current?.({
        status: "loading",
        items: [],
      });
      try {
        const normalized = normalizePdfOutline(
          await document.getOutline(),
        );
        if (
          sequence !== outlineSequenceRef.current ||
          documentSequence !== loadSeqRef.current ||
          docRef.current !== document
        ) {
          return;
        }
        outlineTargetsRef.current = normalized.targets;
        outlineItemsRef.current = normalized.items;
        onOutlineStateChangeRef.current?.({
          status: "success",
          items: normalized.items,
          ...(normalized.items.length
            ? {}
            : { message: "This PDF does not contain a document outline." }),
        });
      } catch {
        if (
          sequence !== outlineSequenceRef.current ||
          documentSequence !== loadSeqRef.current ||
          docRef.current !== document
        ) {
          return;
        }
        outlineTargetsRef.current.clear();
        outlineItemsRef.current = [];
        onOutlineStateChangeRef.current?.({
          status: "error",
          items: [],
          message: "The PDF outline could not be loaded.",
        });
      }
    },
    [],
  );

  const activateOutlineItem = useCallback((id: string) => {
    const target = outlineTargetsRef.current.get(id);
    if (!target) return;
    if (target.externalUrl) {
      onOpenLinkRef.current?.(target.externalUrl);
      return;
    }
    if (target.destination) {
      void linkServiceRef.current
        ?.goToDestination(target.destination)
        .catch(() => {
          onOutlineStateChangeRef.current?.({
            status: "error",
            items: outlineItemsRef.current,
            message: "That outline destination is unavailable.",
          });
        });
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
        // Toolbar page navigation can be repeated faster than a smooth-scroll
        // animation completes. Jump atomically so a previous animation cannot
        // report an intermediate page and make rapid next/previous skip.
        scrollPageIntoView({ pageNumber: clamped, behavior: "auto" });
      },
      getFitScale: (mode) => {
        const viewport = containerRef.current?.parentElement;
        const doc = docRef.current;
        if (!viewport || !doc) return null;
        const fit = calculatePdfFitScale({
          mode,
          layout,
          currentPage: currentPageRef.current,
          pagesCount: doc.numPages,
          pageViewports: pageViewportsRef.current,
          viewportWidth: viewport.clientWidth,
          viewportHeight: viewport.clientHeight,
        });
        if (fit !== null) return fit;

        // Geometry for a newly reached spread may still be resolving. Request
        // it now; the toolbar can retry on its next action without ever using
        // page-one dimensions for another page.
        const current = currentPageRef.current;
        const left =
          layout === "double" && current % 2 === 0 ? current - 1 : current;
        void ensurePageGeometry(left).catch(() => {});
        if (layout === "double" && left + 1 <= doc.numPages) {
          void ensurePageGeometry(left + 1).catch(() => {});
        }
        return null;
      },
      findNext: () =>
        goToSearchIndex(searchActiveIndexRef.current + 1),
      findPrevious: () =>
        goToSearchIndex(searchActiveIndexRef.current - 1),
      activateOutlineItem,
    }),
    [
      activateOutlineItem,
      ensurePageGeometry,
      goToSearchIndex,
      layout,
      scrollPageIntoView,
    ]
  );

  // Build the placeholder layout for every page and start observing them.
  const buildLayout = useCallback(
    async (doc: pdfjsLib.PDFDocumentProxy) => {
      const container = containerRef.current;
      if (!container) return;
      const seq = loadSeqRef.current;
      if (placeholderResizeFrameRef.current) {
        cancelAnimationFrame(placeholderResizeFrameRef.current);
        placeholderResizeFrameRef.current = null;
      }

      observerRef.current?.disconnect();
      observerRef.current = null;
      geometryScanRef.current?.abort("layout rebuilt");
      geometryScanRef.current = null;
      // The bookkeeping for the outgoing layout is dropped now, but its DOM
      // stays until the replacement is ready to go in. Releasing or clearing
      // here instead would blank the pane for the whole of
      // `ensurePageGeometry` - the flicker a recompile or a rotate used to show.
      retirePendingRenders();
      wrapsRef.current.clear();
      visibleRef.current.clear();
      pageViewportsRef.current.clear();
      geometryPromisesRef.current.clear();

      // Page 1 is the only geometry on the startup critical path. Every later
      // page gets a clearly marked neutral skeleton, then its own exact
      // MediaBox/rotation/UserUnit replaces it progressively.
      const firstViewport = await ensurePageGeometry(1);
      if (
        seq !== loadSeqRef.current ||
        docRef.current !== doc
      ) {
        // Superseded: this layout will never be built, so the retained pages
        // have no swap to wait for. Whoever superseded us owns the pane.
        releasePendingRenders();
        return;
      }

      // Geometry is in hand, so the replacement can be built: release and drop
      // the previous pages only now, immediately before the new ones go in.
      releasePendingRenders();
      container.innerHTML = "";

      const s = scaleRef.current;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const p = Number((entry.target as HTMLElement).dataset.page);
            if (!p) continue;
            if (entry.isIntersecting) {
              visibleRef.current.add(p);
            } else {
              visibleRef.current.delete(p);
              unrenderPage(p);
            }
          }
          reconcileVisiblePages();
        },
        { root: container.parentElement ?? null, rootMargin: `${RENDER_MARGIN_PX}px 0px` }
      );
      observerRef.current = observer;

      for (let p = 1; p <= doc.numPages; p++) {
        const wrap = document.createElement("div");
        // Horizontal spacing between pages comes from the container's `gap`, not
        // a per-page margin, so single-column and two-up grids stay evenly
        // spaced. `mx-auto` is the centering mechanism itself (see the
        // container className below): in the auto-sized grid columns of the
        // two-up layout it is a no-op (no free space in an `auto` track to
        // distribute), but in the single-column flex layout it centers this
        // fixed-width page within the full-width column, and - being a plain
        // margin rather than `align-items`/`justify-content` - it degrades to
        // flush-start (not an unreachable centered overflow) if the page is
        // ever wider than the viewport, so every edge stays scrollable.
        wrap.className =
          "relative mx-auto shadow-md ring-1 ring-black/5 rounded-sm overflow-hidden bg-white";
        wrap.dataset.page = String(p);
        wrap.setAttribute("role", "group");
        wrap.setAttribute(
          "aria-label",
          `PDF page ${p} of ${doc.numPages}`,
        );
        const viewport =
          p === 1
            ? firstViewport
            : pendingPageViewport(rotationRef.current);
        wrap.dataset.pdfGeometry = p === 1 ? "exact" : "pending";
        wrap.dataset.pdfRotation = String(viewport.rotation);
        wrap.dataset.pdfUserUnit = String(viewport.userUnit);
        applyPdfPlaceholderViewport(
          wrap,
          viewport,
          s,
          window.devicePixelRatio || 1,
        );
        wrap.addEventListener("click", (ev: MouseEvent) => {
          if ((ev.target as HTMLElement)?.closest?.("a")) return;
          if ((ev.target as HTMLElement)?.closest?.(".pdf-screen-reader-layer")) return;
          const selection = document.getSelection();
          if (selection && !selection.isCollapsed) {
            for (let index = 0; index < selection.rangeCount; index++) {
              if (selection.getRangeAt(index).intersectsNode(wrap)) return;
            }
          }
          const clickedSpan = closestMatchingElement<HTMLElement>(ev.target, ".textLayer span");
          const spanRect = clickedSpan?.getBoundingClientRect();
          const clientX =
            ev.clientX || (spanRect ? spanRect.left + spanRect.width / 2 : ev.clientX);
          const clientY =
            ev.clientY || (spanRect ? spanRect.top + spanRect.height / 2 : ev.clientY);
          const hit = pageClickToBp(wrap, p, { clientX, clientY });
          if (hit) {
            const textTarget = textTargetAtPoint(clientX, clientY, ev.target, wrap);
            const word = textTarget
              ? wordForTextTarget(textTarget)
              : wordAtPoint(clientX, clientY, ev.target, wrap);
            onInverseRef.current?.(
              hit.page,
              hit.x,
              hit.y,
              word ?? undefined,
              textTarget ?? undefined,
            );
          }
        });
        container.appendChild(wrap);
        wrapsRef.current.set(p, wrap);
        observer.observe(wrap);
      }

      const lifecycle = documentAbortRef.current;
      if (lifecycle) {
        const scan = scanPdfPageViewports(doc, {
          signal: lifecycle.signal,
          startPage: 2,
          rotationOffset: rotationRef.current,
          onViewport: (pageNumber, viewport) => {
            if (
              seq !== loadSeqRef.current ||
              docRef.current !== doc
            ) {
              return;
            }
            applyExactPageViewport(pageNumber, viewport);
          },
          onError: (error, pageNumber) => {
            if (
              seq !== loadSeqRef.current ||
              docRef.current !== doc
            ) {
              return;
            }
            container.dataset.pdfGeometryState = "partial";
            container.dataset.pdfGeometryError =
              `Page ${pageNumber}: ${String(error)}`;
          },
        });
        geometryScanRef.current = scan;
        void scan.done.finally(() => {
          if (geometryScanRef.current === scan) {
            geometryScanRef.current = null;
          }
        });
      }

      // Render the first page eagerly: occluded windows (CI, restored
      // minimized apps) suspend IntersectionObserver delivery, and the
      // initial view must not depend on it. The observer corrects the
      // visible set as soon as it fires.
      visibleRef.current.add(1);
      reconcileVisiblePages();

      registerPdfView({
        pages: [...wrapsRef.current.entries()].map(([pageNo, el]) => ({ pageNo, el })),
        scale: s,
        ensurePageRendered,
      });

      currentPageRef.current = 1;
      onPageChangeRef.current?.(1, doc.numPages);
    },
    [
      applyExactPageViewport,
      ensurePageGeometry,
      releasePendingRenders,
      retirePendingRenders,
      unrenderPage,
      reconcileVisiblePages,
      ensurePageRendered,
    ]
  );

  // Load (parse) the document when the PDF bytes change - NOT on zoom.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !data) return;
    const identityAtStart = documentIdentity;
    delete container.dataset.pdfPageCount;
    if (data.byteLength === 0) {
      container.dataset.pdfState = "empty";
      container.replaceChildren();
      onLoadStateChangeRef.current?.({
        status: "empty",
        documentIdentity: identityAtStart,
        message: "The compiled PDF is empty.",
      });
      return;
    }
    container.dataset.pdfState = "loading-primary";
    container.dataset.pdfEnvironment = `${document.visibilityState}:${document.hasFocus() ? "focused" : "unfocused"}`;
    delete container.dataset.pdfError;
    onLoadStateChangeRef.current?.({
      status: "loading",
      documentIdentity: identityAtStart,
      message: "Loading PDF…",
    });

    const loadSequence = ++loadSeqRef.current;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    let worker: pdfjsLib.PDFWorker | null = null;
    let cancelled = false;
    const loadAbort = new AbortController();
    documentAbortRef.current = loadAbort;
    const destroyWorker = () => {
      const currentWorker = worker;
      worker = null;
      if (currentWorker) destroyPdfWorker(currentWorker);
    };
    const destroyLoadingTask = () => {
      const currentTask = loadingTask;
      loadingTask = null;
      void currentTask?.destroy().catch(() => {});
      destroyWorker();
    };
    window.addEventListener("beforeunload", destroyLoadingTask);

    (async () => {
      const viewerRuntime = await loadPdfViewerRuntime();
      if (cancelled || loadAbort.signal.aborted) return;
      pdfViewerRuntimeRef.current = viewerRuntime;
      linkServiceRef.current = instantiatePdfLinkService(viewerRuntime);
      downloadManagerRef.current = new viewerRuntime.DownloadManager();
      // Worker spawns can wedge silently in occluded WebViews (CI, minimized
      // windows), hanging loadingTask.promise forever with no error. Watchdog
      // the load and retry once on a fresh task before showing an error.
      const open = async () => {
        destroyLoadingTask();
        const nextWorker = await createPdfWorker(loadAbort.signal);
        if (cancelled || loadAbort.signal.aborted) {
          destroyPdfWorker(nextWorker);
          throw new DOMException("PDF load cancelled", "AbortError");
        }
        const nextTask = pdfjsLib.getDocument({
          data: data.slice(),
          worker: nextWorker,
          ...(password ? { password } : {}),
        });
        let passwordFailure: PdfPasswordRequiredError | null = null;
        nextTask.onPassword = (
          _updatePassword: (nextPassword: string) => void,
          reason: number,
        ) => {
          passwordFailure = new PdfPasswordRequiredError(
            reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD,
          );
          void nextTask.destroy().catch(() => {});
        };
        nextTask.onProgress = ({
          loaded,
          total,
        }: {
          loaded: number;
          total: number;
        }) => {
          if (
            cancelled ||
            loadAbort.signal.aborted ||
            loadSequence !== loadSeqRef.current ||
            documentIdentityRef.current !== identityAtStart
          ) {
            return;
          }
          const progress =
            Number.isFinite(total) && total > 0
              ? Math.max(0, Math.min(1, loaded / total))
              : undefined;
          onLoadStateChangeRef.current?.({
            status: "loading",
            documentIdentity: identityAtStart,
            message: "Loading PDF…",
            ...(progress === undefined ? {} : { progress }),
          });
        };
        if (cancelled || loadAbort.signal.aborted) {
          void nextTask.destroy().catch(() => {});
          destroyPdfWorker(nextWorker);
          throw new DOMException("PDF load cancelled", "AbortError");
        }
        // Publish the pair only after both objects exist and cancellation has
        // been checked. Cleanup therefore sees either the complete session or
        // neither half of it.
        worker = nextWorker;
        loadingTask = nextTask;
        let doc: pdfjsLib.PDFDocumentProxy;
        try {
          doc = await withTimeout(
            nextTask.promise,
            PDF_WORKER_LOAD_TIMEOUT_MS,
            "pdf load",
          );
        } catch (error) {
          if (passwordFailure) throw passwordFailure;
          throw error;
        }
        if (
          cancelled ||
          loadAbort.signal.aborted ||
          worker !== nextWorker ||
          loadingTask !== nextTask
        ) {
          void nextTask.destroy().catch(() => {});
          destroyPdfWorker(nextWorker);
          throw new DOMException("PDF load cancelled", "AbortError");
        }
        return doc;
      };
      // Load AND confirm the text pipe is alive: a wedged worker can load the
      // doc and render the canvas while returning empty text (blank text layer,
      // broken inverse SyncTeX).
      const openAndProbe = async () => {
        const doc = await open();
        const textContent = await probePageText(doc);
        if (textContent) probedPageText.set(doc, textContent);
        return doc;
      };
      const attempts = createPdfLoadAttempts(
        expectText,
        open,
        openAndProbe,
        forceMainThreadWorker,
      );
      try {
        let doc: pdfjsLib.PDFDocumentProxy | null = null;
        let lastErr: unknown;
        for (const [attemptIndex, attempt] of attempts.entries()) {
          container.dataset.pdfState =
            attemptIndex === 0 ? "loading-primary" : "loading-fallback";
          try {
            doc = await attempt();
            break;
          } catch (e) {
            lastErr = e;
            container.dataset.pdfError = String(e);
            if (cancelled) return;
            textContentRef.current.clear();
            destroyLoadingTask();
            const failure = pdfLoadFailure(e);
            if (
              failure.status === "password_required" ||
              failure.status === "invalid"
            ) {
              break;
            }
          }
        }
        if (cancelled) return;
        if (!doc) throw lastErr;
        if (doc.numPages < 1) {
          throw new Error("The PDF contains no pages");
        }
        docRef.current = doc;
        container.dataset.pdfPageCount = String(doc.numPages);
        const optionalContentConfigPromise = doc.getOptionalContentConfig({
          intent: "display",
        });
        optionalContentConfigPromiseRef.current =
          optionalContentConfigPromise;
        const linkService = linkServiceRef.current;
        if (!linkService) {
          throw new Error("PDF link service was not initialized");
        }
        const viewerAdapter = createPdfLinkViewerAdapter({
          pagesCount: doc.numPages,
          getCurrentPage: () => currentPageRef.current,
          setCurrentPage: (pageNumber) =>
            scrollPageIntoView({ pageNumber }),
          scrollPageIntoView,
          optionalContentConfigPromise,
          eventBus: linkService.eventBus,
          getRenderedTextLayer: (pageNumber) =>
            renderedRef.current.get(pageNumber)?.renderedTextLayer ?? null,
          onOptionalContentConfigChange: (promise) => {
            optionalContentConfigPromiseRef.current = promise;
            queueMicrotask(() => {
              if (cancelled || docRef.current !== doc) return;
              for (const pageNumber of [...renderedRef.current.keys()]) {
                unrenderPage(pageNumber);
              }
              reconcileVisiblePages();
            });
          },
        });
        linkViewerAdapterRef.current = viewerAdapter;
        linkService.setViewer(viewerAdapter);
        linkService.setDocument(doc);
        container.dataset.pdfState = "building-layout";
        await buildLayout(doc);
        if (
          cancelled ||
          loadAbort.signal.aborted ||
          loadSequence !== loadSeqRef.current ||
          docRef.current !== doc ||
          documentIdentityRef.current !== identityAtStart
        ) {
          return;
        }
        container.dataset.pdfState = "ready";
        onLoadStateChangeRef.current?.({
          status: "ready",
          documentIdentity: identityAtStart,
        });
        void loadOutline(doc, loadSequence);
        void runSearch(searchQueryRef.current);
      } catch (e) {
        if (
          !cancelled &&
          !loadAbort.signal.aborted &&
          loadSequence === loadSeqRef.current &&
          documentIdentityRef.current === identityAtStart
        ) {
          const failure = pdfLoadFailure(e);
          container.dataset.pdfState = failure.status;
          container.dataset.pdfError = String(e);
          const error = document.createElement("div");
          error.setAttribute("role", "alert");
          error.style.padding = "24px";
          error.style.textAlign = "center";
          error.textContent = failure.message;
          container.replaceChildren(error);
          onLoadStateChangeRef.current?.({
            ...failure,
            documentIdentity: identityAtStart,
          });
        }
      }
    })();

    return () => {
      window.removeEventListener("beforeunload", destroyLoadingTask);
      cancelled = true;
      loadAbort.abort();
      loadSeqRef.current++;
      searchAbortRef.current?.abort("PDF document closed");
      searchAbortRef.current = null;
      searchSequenceRef.current++;
      searchMatchesRef.current = [];
      searchMatchesByPageRef.current.clear();
      searchActiveIndexRef.current = -1;
      outlineSequenceRef.current++;
      outlineTargetsRef.current.clear();
      outlineItemsRef.current = [];
      geometryScanRef.current?.abort("document closed");
      geometryScanRef.current = null;
      observerRef.current?.disconnect();
      observerRef.current = null;
      // Retain, don't release: on a recompile or rotate this cleanup runs
      // immediately before the successor's effect body, and releasing here
      // would strip the canvases for the whole of the new parse. The deferred
      // check below releases them when nothing takes over.
      retirePendingRenders();
      wrapsRef.current.clear();
      visibleRef.current.clear();
      pageViewportsRef.current.clear();
      geometryPromisesRef.current.clear();
      textContentRef.current.clear();
      if (placeholderResizeFrameRef.current) {
        cancelAnimationFrame(placeholderResizeFrameRef.current);
        placeholderResizeFrameRef.current = null;
      }
      clearPdfView();
      docRef.current = null;
      pdfViewerRuntimeRef.current = null;
      try {
        linkServiceRef.current?.setDocument(null);
      } catch {
        /* link service was already detached */
      }
      linkServiceRef.current = null;
      linkViewerAdapterRef.current = null;
      downloadManagerRef.current = null;
      optionalContentConfigPromiseRef.current = null;
      if (documentAbortRef.current === loadAbort) {
        documentAbortRef.current = null;
      }
      if (container) {
        delete container.dataset.pdfPageCount;
        // Only blank the pane when nothing takes over. A recompile or a rotate
        // re-runs this effect, and clearing here would show an empty pane for
        // the whole parse; `buildLayout` swaps the pages instead. A close
        // (project switch, unmount) has no successor, so the stale pages of a
        // document the user has navigated away from must not survive: the
        // successor bumps `loadSeqRef` synchronously in the next effect body,
        // so a task later tells the two cases apart.
        const closedAt = loadSeqRef.current;
        window.setTimeout(() => {
          if (loadSeqRef.current !== closedAt) return;
          releasePendingRenders();
          container.innerHTML = "";
        }, 0);
      }
      destroyLoadingTask();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data,
    buildLayout,
    documentIdentity,
    expectText,
    loadOutline,
    password,
    reconcileVisiblePages,
    releasePendingRenders,
    retirePendingRenders,
    rotation,
    runSearch,
    scrollPageIntoView,
    unrenderPage,
  ]);

  // Unmount releases synchronously. The deferred path above exists only so a
  // reload can hand its canvases to the next layout; a torn-down viewer has no
  // successor, and its pdf.js pages, annotation layers and canvas memory must
  // go with it. Declared after the load effect so React runs this cleanup last,
  // once that effect has retired its render states.
  useEffect(() => () => releasePendingRenders(), [releasePendingRenders]);

  useEffect(() => {
    void runSearch(searchQuery);
  }, [runSearch, searchQuery]);

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

    // Instant + bounded: only the capped set of live rasterizations needs exact
    // pdf.js rounding and bitmap stretching in the gesture frame.
    for (const [pageNo, state] of renderedRef.current) {
      const wrap = wrapsRef.current.get(pageNo);
      if (!wrap) continue;
      const baseViewport = pageViewportsRef.current.get(pageNo);
      if (!baseViewport) continue;
      const viewport = baseViewport.clone({ scale });
      const geometry = applyPdfLayerViewport(
        wrap,
        viewport,
        window.devicePixelRatio || 1,
      );
      const canvas = wrap.querySelector<HTMLElement>(".pdf-canvas");
      if (canvas) {
        canvas.style.width = geometry.cssWidth;
        canvas.style.height = geometry.cssHeight;
      }
      const textContent = textContentRef.current.get(pageNo);
      if (state.textLayer && state.renderedTextLayer && textContent) {
        try {
          // `--scale-factor` changes each span's font size immediately. Font
          // engines do not promise that a glyph run at 2x has exactly twice
          // its 1x advance (notably Pango on WebKitGTK), so the old --scale-x
          // can leave the selectable boundary a CSS pixel away from the PDF
          // item during the debounce window. Re-measure the capped set of live
          // layers in this frame; the later crisp render calibrates again.
          calibratePdfTextLayerWidths(
            state.renderedTextLayer.div,
            state.textLayer.textDivs,
            textContent,
            viewport,
          );
          paintPdfSearchHighlights(
            wrap,
            state,
            state.textLayer.textDivs,
            searchMatchesByPageRef.current.get(pageNo) ?? [],
            searchActiveIndexRef.current,
          );
        } catch {
          // Preserve pdf.js' previous calibration if synchronous layout is
          // temporarily unavailable during a browser resize.
        }
      }
    }

    // Resize lightweight off-screen placeholders in small animation-frame
    // batches. Unlike one synchronous O(page) loop, a 400-page document cannot
    // monopolize the gesture frame; unlike CSS length multiplication, this also
    // works on older WKWebView/WebKitGTK releases.
    if (placeholderResizeFrameRef.current) {
      cancelAnimationFrame(placeholderResizeFrameRef.current);
    }
    const placeholderIterator = wrapsRef.current.entries();
    const resizePlaceholderBatch = () => {
      if (scaleRef.current !== scale) return;
      const finished = visitPdfPlaceholderBatch(
        placeholderIterator,
        PLACEHOLDER_ZOOM_BATCH_SIZE,
        ([pageNo, wrap]) => {
          if (renderedRef.current.has(pageNo)) return;
          const baseViewport =
            pageViewportsRef.current.get(pageNo) ??
            pendingPageViewport(rotationRef.current);
          applyPdfPlaceholderViewport(
            wrap,
            baseViewport,
            scale,
            window.devicePixelRatio || 1,
          );
        },
      );
      if (finished) {
        placeholderResizeFrameRef.current = null;
      } else {
        placeholderResizeFrameRef.current = requestAnimationFrame(resizePlaceholderBatch);
      }
    };
    placeholderResizeFrameRef.current = requestAnimationFrame(resizePlaceholderBatch);

    // Trailing: re-rasterize the visible pages at full resolution once zooming
    // stops, drop off-screen pages left at the old scale, and refresh SyncTeX's
    // scale (none of which needs to run on every event of a pinch).
    if (rasterTimerRef.current) window.clearTimeout(rasterTimerRef.current);
    rasterTimerRef.current = window.setTimeout(() => {
      const target = scaleRef.current;
      for (const p of [...renderedRef.current.keys()]) {
        if (!visibleRef.current.has(p)) unrenderPage(p);
      }
      reconcileVisiblePages();
      registerPdfView({
        pages: [...wrapsRef.current.entries()].map(([pageNo, el]) => ({ pageNo, el })),
        scale: target,
        ensurePageRendered,
      });
    }, 120);

    return () => {
      if (rasterTimerRef.current) window.clearTimeout(rasterTimerRef.current);
      if (placeholderResizeFrameRef.current) {
        cancelAnimationFrame(placeholderResizeFrameRef.current);
        placeholderResizeFrameRef.current = null;
      }
    };
  }, [
    scale,
    renderPage,
    unrenderPage,
    ensurePageRendered,
    reconcileVisiblePages,
  ]);

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

  if (!data) return null;
  // The page wrappers are appended imperatively; switching the container between
  // a single column and a two-column grid re-flows them into spreads with no
  // re-render of the pages. (React only patches this element's className; the
  // imperative children are outside its vdom and are left untouched.)
  return (
    <div
      ref={containerRef}
      data-testid="pdf-renderer"
      role="document"
      aria-label="PDF document preview"
      className={
        layout === "double"
          ? // Centered via `w-max mx-auto` (a shrink-to-fit block centered by
            // margin), not `justify-content`/`align-items` centering: this
            // container's own box only ever spans its content's natural width
            // (the two pages + gap), so it always centers relative to the
            // current scroll-pane width, even after the pane is resized. When
            // the spread is wider than the pane (high zoom), the auto margins
            // simply compute to 0 rather than an unreachable negative offset,
            // so the far edge stays reachable by scrolling. `justify-content:
            // safe center` was tried here previously, but that CSS Alignment
            // Level 3 keyword isn't reliably supported by every webview this
            // app runs in; margin-based centering is plain CSS1 and universal.
            "grid w-max grid-cols-[auto_auto] content-start gap-4 p-4 mx-auto"
          : "flex w-full flex-col gap-4 p-4"
      }
    />
  );
});
