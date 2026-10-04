// @vitest-environment jsdom

import { createRef } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { testCatalogTranslator } from "@oleafly/i18n-contract/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewMessageKey } from "./messages";
import type { PdfLinkViewerAdapter, PdfViewerHandle, PdfViewerProps } from "./PdfViewer";

type Item =
  | { str: string; width: number; height: number; fontName: string; transform: number[]; hasEOL?: boolean }
  | { type: string; id?: string };

interface PageSpec {
  width: number;
  height: number;
  items: Item[];
  structTree?: unknown;
}

interface Gate {
  promise: Promise<void>;
  resolve: () => void;
}

const harness = vi.hoisted(() => ({
  pages: [] as PageSpec[],
  outline: null as unknown,
  outlineGate: null as Gate | null,
  annotationHrefs: [] as string[],
  rejectedPages: new Set<number>(),
  gates: new Map<number, Gate>(),
  observerCallbacks: [] as IntersectionObserverCallback[],
  linkServices: [] as Array<{ viewer: PdfLinkViewerAdapter | null }>,
  renderCalls: [] as Array<{ pageNumber: number; rotation: number; optionalContentConfigPromise: unknown }>,
  pageCleanup: [] as number[],
  getPageCalls: [] as number[],
  textLayerGate: null as Gate | null,
  textLayerErrorPages: new Set<number>(),
  textLayerCancelled: 0,
  structTreeError: null as unknown,
  structTreeGate: null as Gate | null,
  noViewportConversion: false,
  goToDestination: vi.fn<(destination: unknown) => Promise<void>>(() => Promise.resolve()),
  pageClickToBp: vi.fn<(...args: unknown[]) => { page: number; x: number; y: number } | null>(
    () => null,
  ),
  gate() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  },
  reset() {
    this.pages = [];
    this.outline = null;
    this.outlineGate = null;
    this.annotationHrefs = [];
    this.rejectedPages = new Set();
    this.gates = new Map();
    this.observerCallbacks = [];
    this.linkServices = [];
    this.renderCalls = [];
    this.pageCleanup = [];
    this.getPageCalls = [];
    this.textLayerGate = null;
    this.textLayerErrorPages = new Set();
    this.textLayerCancelled = 0;
    this.structTreeError = null;
    this.structTreeGate = null;
    this.noViewportConversion = false;
  },
}));

vi.mock("./mainThreadWorker", () => ({
  installMainThreadPdfWorker: () => Promise.resolve(),
}));
vi.mock("./pdfController", () => ({
  registerPdfView: vi.fn(),
  clearPdfView: vi.fn(),
  pageClickToBp: (...args: unknown[]) => harness.pageClickToBp(...args),
}));
vi.mock("pdfjs-dist/web/pdf_viewer.mjs", () => {
  return {
    EventBus: class {
      dispatch() {}
    },
    LinkTarget: { BLANK: 2 },
    DownloadManager: class {},
    PDFLinkService: class {
      eventBus: { dispatch: () => void };
      viewer: PdfLinkViewerAdapter | null = null;
      constructor({ eventBus }: { eventBus: { dispatch: () => void } }) {
        this.eventBus = eventBus;
        harness.linkServices.push(this);
      }
      setDocument() {}
      setViewer(viewer: PdfLinkViewerAdapter) {
        this.viewer = viewer;
      }
      goToDestination(destination: unknown) {
        return harness.goToDestination(destination);
      }
    },
    StructTreeLayerBuilder: class {
      render() {
        return harness.structTreeError ? Promise.reject(harness.structTreeError) : Promise.resolve(null);
      }
      updateTextLayer() {}
      show() {}
      hide() {}
    },
  };
});
vi.mock("pdfjs-dist", () => {
  class MockViewport {
    readonly width: number;
    readonly height: number;
    readonly userUnit = 1;
    readonly rawDims: { pageWidth: number; pageHeight: number; pageX: number; pageY: number };

    constructor(
      readonly spec: PageSpec,
      readonly scale: number,
      readonly rotation: number,
    ) {
      const quarterTurn = rotation % 180 !== 0;
      this.width = (quarterTurn ? spec.height : spec.width) * scale;
      this.height = (quarterTurn ? spec.width : spec.height) * scale;
      this.rawDims = { pageWidth: spec.width, pageHeight: spec.height, pageX: 0, pageY: 0 };
    }

    clone({ scale = this.scale }: { scale?: number; dontFlip?: boolean } = {}) {
      return new MockViewport(this.spec, scale, this.rotation);
    }

    readonly convertToViewportPoint = harness.noViewportConversion
      ? undefined
      : (x: number, y: number) => [x * this.scale, (this.spec.height - y) * this.scale];
  }

  const makePage = (pageNumber: number) => {
    const spec = harness.pages[pageNumber - 1];
    return {
      rotate: 0,
      getViewport: ({ scale, rotation = 0 }: { scale: number; rotation?: number }) =>
        new MockViewport(spec, scale, rotation),
      getTextContent: () =>
        Promise.resolve({ items: spec.items, styles: { f: { vertical: false } }, lang: null }),
      render: ({
        viewport,
        optionalContentConfigPromise,
      }: {
        viewport: MockViewport;
        optionalContentConfigPromise: unknown;
      }) => {
        harness.renderCalls.push({
          pageNumber,
          rotation: viewport.rotation,
          optionalContentConfigPromise,
        });
        return { promise: Promise.resolve(), cancel: () => {} };
      },
      getAnnotations: () => Promise.resolve([]),
      getStructTree: () => {
        const settle = () =>
          spec.structTree instanceof Error
            ? Promise.reject(spec.structTree)
            : Promise.resolve(spec.structTree ?? null);
        return harness.structTreeGate ? harness.structTreeGate.promise.then(settle) : settle();
      },
      cleanup: () => {
        harness.pageCleanup.push(pageNumber);
      },
    };
  };

  return {
    GlobalWorkerOptions: { workerSrc: "" },
    PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
    normalizeUnicode: (value: string) => value,
    PDFWorker: class {
      promise = Promise.resolve();
      destroy() {}
    },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: harness.pages.length,
        annotationStorage: {},
        getOptionalContentConfig: ({ intent }: { intent: string }) =>
          Promise.resolve({ renderingIntent: intent, setOCGState: vi.fn() }),
        getPage: (pageNumber: number) => {
          harness.getPageCalls.push(pageNumber);
          if (harness.rejectedPages.has(pageNumber)) {
            return Promise.reject(new Error(`page ${pageNumber} is damaged`));
          }
          const gate = harness.gates.get(pageNumber);
          return gate
            ? gate.promise.then(() => makePage(pageNumber))
            : Promise.resolve(makePage(pageNumber));
        },
        getOutline: () => {
          const outline = harness.outline;
          const settle = () =>
            outline instanceof Error ? Promise.reject(outline) : Promise.resolve(outline);
          return harness.outlineGate ? harness.outlineGate.promise.then(settle) : settle();
        },
      }),
      destroy: () => Promise.resolve(),
    }),
    TextLayer: class {
      readonly textDivs: HTMLElement[] = [];
      constructor(
        private readonly options: {
          textContentSource: { items: Item[] };
          container: HTMLElement;
        },
      ) {}
      async render() {
        const pageNumber = Number(
          this.options.container.closest<HTMLElement>("[data-page]")?.dataset.page,
        );
        if (harness.textLayerErrorPages.has(pageNumber)) throw new Error("text layer failed");
        if (harness.textLayerGate) await harness.textLayerGate.promise;
        for (const item of this.options.textContentSource.items) {
          if (!("str" in item)) continue;
          const span = document.createElement("span");
          span.textContent = item.str;
          this.textDivs.push(span);
          this.options.container.append(span);
        }
      }
      cancel() {
        harness.textLayerCancelled++;
      }
    },
    AnnotationLayer: class {
      constructor(private readonly options: { div: HTMLElement }) {}
      render() {
        for (const href of harness.annotationHrefs) {
          const link = document.createElement("a");
          link.setAttribute("href", href);
          link.textContent = href;
          this.options.div.append(link);
        }
        return Promise.resolve();
      }
      destroy() {}
    },
  };
});

import { PdfViewer } from "./PdfViewer";

const t = testCatalogTranslator<PreviewMessageKey>("preview");

function text(str: string): Item {
  return { str, width: 100, height: 12, fontName: "f", transform: [1, 0, 0, 1, 0, 0] };
}

function page(...strings: string[]): PageSpec {
  return { width: 612, height: 792, items: strings.map(text) };
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

let scrollTo: ReturnType<typeof vi.fn>;

function renderer(): HTMLElement {
  return screen.getByTestId("pdf-renderer");
}

function pageWrap(pageNumber: number): HTMLElement {
  const wrap = renderer().querySelector<HTMLElement>(`[data-page='${pageNumber}']`);
  if (!wrap) throw new Error(`page ${pageNumber} is not laid out`);
  return wrap;
}

function scroller(): HTMLElement {
  return renderer().parentElement as HTMLElement;
}

function renderViewer(props: Partial<PdfViewerProps> = {}) {
  const ref = createRef<PdfViewerHandle>();
  const data = new Uint8Array([1]);
  const view = render(
    <PdfViewer ref={ref} data={data} scale={1} expectText={false} t={t} {...props} />,
  );
  const rerender = (next: Partial<PdfViewerProps>) =>
    view.rerender(
      <PdfViewer
        ref={ref}
        data={data}
        scale={1}
        expectText={false}
        t={t}
        {...props}
        {...next}
      />,
    );
  return { ...view, ref, rerender };
}

async function ready() {
  await waitFor(() => expect(renderer().dataset.pdfState).toBe("ready"));
}

async function pageTextRendered(pageNumber: number) {
  await waitFor(() =>
    expect(renderer().querySelector(`[data-page='${pageNumber}'] .textLayer span`)).not.toBeNull(),
  );
}

function intersect(pageNumbers: number[], isIntersecting: boolean) {
  const callback = harness.observerCallbacks.at(-1);
  if (!callback) throw new Error("no intersection observer");
  act(() =>
    callback(
      pageNumbers.map(
        (pageNumber) =>
          ({ target: pageWrap(pageNumber), isIntersecting }) as unknown as IntersectionObserverEntry,
      ),
      {} as IntersectionObserver,
    ),
  );
}

function linkViewer(): PdfLinkViewerAdapter {
  const viewer = harness.linkServices.at(-1)?.viewer;
  if (!viewer) throw new Error("link service has no viewer");
  return viewer;
}

beforeEach(() => {
  harness.reset();
  harness.goToDestination.mockReset();
  harness.goToDestination.mockImplementation(() => Promise.resolve());
  harness.pageClickToBp.mockReset();
  harness.pageClickToBp.mockReturnValue(null);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        harness.observerCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  scrollTo = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value: scrollTo,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  Reflect.deleteProperty(Range.prototype, "getClientRects");
  Reflect.deleteProperty(document, "caretRangeFromPoint");
  Reflect.deleteProperty(document, "caretPositionFromPoint");
  Reflect.deleteProperty(document, "elementFromPoint");
  Reflect.deleteProperty(window, "matchMedia");
});

describe("PdfViewer search", () => {
  function stubRangeRects() {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [rect(40, 20, 30, 12), rect(0, 0, 0, 12)],
    });
  }

  it("highlights matches, focuses the first and cycles through them", async () => {
    stubRangeRects();
    harness.pages = [page("alpha beta"), page("beta gamma beta")];
    const onSearchStateChange = vi.fn();
    const onPageChange = vi.fn();
    const { ref } = renderViewer({ searchQuery: " beta ", onSearchStateChange, onPageChange });

    await waitFor(() =>
      expect(onSearchStateChange).toHaveBeenLastCalledWith({
        status: "success",
        query: "beta",
        current: 1,
        total: 3,
        scannedPages: 2,
        totalPages: 2,
      }),
    );
    expect(onSearchStateChange.mock.calls[0][0]).toMatchObject({
      status: "searching",
      totalPages: 0,
    });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
    await waitFor(() =>
      expect(pageWrap(1).querySelector(".pdf-search-highlight-current")).not.toBeNull(),
    );
    const marker = pageWrap(1).querySelector<HTMLElement>(".pdf-search-highlight-current");
    expect(marker).toHaveAttribute("aria-hidden", "true");
    expect(marker).toHaveStyle({ left: "40px", top: "20px", width: "30px", height: "12px" });
    expect(pageWrap(1).querySelectorAll(".pdf-search-highlight")).toHaveLength(1);

    act(() => ref.current?.findNext());
    expect(onSearchStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "success", current: 2, total: 3 }),
    );
    expect(onPageChange).toHaveBeenLastCalledWith(2, 2);
    expect(pageWrap(1).querySelector(".pdf-search-highlight-current")).toBeNull();
    await waitFor(() =>
      expect(pageWrap(2).querySelectorAll(".pdf-search-highlight")).toHaveLength(2),
    );
    expect(pageWrap(2).querySelectorAll(".pdf-search-highlight-current")).toHaveLength(1);

    act(() => ref.current?.findNext());
    act(() => ref.current?.findNext());
    expect(onSearchStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ current: 1, total: 3 }),
    );
    act(() => ref.current?.findPrevious());
    expect(onSearchStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ current: 3, total: 3 }),
    );
  });

  it("clears highlights and returns to idle when the query is emptied", async () => {
    stubRangeRects();
    harness.pages = [page("alpha beta")];
    const onSearchStateChange = vi.fn();
    const { rerender } = renderViewer({ searchQuery: "alpha", onSearchStateChange });
    await waitFor(() =>
      expect(pageWrap(1).querySelector(".pdf-search-highlight")).not.toBeNull(),
    );

    rerender({ searchQuery: "", onSearchStateChange });

    expect(onSearchStateChange).toHaveBeenLastCalledWith({
      status: "idle",
      query: "",
      current: 0,
      total: 0,
      scannedPages: 0,
      totalPages: 1,
    });
    expect(pageWrap(1).querySelector(".pdf-search-highlight")).toBeNull();
  });

  it("reports zero matches and keeps navigation inert", async () => {
    harness.pages = [page("alpha")];
    const onSearchStateChange = vi.fn();
    const { ref } = renderViewer({ searchQuery: "omega", onSearchStateChange });
    await waitFor(() =>
      expect(onSearchStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "success", current: 0, total: 0 }),
      ),
    );
    scrollTo.mockClear();

    act(() => ref.current?.findNext());

    expect(onSearchStateChange).toHaveBeenLastCalledWith({
      status: "success",
      query: "omega",
      current: 0,
      total: 0,
      scannedPages: 1,
      totalPages: 1,
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("reports a search that cannot read every page", async () => {
    harness.pages = [page("alpha"), page("beta")];
    harness.rejectedPages.add(2);
    const onSearchStateChange = vi.fn();
    renderViewer({ searchQuery: "beta", onSearchStateChange });

    await waitFor(() =>
      expect(onSearchStateChange).toHaveBeenLastCalledWith({
        status: "error",
        query: "beta",
        current: 0,
        total: 0,
        scannedPages: 0,
        totalPages: 2,
        message: t("search.failed"),
      }),
    );
  });

  it("drops the results of a search superseded by a newer query", async () => {
    harness.pages = [page("alpha"), page("alpha beta")];
    const onSearchStateChange = vi.fn();
    const { rerender } = renderViewer({ onSearchStateChange });
    await ready();
    harness.gates.set(2, harness.gate());

    rerender({ searchQuery: "alpha", onSearchStateChange });
    await waitFor(() =>
      expect(onSearchStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "searching", query: "alpha" }),
      ),
    );
    rerender({ searchQuery: "beta", onSearchStateChange });
    act(() => harness.gates.get(2)?.resolve());

    await waitFor(() =>
      expect(onSearchStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "success", query: "beta", total: 1 }),
      ),
    );
    expect(onSearchStateChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", query: "alpha" }),
    );
    expect(onSearchStateChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("jumps without animation when the system asks for reduced motion", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    harness.pages = [page("alpha")];
    const onSearchStateChange = vi.fn();
    renderViewer({ searchQuery: "alpha", onSearchStateChange });

    await waitFor(() =>
      expect(onSearchStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "success", total: 1 }),
      ),
    );
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });
  });
});

describe("PdfViewer search progress", () => {
  it("throttles intermediate progress but always reports the final page", async () => {
    vi.spyOn(performance, "now").mockReturnValue(1_000);
    harness.pages = [page("a"), page("b"), page("c")];
    const onSearchStateChange = vi.fn();
    renderViewer({ searchQuery: "c", onSearchStateChange });

    await waitFor(() =>
      expect(onSearchStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "success", total: 1, current: 1 }),
      ),
    );
    const searching = onSearchStateChange.mock.calls
      .map(([state]) => state)
      .filter((state) => state.status === "searching" && state.totalPages === 3)
      .map((state) => state.scannedPages);
    expect(searching).toEqual([0, 1, 3]);
  });

  it("paints no highlights on a page whose text layer failed", async () => {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [rect(1, 1, 10, 10)],
    });
    harness.pages = [page("alpha"), page("alpha")];
    harness.textLayerErrorPages.add(1);
    const onSearchStateChange = vi.fn();
    const { ref } = renderViewer({ searchQuery: "alpha", onSearchStateChange });
    await waitFor(() =>
      expect(onSearchStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "success", total: 2 }),
      ),
    );

    act(() => ref.current?.findNext());
    await waitFor(() =>
      expect(pageWrap(2).querySelector(".pdf-search-highlight-current")).not.toBeNull(),
    );
    act(() => ref.current?.findNext());

    expect(pageWrap(1).querySelector("canvas")).not.toBeNull();
    expect(pageWrap(1).querySelector(".pdf-search-highlight")).toBeNull();
    expect(pageWrap(2).querySelector(".pdf-search-highlight-current")).toBeNull();
    expect(pageWrap(2).querySelector(".pdf-search-highlight")).not.toBeNull();
  });
});

describe("PdfViewer outline", () => {
  it("publishes the outline and activates its targets", async () => {
    harness.pages = [page("alpha")];
    harness.outline = [
      { title: "Introduction", dest: "intro", items: [] },
      { title: "Project site", url: "https://example.org/docs", items: [] },
      { title: "Orphan", items: [] },
    ];
    const onOutlineStateChange = vi.fn();
    const onOpenLink = vi.fn();
    const { ref } = renderViewer({ onOutlineStateChange, onOpenLink });

    await waitFor(() =>
      expect(onOutlineStateChange).toHaveBeenLastCalledWith({
        status: "success",
        items: [
          { id: "pdf-outline-0", title: "Introduction", external: false, children: [] },
          { id: "pdf-outline-1", title: "Project site", external: true, children: [] },
          {
            id: "pdf-outline-2",
            title: "Orphan",
            external: false,
            children: [],
            disabledReason: t("outline.noDestination"),
          },
        ],
      }),
    );
    expect(onOutlineStateChange.mock.calls[0][0]).toEqual({ status: "loading", items: [] });

    ref.current?.activateOutlineItem("pdf-outline-1");
    expect(onOpenLink).toHaveBeenCalledWith("https://example.org/docs");

    ref.current?.activateOutlineItem("pdf-outline-0");
    expect(harness.goToDestination).toHaveBeenCalledWith("intro");

    ref.current?.activateOutlineItem("pdf-outline-2");
    ref.current?.activateOutlineItem("pdf-outline-9");
    expect(harness.goToDestination).toHaveBeenCalledOnce();
    expect(onOpenLink).toHaveBeenCalledOnce();
  });

  it("reports a destination the link service cannot reach", async () => {
    harness.pages = [page("alpha")];
    harness.outline = [{ title: "Broken", dest: "missing", items: [] }];
    harness.goToDestination.mockImplementation(() => Promise.reject(new Error("no such destination")));
    const onOutlineStateChange = vi.fn();
    const { ref } = renderViewer({ onOutlineStateChange });
    await waitFor(() =>
      expect(onOutlineStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "success" }),
      ),
    );

    ref.current?.activateOutlineItem("pdf-outline-0");

    await waitFor(() =>
      expect(onOutlineStateChange).toHaveBeenLastCalledWith({
        status: "error",
        items: [{ id: "pdf-outline-0", title: "Broken", external: false, children: [] }],
        message: t("outline.destinationUnavailable"),
      }),
    );
  });

  it("explains that a PDF has no outline", async () => {
    harness.pages = [page("alpha")];
    const onOutlineStateChange = vi.fn();
    renderViewer({ onOutlineStateChange });

    await waitFor(() =>
      expect(onOutlineStateChange).toHaveBeenLastCalledWith({
        status: "success",
        items: [],
        message: t("outline.empty"),
      }),
    );
  });

  it("reports an outline that cannot be read", async () => {
    harness.pages = [page("alpha")];
    harness.outline = new Error("outline stream is damaged");
    const onOutlineStateChange = vi.fn();
    renderViewer({ onOutlineStateChange });

    await waitFor(() =>
      expect(onOutlineStateChange).toHaveBeenLastCalledWith({
        status: "error",
        items: [],
        message: t("outline.failed"),
      }),
    );
  });

  it("ignores an outline that arrives after its document was replaced", async () => {
    harness.pages = [page("alpha")];
    harness.outline = [{ title: "Old chapter", dest: "old", items: [] }];
    harness.outlineGate = harness.gate();
    const firstGate = harness.outlineGate;
    const onOutlineStateChange = vi.fn();
    const view = renderViewer({ onOutlineStateChange });
    await ready();

    harness.outlineGate = null;
    harness.outline = new Error("unreadable");
    view.rerender({ data: new Uint8Array([2]), onOutlineStateChange });
    await waitFor(() =>
      expect(onOutlineStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "error" }),
      ),
    );
    act(() => firstGate.resolve());
    await act(() => Promise.resolve());

    expect(onOutlineStateChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "success" }),
    );
  });
});

describe("PdfViewer outline staleness", () => {
  it("ignores an outline failure that arrives after its document was replaced", async () => {
    harness.pages = [page("alpha")];
    harness.outline = new Error("old outline is unreadable");
    harness.outlineGate = harness.gate();
    const firstGate = harness.outlineGate;
    const onOutlineStateChange = vi.fn();
    const view = renderViewer({ onOutlineStateChange });
    await ready();

    harness.outlineGate = null;
    harness.outline = [{ title: "New chapter", dest: "new", items: [] }];
    view.rerender({ data: new Uint8Array([2]), onOutlineStateChange });
    await waitFor(() =>
      expect(onOutlineStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "success" }),
      ),
    );
    act(() => firstGate.resolve());
    await act(() => Promise.resolve());

    expect(onOutlineStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "success" }),
    );
    expect(onOutlineStateChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });
});

describe("PdfViewer imperative handle", () => {
  it("does nothing before a document is open", () => {
    harness.pages = [page("alpha")];
    harness.gates.set(1, harness.gate());
    const { ref } = renderViewer();

    ref.current?.gotoPage(2);

    expect(ref.current?.getFitScale("width")).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("defers page jumps and fit requests until the page layout exists", async () => {
    harness.pages = [page("one"), page("two")];
    harness.gates.set(1, harness.gate());
    const onPageChange = vi.fn();
    const onSearchStateChange = vi.fn();
    const { ref } = renderViewer({ layout: "double", onPageChange, onSearchStateChange });
    await waitFor(() => expect(renderer().dataset.pdfState).toBe("building-layout"));
    Object.defineProperty(scroller(), "clientWidth", { configurable: true, value: 1272 });
    Object.defineProperty(scroller(), "clientHeight", { configurable: true, value: 824 });

    act(() => ref.current?.gotoPage(2));
    expect(ref.current?.getFitScale("width")).toBeNull();
    act(() => ref.current?.findNext());

    expect(onPageChange).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(onSearchStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ current: 0, total: 0, totalPages: 2 }),
    );

    act(() => harness.gates.get(1)?.resolve());
    await ready();
    await waitFor(() => expect(pageWrap(2).dataset.pdfGeometry).toBe("exact"));
    expect(ref.current?.getFitScale("width")).toBeCloseTo(1);
  });

  it("clamps page jumps to the document and jumps without animation", async () => {
    harness.pages = [page("one"), page("two"), page("three")];
    const onPageChange = vi.fn();
    const { ref } = renderViewer({ onPageChange });
    await ready();

    act(() => ref.current?.gotoPage(9.7));

    expect(onPageChange).toHaveBeenLastCalledWith(3, 3);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });
    await pageTextRendered(3);
  });

  it("computes fit scales from the scroll pane size", async () => {
    harness.pages = [page("one"), page("two")];
    const { ref } = renderViewer();
    await ready();
    Object.defineProperty(scroller(), "clientWidth", { configurable: true, value: 644 });
    Object.defineProperty(scroller(), "clientHeight", { configurable: true, value: 824 });

    expect(ref.current?.getFitScale("width")).toBeCloseTo(1);
    expect(ref.current?.getFitScale("height")).toBeCloseTo(1);
  });

  it("returns no two-page fit until the spread's geometry is known", async () => {
    harness.pages = [page("one"), page("two")];
    harness.gates.set(2, harness.gate());
    const { ref } = renderViewer({ layout: "double" });
    await ready();
    Object.defineProperty(scroller(), "clientWidth", { configurable: true, value: 1272 });
    Object.defineProperty(scroller(), "clientHeight", { configurable: true, value: 824 });

    expect(ref.current?.getFitScale("width")).toBeNull();

    act(() => harness.gates.get(2)?.resolve());
    await waitFor(() => expect(pageWrap(2).dataset.pdfGeometry).toBe("exact"));
    expect(ref.current?.getFitScale("width")).toBeCloseTo(1);
  });
});

describe("PdfViewer link targets", () => {
  it("scrolls to the vertical position of XYZ and FitH destinations", async () => {
    harness.pages = [page("one"), page("two")];
    renderViewer();
    await ready();
    const pane = scroller();

    act(() =>
      linkViewer().scrollPageIntoView({
        pageNumber: 2,
        destArray: [{ num: 1 }, { name: "XYZ" }, 0, 600, null],
      }),
    );
    await waitFor(() => expect(pane.scrollTop).toBe(192));

    act(() =>
      linkViewer().scrollPageIntoView({
        pageNumber: 2,
        destArray: [{ num: 1 }, { name: "FitH" }, 700],
        allowNegativeOffset: true,
      }),
    );
    await waitFor(() => expect(pane.scrollTop).toBe(92));

    act(() =>
      linkViewer().scrollPageIntoView({
        pageNumber: 2,
        destArray: [{ num: 1 }, { name: "XYZ" }, 0, 900, null],
      }),
    );
    await waitFor(() => expect(pane.scrollTop).toBe(0));

    pane.scrollTop = 50;
    act(() =>
      linkViewer().scrollPageIntoView({
        pageNumber: 2,
        destArray: [{ num: 1 }, { name: "Fit" }],
      }),
    );
    await act(() => Promise.resolve());
    expect(pane.scrollTop).toBe(50);
  });

  it("keeps the scroll position when a destination cannot be converted to viewport space", async () => {
    harness.noViewportConversion = true;
    harness.pages = [page("one"), page("two")];
    renderViewer();
    await ready();
    const pane = scroller();
    pane.scrollTop = 40;

    act(() =>
      linkViewer().scrollPageIntoView({
        pageNumber: 2,
        destArray: [{ num: 1 }, { name: "XYZ" }, 0, 600, null],
      }),
    );
    await pageTextRendered(2);

    expect(pane.scrollTop).toBe(40);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
  });

  it("drives the current page through the link viewer adapter", async () => {
    harness.pages = [page("one"), page("two"), page("three")];
    const onPageChange = vi.fn();
    renderViewer({ onPageChange });
    await ready();
    const viewer = linkViewer();

    act(() => {
      viewer.currentPageNumber = 3;
    });

    expect(onPageChange).toHaveBeenLastCalledWith(3, 3);
    expect(viewer.currentPageNumber).toBe(3);
    await pageTextRendered(3);
  });

  it("re-renders live pages when an action changes optional content", async () => {
    harness.pages = [page("one")];
    renderViewer();
    await ready();
    await pageTextRendered(1);
    const nextConfig = Promise.resolve({ renderingIntent: "display", setOCGState: vi.fn() });

    act(() => {
      linkViewer().optionalContentConfigPromise = nextConfig as never;
    });

    await waitFor(() =>
      expect(harness.renderCalls.at(-1)?.optionalContentConfigPromise).toBe(nextConfig),
    );
    expect(harness.renderCalls.at(-1)?.pageNumber).toBe(1);
    expect(harness.renderCalls.filter((call) => call.pageNumber === 1)).toHaveLength(2);
  });

  it("opens safe annotation links in the host and disables blocked schemes", async () => {
    harness.pages = [page("one")];
    harness.annotationHrefs = ["https://example.org/paper", "javascript:alert(1)", "#section-2"];
    harness.pageClickToBp.mockReturnValue({ page: 1, x: 10, y: 20 });
    const onOpenLink = vi.fn();
    const onInverse = vi.fn();
    renderViewer({ onOpenLink, onInverse });
    await waitFor(() =>
      expect(pageWrap(1).querySelectorAll(".annotationLayer a")).toHaveLength(3),
    );
    const [safe, blocked, internal] = pageWrap(1).querySelectorAll<HTMLAnchorElement>(
      ".annotationLayer a",
    );

    expect(safe).toHaveAttribute("href", "https://example.org/paper");
    expect(safe).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(blocked).not.toHaveAttribute("href");
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    expect(blocked).toHaveAttribute("title", t("link.blockedScheme"));
    expect(internal).toHaveAttribute("href", "#section-2");

    const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
    safe.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(onOpenLink).toHaveBeenCalledWith("https://example.org/paper");
    expect(onInverse).not.toHaveBeenCalled();
  });
});

describe("PdfViewer inverse search clicks", () => {
  async function setup() {
    harness.pages = [page("alpha beta gamma")];
    harness.pageClickToBp.mockReturnValue({ page: 1, x: 72, y: 700 });
    const onInverse = vi.fn();
    renderViewer({ onInverse });
    await pageTextRendered(1);
    const span = pageWrap(1).querySelector<HTMLElement>(".textLayer span");
    if (!span) throw new Error("text span missing");
    span.getBoundingClientRect = () => rect(100, 10, 160, 12);
    return { onInverse, span };
  }

  function click(target: Element, clientX: number, clientY: number) {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, clientX, clientY, detail: 1 }),
    );
  }

  it("sends the clicked word with the PDF coordinates", async () => {
    const { onInverse, span } = await setup();

    click(span, 250, 15);

    expect(harness.pageClickToBp).toHaveBeenCalledWith(pageWrap(1), 1, { clientX: 250, clientY: 15 });
    expect(onInverse).toHaveBeenCalledWith(1, 72, 700, "gamma");
  });

  it("uses the centre of the clicked span when the event has no coordinates", async () => {
    const { onInverse, span } = await setup();

    click(span, 0, 0);

    expect(harness.pageClickToBp).toHaveBeenCalledWith(pageWrap(1), 1, { clientX: 180, clientY: 16 });
    expect(onInverse).toHaveBeenCalledWith(1, 72, 700, "beta");
  });

  it("resolves the word under the caret when the click misses every span", async () => {
    const { onInverse, span } = await setup();
    const textNode = span.firstChild as Text;
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: () => {
        const range = document.createRange();
        range.setStart(textNode, 7);
        return range;
      },
    });

    click(pageWrap(1), 500, 500);

    expect(onInverse).toHaveBeenCalledWith(1, 72, 700, "beta");
  });

  it("falls back to the standard caret position API", async () => {
    const { onInverse, span } = await setup();
    const textNode = span.firstChild as Text;
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offsetNode: textNode, offset: 1 }),
    });

    click(pageWrap(1), 500, 500);

    expect(onInverse).toHaveBeenCalledWith(1, 72, 700, "alpha");
  });

  it("falls back to the text span under the point, or no word at all", async () => {
    const { onInverse, span } = await setup();
    const elementFromPoint = vi.fn<(x: number, y: number) => Element | null>(() => span);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPoint,
    });

    click(pageWrap(1), 500, 500);
    expect(onInverse).toHaveBeenLastCalledWith(1, 72, 700, "alpha beta gamma");

    elementFromPoint.mockReturnValue(null);
    click(pageWrap(1), 500, 500);
    expect(onInverse).toHaveBeenLastCalledWith(1, 72, 700, undefined);
  });

  it("finds the span under the pointer when the click lands on its text node", async () => {
    const { onInverse, span } = await setup();

    span.firstChild?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 110, clientY: 15, detail: 1 }),
    );

    expect(onInverse).toHaveBeenCalledWith(1, 72, 700, "alpha");
  });

  it("keeps working while text elsewhere is selected and the click has no coordinates", async () => {
    const { onInverse } = await setup();
    const outside = document.createElement("p");
    outside.textContent = "selected elsewhere";
    document.body.append(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });

    click(pageWrap(1), 0, 0);

    expect(harness.pageClickToBp).toHaveBeenCalledWith(pageWrap(1), 1, { clientX: 0, clientY: 0 });
    expect(onInverse).toHaveBeenCalledWith(1, 72, 700, undefined);
    document.getSelection()?.removeAllRanges();
  });

  it("ignores clicks that miss the source map", async () => {
    const { onInverse, span } = await setup();
    harness.pageClickToBp.mockReturnValue(null);

    click(span, 250, 15);

    expect(onInverse).not.toHaveBeenCalled();
  });
});

describe("PdfViewer screen reader mode", () => {
  it("replaces the plain-text fallback with the tagged structure", async () => {
    harness.pages = [
      {
        width: 612,
        height: 792,
        items: [
          { type: "beginMarkedContentProps", id: "mc0" },
          text("Tagged title"),
          { type: "endMarkedContent" },
          text("Body copy"),
        ],
        structTree: { role: "Root", children: [{ role: "H1", children: [{ type: "content", id: "mc0" }] }] },
      },
    ];
    harness.pageClickToBp.mockReturnValue({ page: 1, x: 1, y: 1 });
    const onInverse = vi.fn();
    renderViewer({ screenReaderMode: true, onInverse });

    const heading = await screen.findByRole("heading", { level: 1, name: "Tagged title" });
    expect(heading.closest(".pdf-screen-reader-layer")).toHaveAccessibleName(
      t("screenReader.layer", { page: 1, total: 1 }),
    );

    heading.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(onInverse).not.toHaveBeenCalled();
  });

  it("keeps the plain-text layer for an untagged page", async () => {
    harness.pages = [{ ...page("Plain words"), structTree: new Error("no structure tree") }];
    renderViewer({ screenReaderMode: true });

    await waitFor(() =>
      expect(pageWrap(1).querySelector(".pdf-screen-reader-layer p")).toHaveTextContent(
        "Plain words",
      ),
    );
    await act(() => Promise.resolve());
    expect(pageWrap(1).querySelectorAll(".pdf-screen-reader-layer")).toHaveLength(1);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("keeps the reading layer and its styling when a page leaves the viewport", async () => {
    harness.pages = [page("First page"), page("Second page")];
    renderViewer({ screenReaderMode: true });
    await waitFor(() =>
      expect(pageWrap(1).querySelector(".pdf-screen-reader-layer")).toHaveTextContent(
        "First page",
      ),
    );

    intersect([1], false);

    expect(pageWrap(1).querySelector("canvas")).toBeNull();
    expect(pageWrap(1).querySelector(".pdf-screen-reader-layer")).toHaveTextContent("First page");
    expect(pageWrap(1)).toHaveClass("rounded-xl");
    expect(pageWrap(1).dataset.pdfScreenReader).toBe("true");
  });
});

describe("PdfViewer screen reader toggling", () => {
  it("switches a loaded document into and out of the reading layer", async () => {
    harness.pages = [page("First page"), page("Second page")];
    const { rerender } = renderViewer();
    await pageTextRendered(1);
    const wrap = pageWrap(1);
    const visualHeight = wrap.style.height;

    rerender({ screenReaderMode: true });
    await waitFor(() =>
      expect(wrap.querySelector(".pdf-screen-reader-layer")).toHaveTextContent("First page"),
    );
    expect(wrap).toHaveStyle({ height: "auto", minHeight: visualHeight });
    expect(wrap.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
    expect(pageWrap(2).dataset.pdfScreenReader).toBe("true");

    rerender({ screenReaderMode: false });

    expect(wrap.querySelector(".pdf-screen-reader-layer")).toBeNull();
    expect(wrap.style.height).toBe(visualHeight);
    expect(wrap.style.minHeight).toBe("");
    expect(wrap.querySelector("canvas")).not.toHaveAttribute("aria-hidden");
    expect(pageWrap(2).dataset.pdfScreenReader).toBe("false");

    rerender({ screenReaderMode: true });
    await waitFor(() =>
      expect(wrap.querySelectorAll(".pdf-screen-reader-layer")).toHaveLength(1),
    );
  });
});

describe("PdfViewer screen reader re-rendering", () => {
  it("replaces a retained reading layer when its page renders again", async () => {
    harness.pages = [page("First page"), page("Second page")];
    renderViewer({ screenReaderMode: true });
    await waitFor(() =>
      expect(pageWrap(1).querySelector(".pdf-screen-reader-layer")).toHaveTextContent("First page"),
    );
    intersect([1], false);
    const retained = pageWrap(1).querySelector(".pdf-screen-reader-layer");

    intersect([1], true);

    await waitFor(() => expect(pageWrap(1).querySelector("canvas")).not.toBeNull());
    await waitFor(() =>
      expect(pageWrap(1).querySelector(".pdf-screen-reader-layer")).not.toBe(retained),
    );
    expect(pageWrap(1).querySelectorAll(".pdf-screen-reader-layer")).toHaveLength(1);
    expect(retained?.isConnected).toBe(false);
  });

  it("drops a structure tree that arrives after reading mode was turned off", async () => {
    harness.pages = [
      {
        width: 612,
        height: 792,
        items: [
          { type: "beginMarkedContentProps", id: "mc0" },
          text("Late heading"),
          { type: "endMarkedContent" },
        ],
        structTree: { role: "Root", children: [{ role: "H1", children: [{ type: "content", id: "mc0" }] }] },
      },
    ];
    harness.structTreeGate = harness.gate();
    const { rerender } = renderViewer({ screenReaderMode: true });
    await waitFor(() =>
      expect(pageWrap(1).querySelector(".pdf-screen-reader-layer")).toHaveTextContent(
        "Late heading",
      ),
    );

    rerender({ screenReaderMode: false });
    act(() => harness.structTreeGate?.resolve());
    await act(() => Promise.resolve());

    expect(pageWrap(1).querySelector(".pdf-screen-reader-layer")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});

describe("PdfViewer render lifecycle", () => {
  it("releases a page proxy that arrives after its page left the viewport", async () => {
    harness.pages = [page("one"), page("two")];
    renderViewer();
    await ready();
    await waitFor(() => expect(pageWrap(2).dataset.pdfGeometry).toBe("exact"));
    harness.gates.set(2, harness.gate());
    const requestsBefore = harness.getPageCalls.filter((pageNumber) => pageNumber === 2).length;

    intersect([2], true);
    await waitFor(() =>
      expect(harness.getPageCalls.filter((pageNumber) => pageNumber === 2).length).toBe(
        requestsBefore + 1,
      ),
    );
    intersect([2], false);
    const cleanupsBefore = harness.pageCleanup.filter((pageNumber) => pageNumber === 2).length;
    act(() => harness.gates.get(2)?.resolve());

    await waitFor(() =>
      expect(harness.pageCleanup.filter((pageNumber) => pageNumber === 2).length).toBe(
        cleanupsBefore + 1,
      ),
    );
    expect(pageWrap(2).querySelector("canvas")).toBeNull();
    expect(harness.renderCalls.some((call) => call.pageNumber === 2)).toBe(false);
  });

  it("cancels a text layer that finishes after its page was evicted", async () => {
    harness.pages = [page("one"), page("two")];
    renderViewer();
    await pageTextRendered(1);
    harness.textLayerGate = harness.gate();

    intersect([2], true);
    await waitFor(() => expect(pageWrap(2).querySelector(".textLayer")).not.toBeNull());
    intersect([2], false);
    act(() => harness.textLayerGate?.resolve());

    await waitFor(() => expect(harness.textLayerCancelled).toBe(2));
    expect(pageWrap(2).querySelector(".textLayer")).toBeNull();
    expect(pageWrap(2).querySelector(".textLayer span")).toBeNull();
  });

  it("still renders annotations when the structure tree cannot be built", async () => {
    harness.pages = [page("one")];
    harness.annotationHrefs = ["https://example.org/"];
    harness.structTreeError = new Error("no structure tree");

    renderViewer();

    await waitFor(() =>
      expect(pageWrap(1).querySelector(".annotationLayer a")).toHaveAttribute(
        "href",
        "https://example.org/",
      ),
    );
  });

  it("evicts visible pages far from the current page when more than fourteen are visible", async () => {
    harness.pages = Array.from({ length: 20 }, (_, index) => page(`page ${index + 1}`));
    const { ref } = renderViewer();
    await ready();
    await waitFor(() => expect(pageWrap(20).dataset.pdfGeometry).toBe("exact"));
    intersect(
      Array.from({ length: 20 }, (_, index) => index + 1),
      true,
    );
    await waitFor(() => expect(renderer().querySelectorAll(".pdf-canvas")).toHaveLength(14));
    expect(pageWrap(1).querySelector("canvas")).not.toBeNull();

    act(() => ref.current?.gotoPage(20));
    intersect([20], true);

    await waitFor(() => expect(pageWrap(20).querySelector("canvas")).not.toBeNull());
    expect(pageWrap(1).querySelector("canvas")).toBeNull();
    expect(renderer().querySelectorAll(".pdf-canvas").length).toBeLessThanOrEqual(14);
  });

  it("cancels a pending placeholder resize when the zoom changes again or the document reloads", async () => {
    harness.pages = Array.from({ length: 40 }, (_, index) => page(`page ${index + 1}`));
    const view = renderViewer();
    await ready();
    await waitFor(() => expect(pageWrap(40).dataset.pdfGeometry).toBe("exact"));

    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame");
    view.rerender({ scale: 2 });
    view.rerender({ scale: 3 });
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(pageWrap(40)).toHaveStyle({ width: "1836px" }));
    expect(pageWrap(39)).toHaveStyle({ width: "1836px" });

    view.rerender({ scale: 1.5 });
    view.rerender({ scale: 1.5, data: new Uint8Array([2]) });
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(2);
    await ready();
    await waitFor(() => expect(pageWrap(40)).toHaveStyle({ width: "918px" }));
  });
});

describe("PdfViewer geometry", () => {
  it("applies the viewer rotation to every page", async () => {
    harness.pages = [page("one"), page("two"), page("three")];
    harness.gates.set(3, harness.gate());
    renderViewer({ rotation: -90 as never });
    await ready();

    expect(pageWrap(1).dataset.pdfRotation).toBe("270");
    expect(pageWrap(3).dataset.pdfGeometry).toBe("pending");
    expect(pageWrap(3).dataset.pdfRotation).toBe("270");
    expect(pageWrap(3)).toHaveStyle({ width: "820px", height: "640px" });
    await waitFor(() =>
      expect(harness.renderCalls).toContainEqual(
        expect.objectContaining({ pageNumber: 1, rotation: 270 }),
      ),
    );
  });

  it("marks a page whose geometry cannot be loaded when it scrolls into view", async () => {
    harness.pages = [page("one"), page("two")];
    harness.rejectedPages.add(2);
    renderViewer();
    await ready();
    await waitFor(() => expect(renderer().dataset.pdfGeometryState).toBe("partial"));
    expect(renderer().dataset.pdfGeometryError).toBe("Page 2: Error: page 2 is damaged");

    intersect([2], true);

    await waitFor(() => expect(pageWrap(2).dataset.pdfGeometry).toBe("error"));
    expect(pageWrap(2).dataset.pdfGeometryError).toBe("Error: page 2 is damaged");
    expect(pageWrap(2).querySelector("canvas")).toBeNull();
  });

  it("treats a zero device pixel ratio as one", async () => {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 0 });
    try {
      harness.pages = [page("one"), page("two")];
      const view = renderViewer();
      await pageTextRendered(1);

      expect(pageWrap(1).querySelector("canvas")).toHaveAttribute("width", "612");
      expect(pageWrap(2)).toHaveStyle({ width: "612px", height: "792px" });

      view.rerender({ scale: 2 });
      await waitFor(() => expect(pageWrap(2)).toHaveStyle({ width: "1224px" }));
      expect(pageWrap(1).querySelector("canvas")).toHaveStyle({ width: "1224px" });
    } finally {
      Reflect.deleteProperty(window, "devicePixelRatio");
    }
  });

  it("ignores intersection entries that are not page wrappers", async () => {
    harness.pages = [page("one"), page("two")];
    renderViewer();
    await pageTextRendered(1);
    const callback = harness.observerCallbacks.at(-1);
    const stray = document.createElement("div");

    act(() =>
      callback?.(
        [{ target: stray, isIntersecting: false } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );

    expect(pageWrap(1).querySelector("canvas")).not.toBeNull();
  });

  it("zooms a page without a text layer and drops off-screen renders once the zoom settles", async () => {
    harness.pages = [page("one"), page("two")];
    harness.textLayerErrorPages.add(1);
    const view = renderViewer();
    await waitFor(() => expect(pageWrap(1).querySelector("canvas")).not.toBeNull());
    act(() => view.ref.current?.gotoPage(2));
    await pageTextRendered(2);

    const settle: Array<() => void> = [];
    const nativeSetTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === 120 && typeof handler === "function") {
        settle.push(handler as () => void);
        return 0;
      }
      return nativeSetTimeout(handler, delay, ...args);
    }) as typeof window.setTimeout);

    view.rerender({ scale: 2 });
    await waitFor(() => expect(pageWrap(2)).toHaveStyle({ width: "1224px" }));
    expect(pageWrap(1)).toHaveStyle({ width: "1224px" });
    expect(pageWrap(1).dataset.pdfRasterScale).toBe("1");
    expect(pageWrap(2).querySelector("canvas")).not.toBeNull();
    expect(settle).toHaveLength(1);

    act(() => settle[0]());

    await waitFor(() => expect(pageWrap(1).dataset.pdfRasterScale).toBe("2"));
    expect(pageWrap(2).querySelector("canvas")).toBeNull();
    expect(pageWrap(2)).toHaveStyle({ width: "1224px" });
  });

  it("resizes off-screen placeholders in batches after a zoom", async () => {
    harness.pages = Array.from({ length: 40 }, (_, index) => page(`page ${index + 1}`));
    harness.gates.set(40, harness.gate());
    const view = renderViewer();
    await ready();
    await waitFor(() => expect(pageWrap(39).dataset.pdfGeometry).toBe("exact"));

    view.rerender({ scale: 2 });

    await waitFor(() => expect(pageWrap(39)).toHaveStyle({ width: "1224px", height: "1584px" }));
    expect(pageWrap(40)).toHaveStyle({ width: "1280px", height: "1640px" });
    expect(pageWrap(40).dataset.pdfGeometry).toBe("pending");
  });
});
