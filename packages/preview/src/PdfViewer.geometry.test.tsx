// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface PageSpec {
  width: number;
  height: number;
  rotation: number;
  userUnit: number;
}

const harness = vi.hoisted(() => ({
  specs: [
    { width: 612, height: 792, rotation: 0, userUnit: 1 },
    { width: 900, height: 630, rotation: 90, userUnit: 1.5 },
  ] as PageSpec[],
  observerCallbacks: [] as IntersectionObserverCallback[],
  ensurePageRendered: null as ((pageNumber: number) => void) | null,
  renderCalls: [] as Array<{
    pageNumber: number;
    scale: number;
    width: number;
    height: number;
    transform?: number[];
  }>,
  textViewports: [] as Array<{ scale: number; width: number; height: number; rotation: number; userUnit: number }>,
  annotationViewports: [] as Array<{ scale: number; width: number; height: number; rotation: number; userUnit: number }>,
  annotationOptionalConfigs: [] as unknown[],
  optionalContentIntents: [] as string[],
  annotationDestroyed: 0,
  pageCleanup: 0,
  linkApisExercised: 0,
  structureUpdated: 0,
  getPageCalls: [] as number[],
  throwTextGeometry: false,
  rejectedPages: new Set<number>(),
  deferredPages: new Map<
    number,
    {
      promise: Promise<void>;
      resolve: () => void;
    }
  >(),
  deferPage(pageNumber: number) {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    this.deferredPages.set(pageNumber, { promise, resolve });
  },
  resolvePage(pageNumber: number) {
    this.deferredPages.get(pageNumber)?.resolve();
    this.deferredPages.delete(pageNumber);
  },
  reset(specs?: PageSpec[]) {
    this.specs = specs ?? [
      { width: 612, height: 792, rotation: 0, userUnit: 1 },
      { width: 900, height: 630, rotation: 90, userUnit: 1.5 },
    ];
    this.observerCallbacks = [];
    this.ensurePageRendered = null;
    this.renderCalls = [];
    this.textViewports = [];
    this.annotationViewports = [];
    this.annotationOptionalConfigs = [];
    this.optionalContentIntents = [];
    this.annotationDestroyed = 0;
    this.pageCleanup = 0;
    this.linkApisExercised = 0;
    this.structureUpdated = 0;
    this.getPageCalls = [];
    this.throwTextGeometry = false;
    this.rejectedPages.clear();
    this.deferredPages.clear();
  },
}));

vi.mock("./pdf.worker?worker&url", () => ({ default: "mock-worker.js" }));
vi.mock("./mainThreadWorker", () => ({ installMainThreadPdfWorker: vi.fn() }));
vi.mock("./pdfController", () => ({
  registerPdfView: (state: { ensurePageRendered?: (pageNumber: number) => void }) => {
    harness.ensurePageRendered = state.ensurePageRendered ?? null;
  },
  clearPdfView: vi.fn(),
  pageClickToBp: vi.fn(() => null),
}));
vi.mock("pdfjs-dist/web/pdf_viewer.mjs", () => ({
  EventBus: class {
    dispatch() {}
  },
  LinkTarget: { BLANK: 2 },
  DownloadManager: class {
    openOrDownloadData() {
      return false;
    }
  },
  PDFLinkService: class {
    eventBus: { dispatch: () => void };
    constructor({ eventBus }: { eventBus: { dispatch: () => void } }) {
      this.eventBus = eventBus;
    }
    setDocument() {}
    setViewer() {}
    addLinkAttributes(link: HTMLAnchorElement, url: string) {
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer nofollow";
    }
    getDestinationHash(destination: string) {
      return `#${destination}`;
    }
    getAnchorUrl(anchor: string) {
      return anchor;
    }
    executeNamedAction() {}
    executeSetOCGState() {
      return Promise.resolve();
    }
    getAttachmentContent() {
      return Promise.resolve(undefined);
    }
  },
  StructTreeLayerBuilder: class {
    render() {
      const tree = document.createElement("span");
      tree.className = "structTree";
      tree.setAttribute("role", "document");
      const heading = document.createElement("span");
      heading.setAttribute("role", "heading");
      heading.setAttribute("aria-level", "1");
      heading.textContent = "Tagged heading";
      tree.append(heading);
      return Promise.resolve(tree);
    }
    updateTextLayer() {
      harness.structureUpdated++;
    }
    show() {}
    hide() {}
  },
}));
vi.mock("pdfjs-dist", () => {
  class MockViewport {
    readonly scale: number;
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
    readonly userUnit: number;
    readonly rawDims: { pageWidth: number; pageHeight: number; pageX: number; pageY: number };

    constructor(readonly spec: PageSpec, scale: number) {
      this.scale = scale;
      this.width = spec.width * scale;
      this.height = spec.height * scale;
      this.rotation = spec.rotation;
      this.userUnit = spec.userUnit;
      this.rawDims = {
        pageWidth: spec.rotation % 180 === 0 ? spec.width / spec.userUnit : spec.height / spec.userUnit,
        pageHeight: spec.rotation % 180 === 0 ? spec.height / spec.userUnit : spec.width / spec.userUnit,
        pageX: 0,
        pageY: 0,
      };
    }

    clone({ scale = this.scale }: { scale?: number; dontFlip?: boolean } = {}) {
      return new MockViewport(this.spec, scale);
    }
  }

  const makePage = (pageNumber: number) => {
    const spec = harness.specs[pageNumber - 1];
    return {
      getViewport: ({ scale }: { scale: number }) => new MockViewport(spec, scale),
      getTextContent: () =>
        Promise.resolve({
          items: [{
            str: `PAGE ${pageNumber} TEXT`,
            width: 120,
            height: 12,
            fontName: "mock-font",
            transform: [1, 0, 0, 1, 0, 0],
          }],
          styles: { "mock-font": { vertical: false } },
        }),
      render: ({
        viewport,
        transform,
      }: {
        viewport: MockViewport;
        transform?: number[];
      }) => {
        harness.renderCalls.push({
          pageNumber,
          scale: viewport.scale,
          width: viewport.width,
          height: viewport.height,
          transform,
        });
        return { promise: Promise.resolve(), cancel: vi.fn() };
      },
      getAnnotations: () => Promise.resolve([{ id: `link-${pageNumber}` }]),
      cleanup: () => {
        harness.pageCleanup++;
      },
    };
  };

  return {
    GlobalWorkerOptions: { workerSrc: "" },
    normalizeUnicode: (value: string) => value.normalize("NFKC"),
    PDFWorker: class {
      promise = Promise.resolve();
      destroy() {}
    },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: harness.specs.length,
        annotationStorage: {},
        getOptionalContentConfig: ({ intent }: { intent: string }) => {
          harness.optionalContentIntents.push(intent);
          return Promise.resolve({
            renderingIntent: intent,
            setOCGState: vi.fn(),
          });
        },
        getPage: (pageNumber: number) => {
          harness.getPageCalls.push(pageNumber);
          if (harness.rejectedPages.has(pageNumber)) {
            return Promise.reject(new Error(`Rejected page ${pageNumber}`));
          }
          const gate = harness.deferredPages.get(pageNumber);
          return gate
            ? gate.promise.then(() => makePage(pageNumber))
            : Promise.resolve(makePage(pageNumber));
        },
      }),
      destroy: () => Promise.resolve(),
    }),
    TextLayer: class {
      readonly textDivs: HTMLElement[] = [];
      constructor(
        private readonly options: {
          textContentSource: { items: Array<{ str: string }> };
          container: HTMLElement;
          viewport: MockViewport;
        },
      ) {
        harness.textViewports.push({
          scale: options.viewport.scale,
          width: options.viewport.width,
          height: options.viewport.height,
          rotation: options.viewport.rotation,
          userUnit: options.viewport.userUnit,
        });
      }
      render() {
        const span = document.createElement("span");
        span.textContent = this.options.textContentSource.items[0]?.str ?? "";
        span.setAttribute("role", "presentation");
        span.getBoundingClientRect = () => {
          if (harness.throwTextGeometry) {
            throw new Error("Text geometry unavailable");
          }
          return {
            x: 10,
            y: 10,
            width: 120,
            height: 12,
            top: 10,
            right: 130,
            bottom: 22,
            left: 10,
            toJSON: () => ({}),
          } as DOMRect;
        };
        this.textDivs.push(span);
        this.options.container.append(span);
        return Promise.resolve();
      }
      cancel() {}
    },
    AnnotationLayer: class {
      constructor(
        private readonly options: {
          div: HTMLElement;
          accessibilityManager: {
            addPointerInTextLayer: (element: HTMLElement, removable: boolean) => string | null;
          };
          linkService: {
            addLinkAttributes: (link: HTMLAnchorElement, url: string, newWindow: boolean) => void;
            getDestinationHash: (destination: string) => string;
            executeNamedAction: (action: string) => void;
            executeSetOCGState: (state: object) => Promise<void>;
          };
          structTreeLayer: unknown;
          viewport: MockViewport;
        },
      ) {
        harness.annotationViewports.push({
          scale: options.viewport.scale,
          width: options.viewport.width,
          height: options.viewport.height,
          rotation: options.viewport.rotation,
          userUnit: options.viewport.userUnit,
        });
      }
      async render(parameters?: { optionalContentConfig?: unknown }) {
        harness.annotationOptionalConfigs.push(
          parameters?.optionalContentConfig,
        );
        const link = document.createElement("a");
        link.id = `annotation-${harness.linkApisExercised + 1}`;
        link.getBoundingClientRect = () =>
          ({
            x: 20,
            y: 24,
            width: 30,
            height: 8,
            top: 24,
            right: 50,
            bottom: 32,
            left: 20,
            toJSON: () => ({}),
          }) as DOMRect;
        this.options.linkService.addLinkAttributes(
          link,
          "https://example.test/paper",
          true,
        );
        this.options.linkService.getDestinationHash("results");
        this.options.linkService.executeNamedAction("NextPage");
        await this.options.linkService.executeSetOCGState({ state: [] });
        this.options.div.append(link);
        this.options.accessibilityManager.addPointerInTextLayer(link, false);
        harness.linkApisExercised++;
      }
      destroy() {
        harness.annotationDestroyed++;
      }
    },
  };
});

import { PdfViewer } from "./PdfViewer";

beforeEach(() => {
  harness.reset();
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 1.25,
  });
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

function triggerIntersection(pageNumbers: number[], isIntersecting: boolean): void {
  const callback = harness.observerCallbacks.at(-1);
  if (!callback) throw new Error("Intersection observer is not installed");
  const entries = pageNumbers.map(
    (pageNumber) =>
      ({
        target: document.querySelector(`[data-page="${pageNumber}"]`),
        isIntersecting,
      }) as IntersectionObserverEntry,
  );
  callback(entries, {} as IntersectionObserver);
}

describe("PdfViewer production geometry and lifecycle wiring", () => {
  it("retains selectable text when DOM width calibration is unavailable", async () => {
    harness.throwTextGeometry = true;
    const view = render(
      <PdfViewer
        data={new Uint8Array([1])}
        scale={1}
        expectText={false}
      />,
    );

    await waitFor(() =>
      expect(
        view.container.querySelector("[data-page='1'] .textLayer span"),
      ).toHaveTextContent("PAGE 1 TEXT"),
    );
  });

  it("reports the dominant bottom-clamped page through the component callback", async () => {
    harness.reset([
      { width: 612, height: 792, rotation: 0, userUnit: 1 },
      { width: 612, height: 792, rotation: 0, userUnit: 1 },
      { width: 612, height: 792, rotation: 0, userUnit: 1 },
    ]);
    const onPageChange = vi.fn();
    const view = render(
      <PdfViewer
        data={new Uint8Array([1])}
        scale={1}
        expectText={false}
        onPageChange={onPageChange}
      />,
    );
    const renderer = view.getByTestId("pdf-renderer");
    await waitFor(() => expect(renderer.dataset.pdfState).toBe("ready"));
    const scrollParent = renderer.parentElement as HTMLElement;
    const page2 = view.container.querySelector<HTMLElement>("[data-page='2']")!;
    const page3 = view.container.querySelector<HTMLElement>("[data-page='3']")!;
    scrollParent.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 800,
        left: 0,
        right: 1_000,
        width: 1_000,
        height: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    page2.getBoundingClientRect = () =>
      ({
        top: -770,
        bottom: 6,
        left: 194,
        right: 806,
        width: 612,
        height: 776,
        x: 194,
        y: -770,
        toJSON: () => ({}),
      }) as DOMRect;
    page3.getBoundingClientRect = () =>
      ({
        top: 22,
        bottom: 798,
        left: 194,
        right: 806,
        width: 612,
        height: 776,
        x: 194,
        y: 22,
        toJSON: () => ({}),
      }) as DOMRect;
    act(() => triggerIntersection([2, 3], true));
    onPageChange.mockClear();

    act(() => scrollParent.dispatchEvent(new Event("scroll")));

    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(3, 3));
  });

  it("progressively applies each off-screen page's own exact geometry", async () => {
    const view = render(
      <PdfViewer data={new Uint8Array([1])} scale={1} expectText={false} />,
    );
    await waitFor(() => expect(view.container.querySelector("[data-page='2']")).not.toBeNull());

    const second = view.container.querySelector<HTMLElement>("[data-page='2']");
    expect(second).toHaveStyle({ width: "900px", height: "628px" });
    expect(second?.dataset.pdfRotation).toBe("90");
    expect(second?.dataset.pdfUserUnit).toBe("1.5");
    expect(second?.dataset.pdfGeometry).toBe("exact");
    expect(second?.querySelector("canvas")).toBeNull();
  });

  it("makes page 1 usable when a later page hangs and another rejects in a 400-page PDF", async () => {
    harness.specs = Array.from({ length: 400 }, (_, index) => ({
      width: index % 2 ? 420 : 612,
      height: index % 2 ? 600 : 792,
      rotation: index % 2 ? 90 : 0,
      userUnit: index % 2 ? 1.5 : 1,
    }));
    harness.deferPage(2);
    harness.rejectedPages.add(3);

    const view = render(
      <PdfViewer data={new Uint8Array([1])} scale={1} expectText={false} />,
    );
    const renderer = view.getByTestId("pdf-renderer");
    await waitFor(() => expect(renderer.dataset.pdfState).toBe("ready"));
    expect(view.container.querySelectorAll("[data-page]")).toHaveLength(400);
    await waitFor(() =>
      expect(view.container.querySelector("[data-page='1'] canvas")).not.toBeNull(),
    );

    const first = view.container.querySelector<HTMLElement>("[data-page='1']");
    const second = view.container.querySelector<HTMLElement>("[data-page='2']");
    expect(first?.dataset.pdfGeometry).toBe("exact");
    expect(second?.dataset.pdfGeometry).toBe("pending");
    expect(second).toHaveStyle({ width: "640px", height: "820px" });
    expect(second).not.toHaveStyle({ width: "612px", height: "792px" });
    await waitFor(() => expect(renderer.dataset.pdfGeometryState).toBe("partial"));
    expect(harness.getPageCalls.length).toBeLessThanOrEqual(10);
    expect(Math.max(...harness.getPageCalls)).toBeLessThanOrEqual(9);

    const cleanupBeforeLatePage = harness.pageCleanup;
    view.unmount();
    harness.resolvePage(2);
    await waitFor(() =>
      expect(harness.pageCleanup).toBeGreaterThan(cleanupBeforeLatePage),
    );
  });

  it("preserves the visible page anchor when pending geometry above it resolves", async () => {
    harness.reset([
      { width: 612, height: 792, rotation: 0, userUnit: 1 },
      { width: 900, height: 1_200, rotation: 0, userUnit: 1 },
      { width: 612, height: 792, rotation: 0, userUnit: 1 },
    ]);
    harness.deferPage(2);
    const view = render(
      <PdfViewer data={new Uint8Array([1])} scale={1} expectText={false} />,
    );
    await waitFor(() =>
      expect(view.container.querySelector("[data-page='3']")).not.toBeNull(),
    );
    const renderer = view.getByTestId("pdf-renderer");
    const scrollParent = renderer.parentElement as HTMLElement;
    const first = view.container.querySelector<HTMLElement>("[data-page='1']")!;
    const second = view.container.querySelector<HTMLElement>("[data-page='2']")!;
    const third = view.container.querySelector<HTMLElement>("[data-page='3']")!;
    scrollParent.scrollTop = 1_000;
    scrollParent.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 800,
        left: 0,
        right: 1_000,
        width: 1_000,
        height: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    first.getBoundingClientRect = () =>
      ({
        top: -1_800,
        bottom: -1_008,
        left: 0,
        right: 612,
        width: 612,
        height: 792,
        x: 0,
        y: -1_800,
        toJSON: () => ({}),
      }) as DOMRect;
    second.getBoundingClientRect = () => {
      const top = 100 - scrollParent.scrollTop;
      const height = Number.parseFloat(second.style.height);
      return {
        top,
        bottom: top + height,
        left: 0,
        right: 900,
        width: 900,
        height,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    };
    third.getBoundingClientRect = () => {
      const precedingHeight = Number.parseFloat(second.style.height);
      const top = 100 + precedingHeight + 16 - scrollParent.scrollTop;
      return {
        top,
        bottom: top + 792,
        left: 0,
        right: 612,
        width: 612,
        height: 792,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    };
    expect(second.dataset.pdfGeometry).toBe("pending");
    expect(third.getBoundingClientRect().top).toBe(-64);
    act(() => triggerIntersection([3], true));

    act(() => harness.resolvePage(2));
    await waitFor(() => expect(second.dataset.pdfGeometry).toBe("exact"));

    expect(second).toHaveStyle({ width: "900px", height: "1200px" });
    expect(scrollParent.scrollTop).toBe(1_380);
    expect(third.getBoundingClientRect().top).toBe(-64);
  });

  it("uses one transform for canvas, text and annotations at fractional DPR and after crisp zoom", async () => {
    const data = new Uint8Array([1]);
    const view = render(
      <PdfViewer data={data} scale={1} expectText={false} />,
    );
    await waitFor(() => expect(view.container.querySelector("[data-page='2']")).not.toBeNull());
    act(() => triggerIntersection([2], true));
    await waitFor(() =>
      expect(view.container.querySelector("[data-page='2'] .annotationLayer a")).not.toBeNull(),
    );

    const firstRender = harness.renderCalls.find(
      (call) => call.pageNumber === 2 && call.scale === 1,
    );
    expect(firstRender).toEqual({
      pageNumber: 2,
      scale: 1,
      width: 900,
      height: 630,
      transform: [1.25, 0, 0, 1.25, 0, 0],
    });
    const second = view.container.querySelector<HTMLElement>("[data-page='2']");
    expect(second?.querySelector("canvas")).toHaveAttribute("width", "1125");
    expect(second?.querySelector("canvas")).toHaveAttribute("height", "785");
    expect(harness.textViewports).toContainEqual({
      scale: 1,
      width: 900,
      height: 630,
      rotation: 90,
      userUnit: 1.5,
    });
    expect(harness.annotationViewports).toContainEqual({
      scale: 1,
      width: 900,
      height: 630,
      rotation: 90,
      userUnit: 1.5,
    });
    expect(harness.annotationOptionalConfigs).not.toContain(undefined);
    expect(harness.annotationOptionalConfigs).toContainEqual(
      expect.objectContaining({ renderingIntent: "display" }),
    );
    expect(harness.optionalContentIntents).toContain("display");
    expect(second?.querySelector(".structTree [role='heading']")).toHaveTextContent(
      "Tagged heading",
    );
    expect(second?.querySelector(".textLayer span")).toHaveAttribute(
      "aria-owns",
      expect.stringMatching(/^annotation-/),
    );
    expect(harness.linkApisExercised).toBeGreaterThan(0);
    expect(harness.structureUpdated).toBeGreaterThan(0);

    view.rerender(
      <PdfViewer data={data} scale={2} expectText={false} />,
    );
    await waitFor(() =>
      expect(second).toHaveStyle({ width: "1800px", height: "1260px" }),
    );
    expect(second?.style.getPropertyValue("--scale-factor")).toBe("2");
    await waitFor(
      () =>
        expect(
          harness.renderCalls.some(
            (call) =>
              call.pageNumber === 2 &&
              call.scale === 2 &&
              call.width === 1800 &&
              call.height === 1260 &&
              call.transform?.[0] === 1.25,
          ),
        ).toBe(true),
      { timeout: 2_000 },
    );
    await waitFor(() =>
      expect(second?.querySelector("canvas")).toHaveAttribute("width", "2250"),
    );
    expect(second?.querySelector("canvas")).toHaveAttribute("height", "1575");
    expect(second?.querySelector(".textLayer span")).toHaveTextContent("PAGE 2 TEXT");
    expect(harness.textViewports).toContainEqual({
      scale: 2,
      width: 1800,
      height: 1260,
      rotation: 90,
      userUnit: 1.5,
    });
    expect(harness.annotationViewports).toContainEqual({
      scale: 2,
      width: 1800,
      height: 1260,
      rotation: 90,
      userUnit: 1.5,
    });
  });

  it("destroys annotation and page resources on eviction and unmount", async () => {
    const view = render(
      <PdfViewer data={new Uint8Array([1])} scale={1} expectText={false} />,
    );
    await waitFor(() => expect(view.container.querySelector("[data-page='2']")).not.toBeNull());
    act(() => triggerIntersection([2], true));
    await waitFor(() => expect(harness.linkApisExercised).toBeGreaterThan(0));
    const retainedCanvas = view.container.querySelector<HTMLCanvasElement>(
      "[data-page='2'] canvas",
    );
    expect(retainedCanvas?.width).toBeGreaterThan(0);
    const beforeEviction = harness.annotationDestroyed;

    act(() => triggerIntersection([2], false));
    await waitFor(() => expect(harness.annotationDestroyed).toBeGreaterThan(beforeEviction));
    expect(view.container.querySelector("[data-page='2'] canvas")).toBeNull();
    expect(retainedCanvas?.width).toBe(0);
    expect(retainedCanvas?.height).toBe(0);

    const beforeSwitch = harness.annotationDestroyed;
    view.rerender(
      <PdfViewer data={new Uint8Array([2])} scale={1} expectText={false} />,
    );
    await waitFor(() => expect(harness.annotationDestroyed).toBeGreaterThan(beforeSwitch));
    await waitFor(() => expect(view.container.querySelector("[data-page='1'] canvas")).not.toBeNull());

    const beforeUnmount = harness.annotationDestroyed;
    view.unmount();
    expect(harness.annotationDestroyed).toBeGreaterThan(beforeUnmount);
    expect(harness.pageCleanup).toBeGreaterThanOrEqual(harness.specs.length + 2);
  });

  it("never exceeds 14 live rasterizations under broad visibility and repeated off-screen targets", async () => {
    harness.specs = Array.from({ length: 30 }, (_, index) => ({
      width: index % 2 ? 420 : 612,
      height: index % 2 ? 600 : 792,
      rotation: index % 2 ? 90 : 0,
      userUnit: index % 2 ? 1.5 : 1,
    }));
    const view = render(
      <PdfViewer data={new Uint8Array([1])} scale={1} expectText={false} />,
    );
    await waitFor(() => expect(view.container.querySelectorAll("[data-page]")).toHaveLength(30));

    act(() =>
      triggerIntersection(
        Array.from({ length: 30 }, (_, index) => index + 1),
        true,
      ),
    );
    await waitFor(() =>
      expect(view.container.querySelectorAll(".pdf-canvas").length).toBe(14),
    );

    for (const pageNumber of [30, 29, 28, 27, 26, 25, 24, 23]) {
      act(() => harness.ensurePageRendered?.(pageNumber));
      await waitFor(() =>
        expect(view.container.querySelectorAll(".pdf-canvas").length).toBeLessThanOrEqual(14),
      );
    }
    expect(view.container.querySelectorAll(".pdf-canvas").length).toBeLessThanOrEqual(14);
    expect(harness.annotationDestroyed).toBeGreaterThan(0);
  });
});
