// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { testCatalogTranslator } from "@oleafly/i18n-contract/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewMessageKey } from "./messages";

type Item =
  | { str: string; width: number; height: number; fontName: string; transform: number[]; hasEOL?: boolean }
  | { type: string; id?: string };

interface PageSpec {
  width: number;
  height: number;
  items: Item[];
  renderError?: unknown;
  textError?: unknown;
  annotationsError?: unknown;
}

const harness = vi.hoisted(() => ({
  pages: [] as PageSpec[],
  numPagesOverride: null as number | null,
  requiredPassword: null as string | null,
  loadErrors: [] as unknown[],
  progress: [] as Array<{ loaded: number; total: number }>,
  workerError: null as unknown,
  textLayerError: null as unknown,
  beforeLoad: null as ((call: number) => void | Promise<void>) | null,
  getDocumentCalls: [] as Array<{ password?: string }>,
  textContentCalls: [] as number[],
  progressDelivered: 0,
  loadingTaskDestroyed: 0,
  workerDestroyed: 0,
  textLayerCancelled: 0,
  installMainThread: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  reset() {
    this.pages = [];
    this.numPagesOverride = null;
    this.requiredPassword = null;
    this.loadErrors = [];
    this.progress = [];
    this.workerError = null;
    this.textLayerError = null;
    this.beforeLoad = null;
    this.getDocumentCalls = [];
    this.textContentCalls = [];
    this.progressDelivered = 0;
    this.loadingTaskDestroyed = 0;
    this.workerDestroyed = 0;
    this.textLayerCancelled = 0;
  },
}));

vi.mock("./mainThreadWorker", () => ({
  installMainThreadPdfWorker: () => harness.installMainThread(),
}));
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
    eventBus: { dispatch: () => void };
    constructor({ eventBus }: { eventBus: { dispatch: () => void } }) {
      this.eventBus = eventBus;
    }
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
  }

  const makePage = (pageNumber: number) => {
    const spec = harness.pages[pageNumber - 1];
    return {
      rotate: 0,
      getViewport: ({ scale, rotation = 0 }: { scale: number; rotation?: number }) =>
        new MockViewport(spec, scale, rotation),
      getTextContent: () => {
        harness.textContentCalls.push(pageNumber);
        if (spec.textError) return Promise.reject(spec.textError);
        return Promise.resolve({ items: spec.items, styles: { f: { vertical: false } }, lang: null });
      },
      render: () => ({
        promise: spec.renderError ? Promise.reject(spec.renderError) : Promise.resolve(),
        cancel: () => {},
      }),
      getAnnotations: () =>
        spec.annotationsError ? Promise.reject(spec.annotationsError) : Promise.resolve([]),
      getStructTree: () => Promise.resolve(null),
      cleanup: () => {},
    };
  };

  const makeDocument = () => ({
    numPages: harness.numPagesOverride ?? harness.pages.length,
    annotationStorage: {},
    getOptionalContentConfig: ({ intent }: { intent: string }) =>
      Promise.resolve({ renderingIntent: intent, setOCGState: vi.fn() }),
    getPage: (pageNumber: number) => Promise.resolve(makePage(pageNumber)),
    getOutline: () => Promise.resolve(null),
  });

  return {
    GlobalWorkerOptions: { workerSrc: "" },
    PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
    normalizeUnicode: (value: string) => value,
    PDFWorker: class {
      promise = harness.workerError ? Promise.reject(harness.workerError) : Promise.resolve();
      destroy() {
        harness.workerDestroyed++;
      }
    },
    getDocument: (params: { password?: string }) => {
      harness.getDocumentCalls.push({ password: params.password });
      const call = harness.getDocumentCalls.length;
      const task = {
        onPassword: null as null | ((update: (value: string) => void, reason: number) => void),
        onProgress: null as null | ((progress: { loaded: number; total: number }) => void),
        promise: null as unknown as Promise<unknown>,
        destroy: () => {
          harness.loadingTaskDestroyed++;
          return Promise.resolve();
        },
      };
      task.promise = (async () => {
        await Promise.resolve();
        await harness.beforeLoad?.(call);
        for (const progress of harness.progress) {
          task.onProgress?.(progress);
          harness.progressDelivered++;
        }
        if (harness.requiredPassword !== null && params.password !== harness.requiredPassword) {
          task.onPassword?.(() => {}, params.password ? 2 : 1);
          throw Object.assign(new Error("No password given"), { name: "PasswordException" });
        }
        if (harness.loadErrors.length) throw harness.loadErrors.shift();
        return makeDocument();
      })();
      return task;
    },
    TextLayer: class {
      readonly textDivs: HTMLElement[] = [];
      constructor(
        private readonly options: {
          textContentSource: ReadableStream<{ items: Item[] }>;
          container: HTMLElement;
        },
      ) {}
      async render() {
        if (harness.textLayerError) throw harness.textLayerError;
        const { readTextContentItems } = await import("./test-text-content");
        for (const item of await readTextContentItems(this.options.textContentSource)) {
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
      render() {
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

function page(items: Item[] = [text("Page text")], extra: Partial<PageSpec> = {}): PageSpec {
  return { width: 612, height: 792, items, ...extra };
}

function renderer(): HTMLElement {
  return screen.getByTestId("pdf-renderer");
}

beforeEach(() => {
  harness.reset();
  harness.installMainThread.mockReset();
  harness.installMainThread.mockImplementation(() => Promise.resolve());
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PdfViewer loading", () => {
  it("reports the renderer as unavailable when the main-thread fallback cannot start", async () => {
    harness.pages = [page()];
    harness.loadErrors = [Object.assign(new Error("Missing PDF"), { name: "MissingPDFException" })];
    harness.installMainThread.mockImplementation(() =>
      Promise.reject(new Error("main-thread PDF worker could not start")),
    );
    const onLoadStateChange = vi.fn();

    render(
      <PdfViewer
        data={new Uint8Array([1])}
        scale={1}
        expectText={false}
        documentIdentity="build-7"
        onLoadStateChange={onLoadStateChange}
        t={t}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(t("error.unavailable"));
    expect(renderer().dataset.pdfState).toBe("unavailable");
    expect(onLoadStateChange).toHaveBeenLastCalledWith({
      status: "unavailable",
      message: t("error.unavailable"),
      documentIdentity: "build-7",
    });
    expect(harness.installMainThread).toHaveBeenCalledOnce();
    expect(harness.getDocumentCalls).toHaveLength(1);
  });

  it("recovers on the main-thread worker after the first load fails", async () => {
    harness.pages = [page()];
    harness.loadErrors = [new Error("worker crashed")];
    const onLoadStateChange = vi.fn();

    render(
      <PdfViewer
        data={new Uint8Array([1])}
        scale={1}
        expectText={false}
        onLoadStateChange={onLoadStateChange}
        t={t}
      />,
    );

    await waitFor(() => expect(renderer().dataset.pdfState).toBe("ready"));
    expect(harness.installMainThread).toHaveBeenCalledOnce();
    expect(harness.getDocumentCalls).toHaveLength(2);
    expect(onLoadStateChange).toHaveBeenLastCalledWith({
      status: "ready",
      documentIdentity: "unidentified-pdf",
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing until PDF bytes arrive", () => {
    const view = render(<PdfViewer data={null} scale={1} t={t} />);

    expect(view.container).toBeEmptyDOMElement();
    expect(harness.getDocumentCalls).toHaveLength(0);
  });

  it("reports an empty file without starting pdf.js", () => {
    const onLoadStateChange = vi.fn();

    render(
      <PdfViewer
        data={new Uint8Array()}
        scale={1}
        documentIdentity="build-1"
        onLoadStateChange={onLoadStateChange}
        t={t}
      />,
    );

    expect(renderer().dataset.pdfState).toBe("empty");
    expect(renderer()).toHaveAccessibleName(t("a11y.document"));
    expect(onLoadStateChange).toHaveBeenCalledWith({
      status: "empty",
      documentIdentity: "build-1",
      message: t("error.empty"),
    });
    expect(harness.getDocumentCalls).toHaveLength(0);
  });

  it("asks for a password, rejects a wrong one and opens with the right one", async () => {
    harness.pages = [page()];
    harness.requiredPassword = "s3cret";
    const onLoadStateChange = vi.fn();
    const data = new Uint8Array([1]);
    const view = render(
      <PdfViewer
        data={data}
        scale={1}
        expectText={false}
        onLoadStateChange={onLoadStateChange}
        t={t}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(t("error.passwordRequired"));
    expect(onLoadStateChange).toHaveBeenLastCalledWith({
      status: "password_required",
      message: t("error.passwordRequired"),
      documentIdentity: "unidentified-pdf",
    });
    expect(harness.getDocumentCalls).toEqual([{ password: undefined }]);

    view.rerender(
      <PdfViewer
        data={data}
        scale={1}
        expectText={false}
        password="guess"
        onLoadStateChange={onLoadStateChange}
        t={t}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(t("error.passwordIncorrect")),
    );

    view.rerender(
      <PdfViewer
        data={data}
        scale={1}
        expectText={false}
        password="s3cret"
        onLoadStateChange={onLoadStateChange}
        t={t}
      />,
    );
    await waitFor(() => expect(renderer().dataset.pdfState).toBe("ready"));
    expect(harness.getDocumentCalls.at(-1)).toEqual({ password: "s3cret" });
    expect(harness.installMainThread).not.toHaveBeenCalled();
  });

  it.each([
    ["an InvalidPDFException", Object.assign(new Error("Invalid PDF structure"), { name: "InvalidPDFException" }), "invalid", 1],
    ["a non-Error FormatError", { name: "FormatError" }, "invalid", 1],
    ["a bad cross-reference message", "Bad XRef entry", "invalid", 1],
    ["a missing-file error", Object.assign(new Error("gone"), { name: "MissingPDFException" }), "unavailable", 2],
    ["a failed fetch", new Error("Failed to fetch"), "unavailable", 2],
    ["an unknown error", new Error("kaboom"), "error", 2],
    ["a thrown number", 42, "error", 2],
  ])("classifies %s", async (_label, error, status, attempts) => {
    harness.pages = [page()];
    harness.loadErrors = [error, error];
    const onLoadStateChange = vi.fn();
    const messages: Record<string, PreviewMessageKey> = {
      invalid: "error.invalid",
      unavailable: "error.unavailable",
      error: "error.generic",
    };

    render(
      <PdfViewer
        data={new Uint8Array([1])}
        scale={1}
        expectText={false}
        onLoadStateChange={onLoadStateChange}
        t={t}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(t(messages[status]));
    expect(renderer().dataset.pdfState).toBe(status);
    expect(renderer().dataset.pdfError).toBe(String(error));
    expect(onLoadStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ status, message: t(messages[status]) }),
    );
    expect(harness.getDocumentCalls).toHaveLength(attempts);
  });

  it.each([true, false])("treats a document without pages as a load error (text probe %s)", async (expectText) => {
    harness.numPagesOverride = 0;

    render(<PdfViewer data={new Uint8Array([1])} scale={1} expectText={expectText} t={t} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(t("error.generic"));
    expect(renderer().dataset.pdfError).toBe("Error: The PDF contains no pages");
  });

  it("stops before creating a worker when it unmounts immediately", async () => {
    harness.pages = [page()];
    const workerSpy = vi.fn();
    harness.beforeLoad = workerSpy;

    const view = render(<PdfViewer data={new Uint8Array([1])} scale={1} t={t} />);
    view.unmount();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.getDocumentCalls).toHaveLength(0);
    expect(workerSpy).not.toHaveBeenCalled();
  });

  it("records whether the window was focused when loading started", async () => {
    harness.pages = [page()];
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const view = render(<PdfViewer data={new Uint8Array([1])} scale={1} expectText={false} t={t} />);
    expect(renderer().dataset.pdfEnvironment).toBe(`${document.visibilityState}:focused`);
    await waitFor(() => expect(renderer().dataset.pdfState).toBe("ready"));

    vi.mocked(document.hasFocus).mockReturnValue(false);
    view.rerender(<PdfViewer data={new Uint8Array([2])} scale={1} expectText={false} t={t} />);
    expect(renderer().dataset.pdfEnvironment).toBe(`${document.visibilityState}:unfocused`);
  });

  it("destroys a worker whose setup fails and reports the failure", async () => {
    harness.pages = [page()];
    harness.workerError = new Error("Worker was terminated");

    render(<PdfViewer data={new Uint8Array([1])} scale={1} expectText={false} t={t} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(t("error.generic"));
    expect(harness.workerDestroyed).toBeGreaterThanOrEqual(2);
    expect(harness.getDocumentCalls).toHaveLength(0);
  });

  it("publishes byte progress while the document downloads", async () => {
    harness.pages = [page()];
    harness.progress = [
      { loaded: 25, total: 100 },
      { loaded: 400, total: 100 },
      { loaded: 10, total: 0 },
    ];
    const onLoadStateChange = vi.fn();

    render(
      <PdfViewer
        data={new Uint8Array([1])}
        scale={1}
        expectText={false}
        documentIdentity="build-3"
        onLoadStateChange={onLoadStateChange}
        t={t}
      />,
    );

    await waitFor(() => expect(renderer().dataset.pdfState).toBe("ready"));
    const loading = onLoadStateChange.mock.calls
      .map(([state]) => state)
      .filter((state) => state.status === "loading");
    expect(loading).toEqual([
      { status: "loading", documentIdentity: "build-3", message: t("status.loading") },
      { status: "loading", documentIdentity: "build-3", message: t("status.loading"), progress: 0.25 },
      { status: "loading", documentIdentity: "build-3", message: t("status.loading"), progress: 1 },
      { status: "loading", documentIdentity: "build-3", message: t("status.loading") },
    ]);
  });

  it("ignores download progress from a load that was superseded", async () => {
    harness.pages = [page()];
    harness.progress = [{ loaded: 50, total: 100 }];
    let releaseFirst!: () => void;
    const firstLoad = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    harness.beforeLoad = (call) => (call === 1 ? firstLoad : undefined);
    const onLoadStateChange = vi.fn();
    const data = new Uint8Array([1]);
    const view = render(
      <PdfViewer
        data={data}
        scale={1}
        expectText={false}
        documentIdentity="old"
        onLoadStateChange={onLoadStateChange}
        t={t}
      />,
    );
    await waitFor(() => expect(harness.getDocumentCalls).toHaveLength(1));

    view.rerender(
      <PdfViewer
        data={data}
        scale={1}
        expectText={false}
        documentIdentity="new"
        onLoadStateChange={onLoadStateChange}
        t={t}
      />,
    );
    await waitFor(() => expect(renderer().dataset.pdfState).toBe("ready"));
    expect(harness.progressDelivered).toBe(1);
    releaseFirst();
    await waitFor(() => expect(harness.progressDelivered).toBe(2));

    const progressIdentities = onLoadStateChange.mock.calls
      .map(([state]) => state)
      .filter((state) => state.progress !== undefined)
      .map((state) => state.documentIdentity);
    expect(progressIdentities).toEqual(["new"]);
    expect(onLoadStateChange).toHaveBeenLastCalledWith({ status: "ready", documentIdentity: "new" });
  });

  it("reuses the probed first-page text for the text layer", async () => {
    harness.pages = [page([text("Probed heading")])];

    render(<PdfViewer data={new Uint8Array([1])} scale={1} t={t} />);

    await waitFor(() =>
      expect(renderer().querySelector("[data-page='1'] .textLayer span")).toHaveTextContent(
        "Probed heading",
      ),
    );
    expect(harness.textContentCalls).toEqual([1]);
  });

  it("reloads on a fresh worker when the probed text pipe comes back empty", async () => {
    harness.pages = [page([text("   ")])];
    harness.beforeLoad = (call) => {
      if (call === 2) harness.pages = [page([text("Recovered text")])];
    };

    render(<PdfViewer data={new Uint8Array([1])} scale={1} t={t} />);

    await waitFor(() =>
      expect(renderer().querySelector("[data-page='1'] .textLayer span")).toHaveTextContent(
        "Recovered text",
      ),
    );
    expect(harness.getDocumentCalls).toHaveLength(2);
    expect(harness.loadingTaskDestroyed).toBeGreaterThanOrEqual(1);
  });

  it("tears down the loading task and worker when the window unloads", async () => {
    harness.pages = [page()];
    render(<PdfViewer data={new Uint8Array([1])} scale={1} expectText={false} t={t} />);
    await waitFor(() => expect(renderer().dataset.pdfState).toBe("ready"));
    const destroyedTasks = harness.loadingTaskDestroyed;
    const destroyedWorkers = harness.workerDestroyed;

    window.dispatchEvent(new Event("beforeunload"));

    expect(harness.loadingTaskDestroyed).toBe(destroyedTasks + 1);
    expect(harness.workerDestroyed).toBe(destroyedWorkers + 1);
  });
});

describe("PdfViewer page rendering failures", () => {
  it("shows a first-page error when the canvas render fails", async () => {
    harness.pages = [page([text("x")], { renderError: new Error("Canvas exploded") })];
    const onLoadStateChange = vi.fn();

    render(
      <PdfViewer
        data={new Uint8Array([1])}
        scale={1}
        expectText={false}
        onLoadStateChange={onLoadStateChange}
        t={t}
      />,
    );

    await waitFor(() => expect(renderer()).toHaveTextContent(t("error.firstPage")));
    expect(renderer().dataset.pdfRenderError).toBe("Error: Canvas exploded");
    expect(onLoadStateChange).toHaveBeenCalledWith({
      status: "error",
      documentIdentity: "unidentified-pdf",
      message: t("error.firstPage"),
    });
  });

  it("ignores a cancelled canvas render", async () => {
    harness.pages = [
      page([text("x")], {
        renderError: Object.assign(new Error("Rendering cancelled"), {
          name: "RenderingCancelledException",
        }),
      }),
    ];
    const onLoadStateChange = vi.fn();

    render(
      <PdfViewer
        data={new Uint8Array([1])}
        scale={1}
        expectText={false}
        onLoadStateChange={onLoadStateChange}
        t={t}
      />,
    );

    await waitFor(() => expect(renderer().dataset.pdfState).toBe("ready"));
    await waitFor(() =>
      expect(renderer().querySelector("[data-page='1'] .textLayer span")).not.toBeNull(),
    );
    expect(renderer()).not.toHaveTextContent(t("error.firstPage"));
    expect(onLoadStateChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("shows a first-page error when no 2D canvas context is available", async () => {
    harness.pages = [page()];
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null as never);

    render(<PdfViewer data={new Uint8Array([1])} scale={1} expectText={false} t={t} />);

    await waitFor(() => expect(renderer()).toHaveTextContent(t("error.firstPage")));
    expect(renderer().dataset.pdfRenderError).toBe("Error: 2D canvas context is unavailable");
  });

  it("keeps the page when its text layer cannot render", async () => {
    harness.pages = [page([text("Unselectable")])];
    harness.textLayerError = new Error("text layer failed");

    render(<PdfViewer data={new Uint8Array([1])} scale={1} expectText={false} t={t} />);

    await waitFor(() => expect(harness.textLayerCancelled).toBe(1));
    await waitFor(() =>
      expect(renderer().querySelector("[data-page='1'] .annotationLayer")).not.toBeNull(),
    );
    expect(renderer().querySelector("[data-page='1'] canvas")).not.toBeNull();
    expect(renderer().querySelector("[data-page='1'] .textLayer")).toBeEmptyDOMElement();
  });

  it("keeps the page when its text content and annotations cannot be read", async () => {
    harness.pages = [
      page([text("Hidden")], {
        textError: new Error("text unavailable"),
        annotationsError: new Error("annotations unavailable"),
      }),
    ];

    render(<PdfViewer data={new Uint8Array([1])} scale={1} expectText={false} t={t} />);

    await waitFor(() => expect(harness.textContentCalls).toContain(1));
    await waitFor(() =>
      expect(renderer().querySelector("[data-page='1'] canvas")).not.toBeNull(),
    );
    expect(renderer().querySelector("[data-page='1'] .textLayer")).toBeEmptyDOMElement();
    expect(renderer().querySelector("[data-page='1'] .annotationLayer a")).toBeNull();
    expect(renderer()).not.toHaveTextContent(t("error.firstPage"));
  });
});
