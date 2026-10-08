// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PDF_CANVAS_PIXELS } from "./pdfLayerGeometry";

interface RenderCall {
  pageNumber: number;
  scale: number;
  transform?: number[];
  canvas: HTMLCanvasElement;
  canvasWidth: number;
  canvasHeight: number;
}

const harness = vi.hoisted(() => ({
  observerCallbacks: [] as IntersectionObserverCallback[],
  renderCalls: [] as RenderCall[],
  cancelled: 0,
  mediaQueries: [] as string[],
  mediaListeners: [] as Array<() => void>,
  textGate: null as Promise<void> | null,
  reset() {
    this.observerCallbacks = [];
    this.renderCalls = [];
    this.cancelled = 0;
    this.mediaQueries = [];
    this.mediaListeners = [];
    this.textGate = null;
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
    readonly rawDims = { pageWidth: 612, pageHeight: 792, pageX: 0, pageY: 0 };

    constructor(readonly scale: number) {
      this.width = 612 * scale;
      this.height = 792 * scale;
    }

    clone({ scale = this.scale }: { scale?: number; dontFlip?: boolean } = {}) {
      return new MockViewport(scale);
    }
  }

  const makePage = (pageNumber: number) => ({
    rotate: 0,
    getViewport: ({ scale }: { scale: number }) => new MockViewport(scale),
    getTextContent: async () => {
      if (harness.textGate) await harness.textGate;
      return {
        items: [{ str: `PAGE ${pageNumber}`, width: 120, height: 12, fontName: "f", transform: [1, 0, 0, 1, 0, 0] }],
        styles: { f: { vertical: false } },
      };
    },
    render: ({
      viewport,
      transform,
      canvas,
    }: {
      viewport: MockViewport;
      transform?: number[];
      canvas: HTMLCanvasElement;
    }) => {
      harness.renderCalls.push({
        pageNumber,
        scale: viewport.scale,
        transform,
        canvas,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      });
      return {
        promise: Promise.resolve(),
        cancel: () => {
          harness.cancelled++;
        },
      };
    },
    getAnnotations: () => Promise.resolve([]),
    getStructTree: () => Promise.resolve(null),
    cleanup: () => {},
  });

  return {
    GlobalWorkerOptions: { workerSrc: "" },
    PasswordResponses: { INCORRECT_PASSWORD: 2 },
    normalizeUnicode: (value: string) => value,
    PDFWorker: class {
      promise = Promise.resolve();
      destroy() {}
    },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        annotationStorage: {},
        getOptionalContentConfig: () => Promise.resolve({}),
        getPage: (pageNumber: number) => Promise.resolve(makePage(pageNumber)),
      }),
      destroy: () => Promise.resolve(),
    }),
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

function domRect(left: number, top: number, width: number, height: number): DOMRect {
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

function setDevicePixelRatio(value: number): void {
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value });
}

beforeEach(() => {
  harness.reset();
  setDevicePixelRatio(2);
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
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => {
      harness.mediaQueries.push(query);
      return {
        matches: true,
        media: query,
        addEventListener: (_type: string, listener: () => void) => {
          harness.mediaListeners.push(listener);
        },
        removeEventListener: (_type: string, listener: () => void) => {
          harness.mediaListeners = harness.mediaListeners.filter((item) => item !== listener);
        },
      };
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

interface Scene {
  wrap: HTMLElement;
  scrollParent: HTMLElement;
  base: () => HTMLCanvasElement | null;
  detail: () => HTMLCanvasElement | null;
  place: (pageLeft: number, pageTop: number) => void;
  zoom: (scale: number) => void;
}

async function openPage(scale: number, viewport: [number, number]): Promise<Scene> {
  const data = new Uint8Array([1]);
  const view = render(<PdfViewer data={data} scale={scale} expectText={false} />);
  const renderer = view.getByTestId("pdf-renderer");
  await waitFor(() => expect(renderer.dataset.pdfState).toBe("ready"));
  const scrollParent = renderer.parentElement as HTMLElement;
  const wrap = view.container.querySelector<HTMLElement>("[data-page='1']")!;
  const place = (pageLeft: number, pageTop: number) => {
    scrollParent.getBoundingClientRect = () => domRect(0, 0, viewport[0], viewport[1]);
    wrap.getBoundingClientRect = () =>
      domRect(pageLeft, pageTop, Number.parseFloat(wrap.style.width), Number.parseFloat(wrap.style.height));
  };
  place(0, 0);
  await waitFor(() => expect(wrap.dataset.pdfRasterScale).toBe(String(scale)));
  return {
    wrap,
    scrollParent,
    base: () => wrap.querySelector<HTMLCanvasElement>(":scope > .pdf-canvas"),
    detail: () => wrap.querySelector<HTMLCanvasElement>(":scope > .pdf-canvas-detail"),
    place,
    zoom: (next) => {
      view.rerender(<PdfViewer data={data} scale={next} expectText={false} />);
    },
  };
}

function scroll(scrollParent: HTMLElement): void {
  act(() => {
    scrollParent.dispatchEvent(new Event("scroll"));
  });
}

describe("PdfViewer raster resolution", () => {
  it("backs a page within budget with exactly one device pixel per screen pixel", async () => {
    const scene = await openPage(1, [800, 600]);
    const base = scene.base()!;
    expect(base.width).toBe(612 * 2);
    expect(base.height).toBe(792 * 2);
    expect(base.style.width).toBe("612px");
    expect(base.style.height).toBe("792px");
    expect(scene.wrap.dataset.pdfCanvasScaling).toBe("native");
    await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
    expect(scene.detail()).toBeNull();
    expect(scene.wrap.dataset.pdfDetail).toBeUndefined();
    expect(harness.renderCalls.filter((call) => call.pageNumber === 1)).toHaveLength(1);
  });

  it("renders the visible region at full device resolution when the page exceeds the canvas budget", async () => {
    const scene = await openPage(2.5, [800, 600]);
    const base = scene.base()!;
    expect(scene.wrap.dataset.pdfCanvasScaling).toBe("restricted");
    expect(base.width * base.height).toBeLessThanOrEqual(MAX_PDF_CANVAS_PIXELS);
    expect(base.width).toBeLessThan(1530 * 2);

    await waitFor(() => expect(scene.wrap.dataset.pdfDetail).toBe("ready"));
    const detail = scene.detail()!;
    const cssWidth = Number.parseFloat(detail.style.width);
    const cssHeight = Number.parseFloat(detail.style.height);
    expect(detail.style.left).toBe("0px");
    expect(detail.style.top).toBe("0px");
    expect(cssWidth).toBeGreaterThanOrEqual(800);
    expect(cssHeight).toBeGreaterThanOrEqual(600);
    expect(detail.width).toBe(cssWidth * 2);
    expect(detail.height).toBe(cssHeight * 2);
    expect(detail.width * detail.height).toBeLessThanOrEqual(MAX_PDF_CANVAS_PIXELS);
    expect(detail.previousElementSibling).toBe(base);
    expect(detail.nextElementSibling).toHaveClass("textLayer");
    expect(detail).toHaveAttribute("aria-hidden", "true");

    const detailCall = harness.renderCalls.find((call) => call.canvas === detail)!;
    expect(detailCall.scale).toBe(2.5);
    expect(detailCall.transform).toEqual([2, 0, 0, 2, 0, 0]);
    expect(detailCall.canvasWidth).toBe(detail.width);
  });

  it("keeps the detail canvas hidden from assistive technology after the text layer arrives", async () => {
    let releaseText: () => void = () => {};
    harness.textGate = new Promise<void>((resolve) => {
      releaseText = resolve;
    });
    const scene = await openPage(2.5, [800, 600]);
    await waitFor(() => expect(scene.wrap.dataset.pdfDetail).toBe("ready"));
    expect(scene.wrap.querySelector(".textLayer span")).toBeNull();
    releaseText();
    await waitFor(() => expect(scene.wrap.querySelector(".textLayer span")).not.toBeNull());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(scene.detail()).toHaveAttribute("aria-hidden", "true");
  });

  it("moves the detail canvas with the viewport and releases it when the page leaves", async () => {
    const scene = await openPage(2.5, [800, 600]);
    await waitFor(() => expect(scene.wrap.dataset.pdfDetail).toBe("ready"));
    const first = scene.detail()!;
    const firstBottom = Number.parseFloat(first.style.top) + Number.parseFloat(first.style.height);

    scene.place(0, -(firstBottom + 100));
    scroll(scene.scrollParent);
    await waitFor(() => expect(scene.detail()).not.toBe(first));
    await waitFor(() => expect(scene.wrap.dataset.pdfDetail).toBe("ready"));
    const second = scene.detail()!;
    const top = Number.parseFloat(second.style.top);
    const bottom = top + Number.parseFloat(second.style.height);
    expect(top).toBeLessThanOrEqual(firstBottom + 100);
    expect(bottom).toBeGreaterThanOrEqual(firstBottom + 100 + 600);
    expect(second.width).toBe(Number.parseFloat(second.style.width) * 2);
    expect(second.height).toBe(Number.parseFloat(second.style.height) * 2);
    expect(first.isConnected).toBe(false);
    expect(first.width).toBe(0);
    expect(first.height).toBe(0);
    expect(scene.wrap.querySelectorAll(":scope > canvas")).toHaveLength(2);

    scene.place(0, 5_000);
    scroll(scene.scrollParent);
    await waitFor(() => expect(scene.detail()).toBeNull());
    expect(second.width).toBe(0);
    expect(second.height).toBe(0);
    expect(scene.wrap.dataset.pdfDetail).toBeUndefined();
    expect(scene.base()).not.toBeNull();
  });

  it("snaps the detail area to whole device pixels at a fractional ratio", async () => {
    setDevicePixelRatio(1.25);
    const scene = await openPage(4, [801, 601]);
    scene.place(-10, -6);
    scroll(scene.scrollParent);
    await waitFor(() => expect(scene.wrap.dataset.pdfDetail).toBe("ready"));
    const detail = scene.detail()!;
    const left = Number.parseFloat(detail.style.left);
    const top = Number.parseFloat(detail.style.top);
    const cssWidth = Number.parseFloat(detail.style.width);
    const cssHeight = Number.parseFloat(detail.style.height);
    for (const value of [left, top, cssWidth, cssHeight]) {
      expect(value % 4).toBe(0);
    }
    expect(left).toBeLessThanOrEqual(10);
    expect(top).toBeLessThanOrEqual(6);
    expect(left + cssWidth).toBeGreaterThanOrEqual(811);
    expect(top + cssHeight).toBeGreaterThanOrEqual(607);
    expect(detail.width).toBe(cssWidth * 1.25);
    expect(detail.height).toBe(cssHeight * 1.25);
    expect(Number.isInteger(detail.width)).toBe(true);
    expect(Number.isInteger(detail.height)).toBe(true);
    const detailCall = harness.renderCalls.find((call) => call.canvas === detail)!;
    expect(detailCall.transform).toEqual([1.25, 0, 0, 1.25, 0 - left * 1.25, 0 - top * 1.25]);
  });

  it("re-renders live pages when the device pixel ratio changes", async () => {
    setDevicePixelRatio(1);
    const scene = await openPage(1, [800, 600]);
    expect(scene.base()!.width).toBe(612);
    expect(harness.mediaQueries).toContain("(resolution: 1dppx)");
    const callsBefore = harness.renderCalls.length;

    setDevicePixelRatio(2);
    act(() => {
      for (const listener of [...harness.mediaListeners]) listener();
    });

    await waitFor(() => expect(scene.base()?.width).toBe(612 * 2));
    expect(scene.base()!.height).toBe(792 * 2);
    expect(scene.base()!.style.width).toBe("612px");
    expect(harness.renderCalls.length).toBeGreaterThan(callsBefore);
    expect(harness.mediaQueries).toContain("(resolution: 2dppx)");
  });

  it("stretches the detail canvas with the page while a zoom gesture is in flight", async () => {
    const scene = await openPage(2.5, [800, 600]);
    await waitFor(() => expect(scene.wrap.dataset.pdfDetail).toBe("ready"));
    const detail = scene.detail()!;
    const widthBefore = Number.parseFloat(detail.style.width);
    const heightBefore = Number.parseFloat(detail.style.height);

    const settle: Array<() => void> = [];
    const nativeSetTimeout = window.setTimeout.bind(window);
    const timers = vi.spyOn(window, "setTimeout").mockImplementation(((
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
    try {
      const rendersBefore = harness.renderCalls.length;
      scene.zoom(3);
      await waitFor(() =>
        expect(Number.parseFloat(scene.wrap.style.width)).toBeGreaterThan(1829),
      );
      expect(Number.parseFloat(scene.wrap.style.width)).toBeLessThanOrEqual(1836);
      expect(settle).toHaveLength(1);
      expect(detail.isConnected).toBe(true);
      expect(Number.parseFloat(detail.style.width)).toBeCloseTo(widthBefore * 1.2, 6);
      expect(Number.parseFloat(detail.style.height)).toBeCloseTo(heightBefore * 1.2, 6);
      expect(scene.base()!.style.width).toBe(scene.wrap.style.width);
      expect(harness.renderCalls.length).toBe(rendersBefore);

      act(() => settle[0]());
      await waitFor(() => expect(scene.wrap.dataset.pdfRasterScale).toBe("3"));
      await waitFor(() => expect(scene.detail()).not.toBe(detail));
      await waitFor(() => expect(scene.wrap.dataset.pdfDetail).toBe("ready"));
      expect(detail.width).toBe(0);
      const replacement = scene.detail()!;
      expect(replacement.width).toBe(Number.parseFloat(replacement.style.width) * 2);
      expect(harness.renderCalls.find((call) => call.canvas === replacement)?.scale).toBe(3);
    } finally {
      timers.mockRestore();
    }
  });
});
