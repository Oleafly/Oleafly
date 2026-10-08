// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface PageSize {
  width: number;
  height: number;
}

interface RenderCall {
  documentId: number;
  pageNumber: number;
  scale: number;
  canvas: HTMLCanvasElement;
  resolve: () => void;
  cancelled: boolean;
}

const harness = vi.hoisted(() => ({
  documents: new Map<number, PageSize[]>(),
  observerCallbacks: [] as IntersectionObserverCallback[],
  renderCalls: [] as RenderCall[],
  textRequests: [] as Array<{ documentId: number; pageNumber: number; paintedBefore: boolean }>,
  deferRenders: false,
  blockedGeometry: new Set<string>(),
  reset() {
    this.documents = new Map([
      [1, [
        { width: 612, height: 792 },
        { width: 500, height: 700 },
        { width: 612, height: 792 },
        { width: 612, height: 792 },
      ]],
      [2, [
        { width: 612, height: 792 },
        { width: 500, height: 700 },
        { width: 612, height: 792 },
        { width: 612, height: 792 },
      ]],
    ]);
    this.observerCallbacks = [];
    this.renderCalls = [];
    this.textRequests = [];
    this.deferRenders = false;
    this.blockedGeometry = new Set();
  },
}));

vi.mock("./mainThreadWorker", () => ({ installMainThreadPdfWorker: vi.fn() }));
vi.mock("./pdfController", () => ({
  registerPdfView: vi.fn(),
  clearPdfView: vi.fn(),
  pageClickToBp: vi.fn(() => null),
}));
vi.mock("pdfjs-dist/web/pdf_viewer.mjs", () => ({
  EventBus: class {
    dispatch() {}
  },
  LinkTarget: { BLANK: 2 },
  DownloadManager: class {},
  PDFLinkService: class {
    eventBus = { dispatch() {} };
    setDocument() {}
    setViewer() {}
  },
  StructTreeLayerBuilder: class {
    render() {
      return Promise.resolve(null);
    }
    updateTextLayer() {}
    show() {}
    hide() {}
  },
}));
vi.mock("pdfjs-dist", () => {
  class MockViewport {
    readonly width: number;
    readonly height: number;
    readonly rotation = 0;
    readonly userUnit = 1;
    readonly rawDims: { pageWidth: number; pageHeight: number; pageX: number; pageY: number };

    constructor(
      readonly size: { width: number; height: number },
      readonly scale: number,
    ) {
      this.width = size.width * scale;
      this.height = size.height * scale;
      this.rawDims = { pageWidth: size.width, pageHeight: size.height, pageX: 0, pageY: 0 };
    }

    clone({ scale = this.scale }: { scale?: number; dontFlip?: boolean } = {}) {
      return new MockViewport(this.size, scale);
    }
  }

  const makePage = (documentId: number, pageNumber: number) => {
    const size = harness.documents.get(documentId)![pageNumber - 1];
    return {
      rotate: 0,
      getViewport: ({ scale }: { scale: number }) => new MockViewport(size, scale),
      getTextContent: () => {
        harness.textRequests.push({
          documentId,
          pageNumber,
          paintedBefore: harness.renderCalls.some(
            (call) =>
              call.documentId === documentId &&
              call.pageNumber === pageNumber &&
              call.canvas.isConnected,
          ),
        });
        return Promise.resolve({
          items: [{ str: `PAGE ${pageNumber}`, width: 120, height: 12, fontName: "f", transform: [1, 0, 0, 1, 0, 0] }],
          styles: { f: { vertical: false } },
        });
      },
      render: ({ viewport, canvas }: { viewport: MockViewport; canvas: HTMLCanvasElement }) => {
        let resolve!: () => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<void>((done, fail) => {
          resolve = done;
          reject = fail;
        });
        const call: RenderCall = {
          documentId,
          pageNumber,
          scale: viewport.scale,
          canvas,
          resolve,
          cancelled: false,
        };
        harness.renderCalls.push(call);
        if (!harness.deferRenders) resolve();
        return {
          promise,
          onContinue: null,
          cancel: () => {
            call.cancelled = true;
            reject(new Error("RenderingCancelledException"));
          },
        };
      },
      getAnnotations: () => Promise.resolve([]),
      getStructTree: () => Promise.resolve(null),
      cleanup: () => {},
    };
  };

  return {
    GlobalWorkerOptions: { workerSrc: "" },
    PasswordResponses: { INCORRECT_PASSWORD: 2 },
    normalizeUnicode: (value: string) => value,
    PDFWorker: class {
      promise = Promise.resolve();
      destroy() {}
    },
    getDocument: ({ data }: { data: Uint8Array }) => {
      const documentId = data[0];
      const pages = harness.documents.get(documentId)!;
      return {
        promise: Promise.resolve({
          numPages: pages.length,
          annotationStorage: {},
          getOptionalContentConfig: () => Promise.resolve({}),
          getPage: (pageNumber: number) => {
            if (harness.blockedGeometry.has(`${documentId}:${pageNumber}`)) {
              return new Promise(() => {});
            }
            return Promise.resolve(makePage(documentId, pageNumber));
          },
        }),
        destroy: () => Promise.resolve(),
      };
    },
    TextLayer: class {
      readonly textDivs: HTMLElement[] = [];
      constructor(private readonly options: { container: HTMLElement }) {}
      async render() {
        const span = document.createElement("span");
        span.textContent = "text";
        this.textDivs.push(span);
        this.options.container.append(span);
      }
      cancel() {}
    },
    AnnotationLayer: class {
      render() {
        return Promise.resolve();
      }
      destroy() {}
    },
  };
});

import { PdfViewer } from "./PdfViewer";

beforeEach(() => {
  harness.reset();
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
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
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function intersect(pageNumbers: number[], isIntersecting = true): void {
  const callback = harness.observerCallbacks.at(-1);
  if (!callback) throw new Error("Intersection observer is not installed");
  callback(
    pageNumbers.map(
      (pageNumber) =>
        ({
          target: document.querySelector(`[data-page="${pageNumber}"]`),
          isIntersecting,
        }) as IntersectionObserverEntry,
    ),
    {} as IntersectionObserver,
  );
}

function captureSettleTimer() {
  const settle: Array<() => void> = [];
  const nativeSetTimeout = window.setTimeout.bind(window);
  const spy = vi.spyOn(window, "setTimeout").mockImplementation(((
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
  return { settle, restore: () => spy.mockRestore() };
}

async function openViewer(scale = 1, documentId = 1, identity = "doc-1") {
  const onPageChange = vi.fn();
  const data = new Uint8Array([documentId]);
  const view = render(
    <PdfViewer
      data={data}
      documentIdentity={identity}
      scale={scale}
      expectText={false}
      onPageChange={onPageChange}
    />,
  );
  const renderer = view.getByTestId("pdf-renderer");
  await waitFor(() => expect(renderer.dataset.pdfState).toBe("ready"));
  const scrollParent = renderer.parentElement as HTMLElement;
  const wrap = (pageNumber: number) =>
    view.container.querySelector<HTMLElement>(`[data-page='${pageNumber}']`)!;
  return { view, renderer, scrollParent, wrap, onPageChange, data };
}

function baseCanvases(wrap: HTMLElement): HTMLCanvasElement[] {
  return [...wrap.querySelectorAll<HTMLCanvasElement>(":scope > canvas")].filter(
    (canvas) => !canvas.classList.contains("pdf-canvas-detail"),
  );
}

describe("PdfViewer raster swaps", () => {
  it("attaches a page's canvas only once its raster has painted", async () => {
    harness.deferRenders = true;
    const { wrap } = await openViewer();
    await waitFor(() => expect(harness.renderCalls.some((call) => call.pageNumber === 1)).toBe(true));
    const call = harness.renderCalls.find((entry) => entry.pageNumber === 1)!;
    expect(call.canvas.isConnected).toBe(false);
    expect(baseCanvases(wrap(1))).toEqual([]);

    await act(async () => call.resolve());
    await waitFor(() => expect(call.canvas.isConnected).toBe(true));
    expect(baseCanvases(wrap(1))).toEqual([call.canvas]);
    expect(wrap(1).firstElementChild).toBe(call.canvas);
  });

  it("builds the text layer after the canvas has painted", async () => {
    harness.deferRenders = true;
    const { wrap } = await openViewer();
    await waitFor(() => expect(harness.renderCalls.length).toBeGreaterThan(0));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(harness.textRequests).toEqual([]);

    await act(async () => harness.renderCalls[0].resolve());
    await waitFor(() => expect(wrap(1).querySelector(".textLayer span")).not.toBeNull());
    expect(harness.textRequests[0]).toMatchObject({ pageNumber: 1, paintedBefore: true });
  });

  it("keeps the text layer selectable", async () => {
    const { wrap } = await openViewer();
    await waitFor(() => expect(wrap(1).querySelector(".textLayer")).not.toBeNull());
    expect(wrap(1).querySelector(".textLayer")).toHaveClass("select-text");
  });

  it("keeps the previous raster on screen until the re-render at a new scale paints", async () => {
    const { view, wrap, data } = await openViewer(1);
    await waitFor(() => expect(baseCanvases(wrap(1))).toHaveLength(1));
    const previous = baseCanvases(wrap(1))[0];
    const timers = captureSettleTimer();
    try {
      harness.deferRenders = true;
      view.rerender(
        <PdfViewer data={data} documentIdentity="doc-1" scale={2} expectText={false} />,
      );
      await waitFor(() => expect(wrap(1).style.width).toBe("1224px"));
      expect(previous.style.width).toBe("1224px");
      act(() => timers.settle.at(-1)?.());
      await waitFor(() =>
        expect(harness.renderCalls.some((call) => call.pageNumber === 1 && call.scale === 2)).toBe(true),
      );
      const next = harness.renderCalls.find((call) => call.pageNumber === 1 && call.scale === 2)!;
      expect(previous.isConnected).toBe(true);
      expect(previous.width).toBeGreaterThan(0);
      expect(next.canvas.isConnected).toBe(false);

      await act(async () => next.resolve());
      await waitFor(() => expect(next.canvas.isConnected).toBe(true));
      expect(previous.isConnected).toBe(false);
      expect(previous.width).toBe(0);
      expect(baseCanvases(wrap(1))).toEqual([next.canvas]);
      await waitFor(() => expect(wrap(1).querySelector(".textLayer span")).not.toBeNull());
      const layer = wrap(1).querySelector<HTMLElement>(".textLayer")!;
      expect(layer.style.transform).toBe("");
      expect(layer.style.getPropertyValue("--scale-factor")).toBe("2");
    } finally {
      timers.restore();
    }
  });

  it("does not measure text layers on every zoom step", async () => {
    const { view, wrap, data } = await openViewer(1);
    await waitFor(() => expect(wrap(1).querySelector(".textLayer span")).not.toBeNull());
    const timers = captureSettleTimer();
    const computed = vi.spyOn(window, "getComputedStyle");
    try {
      for (const scale of [1.1, 1.2, 1.3]) {
        view.rerender(
          <PdfViewer data={data} documentIdentity="doc-1" scale={scale} expectText={false} />,
        );
      }
      await waitFor(() => expect(wrap(1).style.width).toBe(`${Math.floor(612 * 1.3)}px`));
      const textLayerReads = computed.mock.calls.filter(([element]) =>
        (element as Element).classList?.contains("textLayer"),
      );
      expect(textLayerReads).toEqual([]);
      const layer = wrap(1).querySelector<HTMLElement>(".textLayer")!;
      expect(layer.style.display).toBe("");
      expect(layer.style.getPropertyValue("--scale-factor")).toBe("1.3");
      expect(layer.style.getPropertyValue("--min-font-size")).toBe(String(1 / 1.3));
      expect(layer.style.transform).toBe("");

      view.rerender(
        <PdfViewer data={data} documentIdentity="doc-1" scale={1} expectText={false} />,
      );
      await waitFor(() => expect(layer.style.getPropertyValue("--scale-factor")).toBe("1"));
      expect(layer.style.getPropertyValue("--min-font-size")).toBe("");
    } finally {
      computed.mockRestore();
      timers.restore();
    }
  });
});

describe("PdfViewer reloads", () => {
  it("keeps each page's old raster on screen until the new document paints it", async () => {
    const { view, wrap } = await openViewer(1, 1, "doc-1");
    await waitFor(() => expect(baseCanvases(wrap(1))).toHaveLength(1));
    const old = baseCanvases(wrap(1))[0];

    harness.deferRenders = true;
    view.rerender(
      <PdfViewer data={new Uint8Array([2])} documentIdentity="doc-2" scale={1} expectText={false} />,
    );
    await waitFor(() =>
      expect(harness.renderCalls.some((call) => call.documentId === 2 && call.pageNumber === 1)).toBe(true),
    );
    expect(old.isConnected).toBe(true);
    expect(old.width).toBeGreaterThan(0);
    expect(old.closest("[data-page]")).toBe(wrap(1));
    expect(old.dataset.pdfRaster).toBe("stale");

    const fresh = harness.renderCalls.find((call) => call.documentId === 2 && call.pageNumber === 1)!;
    await act(async () => fresh.resolve());
    await waitFor(() => expect(fresh.canvas.isConnected).toBe(true));
    expect(old.isConnected).toBe(false);
    expect(old.width).toBe(0);
    expect(baseCanvases(wrap(1))).toEqual([fresh.canvas]);
  });

  it("lays a reloaded document out with the previous page sizes until its own arrive", async () => {
    const { view, wrap, renderer } = await openViewer(1, 1, "doc-1");
    await waitFor(() => expect(wrap(2).dataset.pdfGeometry).toBe("exact"));
    expect(wrap(2).style.width).toBe("500px");

    harness.blockedGeometry.add("2:2");
    view.rerender(
      <PdfViewer data={new Uint8Array([2])} documentIdentity="doc-2" scale={1} expectText={false} />,
    );
    await waitFor(() => expect(renderer.dataset.pdfState).toBe("loading-primary"));
    await waitFor(() => expect(renderer.dataset.pdfState).toBe("ready"));
    expect(wrap(2).dataset.pdfGeometry).toBe("pending");
    expect(wrap(2).style.width).toBe("500px");
    expect(wrap(2).style.height).toBe("700px");
  });

  it("keeps the reader's scroll offset across a reload", async () => {
    const { view, scrollParent, renderer, onPageChange } = await openViewer(1, 1, "doc-1");
    scrollParent.scrollTop = 1_700;
    onPageChange.mockClear();
    view.rerender(
      <PdfViewer
        data={new Uint8Array([2])}
        documentIdentity="doc-2"
        scale={1}
        expectText={false}
        onPageChange={onPageChange}
      />,
    );
    await waitFor(() => expect(renderer.dataset.pdfState).toBe("loading-primary"));
    await waitFor(() => expect(renderer.dataset.pdfState).toBe("ready"));
    expect(scrollParent.scrollTop).toBe(1_700);
  });
});

describe("PdfViewer scrolling", () => {
  function layOut(scrollParent: HTMLElement, wrap: (page: number) => HTMLElement, pages: number) {
    const pageHeight = 800;
    Object.defineProperty(scrollParent, "clientHeight", { configurable: true, value: 600 });
    scrollParent.getBoundingClientRect = () =>
      ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    for (let page = 1; page <= pages; page++) {
      const top = 16 + (page - 1) * (pageHeight + 16);
      wrap(page).getBoundingClientRect = () => {
        const y = top - scrollParent.scrollTop;
        return { top: y, bottom: y + pageHeight, left: 0, right: 612, width: 612, height: pageHeight, x: 0, y, toJSON: () => ({}) } as DOMRect;
      };
    }
  }

  it("reports the page in view after a jump before the observer catches up", async () => {
    const { scrollParent, wrap, onPageChange } = await openViewer();
    layOut(scrollParent, wrap, 4);
    act(() => intersect([1], true));
    onPageChange.mockClear();

    scrollParent.scrollTop = 16 + 2 * 816 + 100;
    act(() => scrollParent.dispatchEvent(new Event("scroll")));
    await waitFor(() => expect(onPageChange).toHaveBeenLastCalledWith(3, 4));
  });

  it("waits for a fast scroll to slow down before rendering the pages it reached", async () => {
    const { scrollParent, wrap } = await openViewer();
    layOut(scrollParent, wrap, 4);
    await waitFor(() => expect(harness.renderCalls.length).toBeGreaterThan(0));
    const before = harness.renderCalls.length;

    let clock = performance.now();
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    scrollParent.scrollTop = 16 + 816 + 300;
    act(() => scrollParent.dispatchEvent(new Event("scroll")));
    clock += 16;
    scrollParent.scrollTop = 16 + 3 * 816;
    act(() => scrollParent.dispatchEvent(new Event("scroll")));
    clock += 16;
    act(() => intersect([1], false));
    act(() => intersect([4], true));
    for (let tick = 0; tick < 50; tick++) await Promise.resolve();
    expect(harness.renderCalls.slice(before).map((call) => call.pageNumber)).toEqual([]);
    now.mockRestore();

    await waitFor(() =>
      expect(harness.renderCalls.slice(before).map((call) => call.pageNumber)).toContain(4),
    );
  });

  it("keeps the reader's place in view while a zoom resizes the pages", async () => {
    const { view, scrollParent, wrap, data } = await openViewer(1);
    await waitFor(() => expect(wrap(4).dataset.pdfGeometry).toBe("exact"));
    Object.defineProperty(scrollParent, "clientHeight", { configurable: true, value: 600 });
    Object.defineProperty(scrollParent, "clientWidth", { configurable: true, value: 800 });
    scrollParent.getBoundingClientRect = () =>
      ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const pageTop = (page: number) => {
      let top = 16;
      for (let index = 1; index < page; index++) {
        top += Number.parseFloat(wrap(index).style.height) + 16;
      }
      return top;
    };
    for (let page = 1; page <= 4; page++) {
      wrap(page).getBoundingClientRect = () => {
        const height = Number.parseFloat(wrap(page).style.height);
        const width = Number.parseFloat(wrap(page).style.width);
        const y = pageTop(page) - scrollParent.scrollTop;
        return { top: y, bottom: y + height, left: 0, right: width, width, height, x: 0, y, toJSON: () => ({}) } as DOMRect;
      };
    }
    scrollParent.scrollTop = pageTop(3) + 0.25 * 792;
    const timers = captureSettleTimer();
    try {
      view.rerender(
        <PdfViewer data={data} documentIdentity="doc-1" scale={2} expectText={false} />,
      );
      await waitFor(() => expect(wrap(4).style.height).toBe("1584px"));
      await waitFor(() =>
        expect(scrollParent.scrollTop).toBeCloseTo(pageTop(3) + 0.25 * 1584, 0),
      );
    } finally {
      timers.restore();
    }
  });

  it("builds a page's text layer only once scrolling has settled", async () => {
    const { scrollParent, wrap } = await openViewer();
    layOut(scrollParent, wrap, 4);
    await waitFor(() => expect(wrap(1).querySelector(".textLayer span")).not.toBeNull());

    scrollParent.scrollTop = 400;
    const keepScrolling = setInterval(() => scrollParent.dispatchEvent(new Event("scroll")), 10);
    try {
      act(() => scrollParent.dispatchEvent(new Event("scroll")));
      act(() => intersect([2], true));
      await waitFor(() =>
        expect(harness.renderCalls.some((call) => call.pageNumber === 2 && call.canvas.isConnected)).toBe(true),
      );
      await act(() => new Promise((resolve) => setTimeout(resolve, 40)));
      expect(wrap(2).querySelector(".textLayer")).not.toBeNull();
      expect(wrap(2).querySelector(".textLayer span")).toBeNull();
    } finally {
      clearInterval(keepScrolling);
    }

    await waitFor(() => expect(wrap(2).querySelector(".textLayer span")).not.toBeNull());
  });

  it("shows a low-resolution copy of a page it rendered before while that page renders again", async () => {
    const drawImage = vi.fn();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    const { scrollParent, wrap } = await openViewer();
    layOut(scrollParent, wrap, 4);
    await waitFor(() => expect(baseCanvases(wrap(1))).toHaveLength(1));
    const painted = baseCanvases(wrap(1))[0];
    expect(drawImage).toHaveBeenCalledWith(painted, 0, 0, expect.any(Number), expect.any(Number));

    act(() => intersect([1], false));
    await waitFor(() => expect(painted.isConnected).toBe(false));
    expect(wrap(1).querySelector("canvas")).toBeNull();

    harness.deferRenders = true;
    scrollParent.scrollTop = 2_000;
    act(() => scrollParent.dispatchEvent(new Event("scroll")));
    scrollParent.scrollTop = 0;
    scrollParent.dispatchEvent(new Event("scroll"));
    expect(wrap(1).querySelector("canvas[data-pdf-raster='preview']")).not.toBeNull();
    const preview = wrap(1).querySelector<HTMLCanvasElement>("canvas[data-pdf-raster='preview']")!;
    expect(preview.width).toBeLessThanOrEqual(192);
    expect(preview.style.width).toBe("100%");

    await waitFor(() =>
      expect(harness.renderCalls.filter((call) => call.pageNumber === 1).length).toBeGreaterThan(1),
    );
    const again = harness.renderCalls.filter((call) => call.pageNumber === 1).at(-1)!;
    await act(async () => again.resolve());
    await waitFor(() => expect(again.canvas.isConnected).toBe(true));
    expect(preview.isConnected).toBe(false);
    expect(preview.width).toBeGreaterThan(0);
  });
});

describe("PdfViewer out of the document", () => {
  it("keeps the pages it painted while the app holds it out of the page", async () => {
    const { view, wrap } = await openViewer();
    await waitFor(() => expect(baseCanvases(wrap(1))).toHaveLength(1));
    const painted = baseCanvases(wrap(1))[0];
    const page = view.container.parentElement as HTMLElement;

    view.container.remove();
    act(() => intersect([1], false));
    page.appendChild(view.container);
    act(() => intersect([1], true));

    expect(baseCanvases(wrap(1))).toEqual([painted]);
    expect(painted.isConnected).toBe(true);
  });

  it("still drops a page that scrolls out of view", async () => {
    const { wrap } = await openViewer();
    await waitFor(() => expect(baseCanvases(wrap(1))).toHaveLength(1));
    const painted = baseCanvases(wrap(1))[0];

    act(() => intersect([1], false));

    await waitFor(() => expect(painted.isConnected).toBe(false));
  });
});
