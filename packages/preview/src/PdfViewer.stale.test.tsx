// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pdfMock = vi.hoisted(() => {
  let resolveOldText: ((value: unknown) => void) | null = null;
  let resolveWorker: (() => void) | null = null;
  let resolveDocument: ((value: unknown) => void) | null = null;
  return {
    oldTextStarted: false,
    oldRenderCancelled: false,
    constructedText: [] as string[],
    delayWorker: false,
    delayDocument: false,
    workerConstructed: 0,
    workerDestroyed: 0,
    getDocumentCalls: 0,
    loadingTaskDestroyed: 0,
    textContentParams: [] as unknown[],
    optionalContentIntents: [] as string[],
    pageCleanupCalls: 0,
    annotationDestroyed: 0,
    structureUpdated: 0,
    reset() {
      this.oldTextStarted = false;
      this.oldRenderCancelled = false;
      this.constructedText = [];
      this.delayWorker = false;
      this.delayDocument = false;
      this.workerConstructed = 0;
      this.workerDestroyed = 0;
      this.getDocumentCalls = 0;
      this.loadingTaskDestroyed = 0;
      this.textContentParams = [];
      this.optionalContentIntents = [];
      this.pageCleanupCalls = 0;
      this.annotationDestroyed = 0;
      this.structureUpdated = 0;
      resolveOldText = null;
      resolveWorker = null;
      resolveDocument = null;
    },
    resolveOld() {
      resolveOldText?.({
        items: [{ str: "OLD DOCUMENT TEXT", transform: [1, 0, 0, 1, 0, 0] }],
        styles: {},
      });
    },
    oldTextPromise() {
      this.oldTextStarted = true;
      return new Promise((resolve) => {
        resolveOldText = resolve;
      });
    },
    workerPromise() {
      this.workerConstructed++;
      if (!this.delayWorker) return Promise.resolve();
      return new Promise<void>((resolve) => {
        resolveWorker = resolve;
      });
    },
    resolveWorker() {
      resolveWorker?.();
    },
    documentPromise(value: unknown) {
      if (!this.delayDocument) return Promise.resolve(value);
      return new Promise((resolve) => {
        resolveDocument = resolve;
      });
    },
    resolveDocument(value: unknown) {
      resolveDocument?.(value);
    },
  };
});

const controllerMock = vi.hoisted(() => ({
  pageClickToBp: vi.fn<() => { page: number; x: number; y: number } | null>(() => null),
}));

vi.mock("./pdf.worker?worker&url", () => ({ default: "mock-worker.js" }));
vi.mock("./mainThreadWorker", () => ({ installMainThreadPdfWorker: vi.fn() }));
vi.mock("./pdfController", () => ({
  registerPdfView: vi.fn(),
  clearPdfView: vi.fn(),
  pageClickToBp: controllerMock.pageClickToBp,
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
    externalLinkEnabled = true;
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
      return Promise.resolve(null);
    }
  },
  StructTreeLayerBuilder: class {
    render() {
      return Promise.resolve(null);
    }
    updateTextLayer() {
      pdfMock.structureUpdated++;
    }
    show() {}
    hide() {}
  },
}));
vi.mock("pdfjs-dist", () => {
  class MockViewport {
    width: number;
    height: number;
    scale: number;
    userUnit = 1;
    rotation = 0;
    rawDims = { pageWidth: 612, pageHeight: 792, pageX: 0, pageY: 0 };

    constructor(scale: number) {
      this.scale = scale;
      this.width = 612 * scale;
      this.height = 792 * scale;
    }

    clone({ scale = this.scale }: { scale?: number } = {}) {
      return new MockViewport(scale);
    }
  }

  const makeDocument = (old: boolean) => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => new MockViewport(scale),
      getTextContent: (params?: unknown) => {
        pdfMock.textContentParams.push(params);
        return (
        old
          ? pdfMock.oldTextPromise()
          : Promise.resolve({
              items: [{ str: "NEW DOCUMENT TEXT", transform: [1, 0, 0, 1, 0, 0] }],
              styles: {},
            })
        );
      },
      render: () => ({
        promise: Promise.resolve(),
        cancel: () => {
          if (old) pdfMock.oldRenderCancelled = true;
        },
      }),
      getAnnotations: () => Promise.resolve([]),
      cleanup: () => {
        pdfMock.pageCleanupCalls++;
      },
    };
    return {
      numPages: 1,
      annotationStorage: {},
      getOptionalContentConfig: ({ intent }: { intent: string }) => {
        pdfMock.optionalContentIntents.push(intent);
        return Promise.resolve({
          renderingIntent: intent,
          setOCGState: vi.fn(),
        });
      },
      getPage: () => Promise.resolve(page),
    };
  };

  return {
    GlobalWorkerOptions: { workerSrc: "" },
    PDFWorker: class {
      promise = pdfMock.workerPromise();
      destroy() {
        pdfMock.workerDestroyed++;
      }
    },
    getDocument: ({ data }: { data: Uint8Array }) => {
      pdfMock.getDocumentCalls++;
      const document = makeDocument(data[0] === 1);
      return {
        promise: pdfMock.documentPromise(document),
        destroy: () => {
          pdfMock.loadingTaskDestroyed++;
          return Promise.resolve();
        },
      };
    },
    TextLayer: class {
      private readonly content: { items: Array<{ str: string }> };
      private readonly container: HTMLElement;

      constructor({
        textContentSource,
        container,
      }: {
        textContentSource: { items: Array<{ str: string }> };
        container: HTMLElement;
      }) {
        this.content = textContentSource;
        this.container = container;
        pdfMock.constructedText.push(textContentSource.items[0]?.str ?? "");
      }

      render() {
        const span = document.createElement("span");
        span.textContent = this.content.items[0]?.str ?? "";
        this.container.append(span);
        return Promise.resolve();
      }

      cancel() {}
    },
    AnnotationLayer: class {
      render() {
        return Promise.resolve();
      }
      destroy() {
        pdfMock.annotationDestroyed++;
      }
    },
  };
});

import { PdfViewer } from "./PdfViewer";

beforeEach(() => {
  pdfMock.reset();
  controllerMock.pageClickToBp.mockReset();
  controllerMock.pageClickToBp.mockReturnValue(null);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
});

describe("PdfViewer stale document rendering", () => {
  it("cancels old work and cannot repopulate the current text layer", async () => {
    const view = render(<PdfViewer data={new Uint8Array([1])} scale={1} expectText={false} />);

    await waitFor(() => expect(pdfMock.oldTextStarted).toBe(true));
    view.rerender(<PdfViewer data={new Uint8Array([2])} scale={1} expectText={false} />);
    await waitFor(() => {
      expect(view.container.querySelector(".textLayer")?.textContent).toContain(
        "NEW DOCUMENT TEXT",
      );
    });

    pdfMock.resolveOld();
    await Promise.resolve();
    await Promise.resolve();

    expect(view.container.textContent).not.toContain("OLD DOCUMENT TEXT");
    expect(pdfMock.constructedText).toEqual(["NEW DOCUMENT TEXT"]);
    expect(pdfMock.oldRenderCancelled).toBe(true);
  });

  it("destroys a worker that becomes ready after the viewer is cancelled", async () => {
    pdfMock.delayWorker = true;
    const view = render(
      <PdfViewer data={new Uint8Array([2])} scale={1} expectText={false} />,
    );
    await waitFor(() => expect(pdfMock.workerConstructed).toBe(1));

    view.unmount();
    pdfMock.resolveWorker();
    await waitFor(() => expect(pdfMock.workerDestroyed).toBeGreaterThanOrEqual(1));

    expect(pdfMock.getDocumentCalls).toBe(0);
  });

  it("destroys a loading task and worker when cancellation wins the document race", async () => {
    pdfMock.delayDocument = true;
    const view = render(
      <PdfViewer data={new Uint8Array([2])} scale={1} expectText={false} />,
    );
    await waitFor(() => expect(pdfMock.getDocumentCalls).toBe(1));

    view.unmount();
    expect(pdfMock.loadingTaskDestroyed).toBeGreaterThanOrEqual(1);
    expect(pdfMock.workerDestroyed).toBeGreaterThanOrEqual(1);
    pdfMock.resolveDocument({
      numPages: 1,
      annotationStorage: {},
      getOptionalContentConfig: ({ intent }: { intent: string }) =>
        Promise.resolve({
          renderingIntent: intent,
          setOCGState: vi.fn(),
        }),
      getPage: vi.fn(),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(view.container.querySelector("[data-page]")).toBeNull();
  });

  it("requests the unnormalized marked-content stream used by TextLayerBuilder", async () => {
    const view = render(
      <PdfViewer data={new Uint8Array([2])} scale={1} expectText={false} />,
    );
    await waitFor(() =>
      expect(view.container.querySelector(".textLayer")?.textContent).toContain(
        "NEW DOCUMENT TEXT",
      ),
    );

    expect(pdfMock.textContentParams).toContainEqual({
      includeMarkedContent: true,
      disableNormalization: true,
    });
    expect(pdfMock.optionalContentIntents).toContain("display");
  });

  it("does not invoke inverse SyncTeX when a non-collapsed selection intersects the page", async () => {
    controllerMock.pageClickToBp.mockReturnValue({ page: 1, x: 72, y: 700 });
    const onInverse = vi.fn();
    const view = render(
      <PdfViewer
        data={new Uint8Array([2])}
        scale={1}
        expectText={false}
        onInverse={onInverse}
      />,
    );
    await waitFor(() => {
      const span = view.container.querySelector<HTMLElement>(".textLayer span");
      const wrap = span?.closest<HTMLElement>("[data-page]");
      expect(span?.textContent).toContain("NEW DOCUMENT TEXT");
      expect(wrap).not.toBeNull();
      if (!span || !wrap) return;

      const range = document.createRange();
      range.selectNodeContents(span);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      span.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }),
      );
      expect(onInverse).not.toHaveBeenCalled();
    });
  });
});
