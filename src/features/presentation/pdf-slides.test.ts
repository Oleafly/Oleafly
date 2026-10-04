// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pdf = vi.hoisted(() => {
  const state = {
    workers: [] as Array<{ promise: Promise<void>; destroy: ReturnType<typeof vi.fn> }>,
    workerPromise: () => Promise.resolve() as Promise<void>,
    loadingTasks: [] as Array<{ promise: Promise<unknown>; destroy: ReturnType<typeof vi.fn> }>,
    documentPromise: () => Promise.resolve({}) as Promise<unknown>,
    getDocument: vi.fn(),
    installMainThreadPdfWorker: vi.fn(async () => {}),
  };
  class PDFWorker {
    promise: Promise<void>;
    destroy = vi.fn();
    constructor() {
      this.promise = state.workerPromise();
      state.workers.push(this);
    }
  }
  state.getDocument.mockImplementation(() => {
    const task = { promise: state.documentPromise(), destroy: vi.fn(async () => {}) };
    state.loadingTasks.push(task);
    return task;
  });
  return { state, PDFWorker };
});

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  PDFWorker: pdf.PDFWorker,
  getDocument: pdf.state.getDocument,
}));
vi.mock("@oleafly/preview/pdf.worker?worker&url", () => ({ default: "pdf.worker.js" }));
vi.mock("@oleafly/preview/mainThreadWorker", () => ({
  installMainThreadPdfWorker: pdf.state.installMainThreadPdfWorker,
}));

import { openSlideDocument } from "./pdf-slides";

function page(renderPromise: () => Promise<void> = () => Promise.resolve()) {
  const render = vi.fn(() => ({ promise: renderPromise(), cancel: vi.fn() }));
  return {
    render,
    getViewport: ({ scale }: { scale: number }) => ({ width: 200 * scale, height: 100 * scale }),
  };
}

function pdfDocument(pages: ReturnType<typeof page>[]) {
  return { numPages: pages.length, getPage: vi.fn(async (n: number) => pages[n - 1]) };
}

const drawImage = vi.fn();

beforeEach(() => {
  pdf.state.workers.length = 0;
  pdf.state.loadingTasks.length = 0;
  pdf.state.workerPromise = () => Promise.resolve();
  pdf.state.getDocument.mockClear();
  pdf.state.installMainThreadPdfWorker.mockClear();
  drawImage.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("slide documents", () => {
  it("renders a page scaled to fit the box at the screen's pixel ratio", async () => {
    const first = page();
    pdf.state.documentPromise = () => Promise.resolve(pdfDocument([first]));
    const slides = await openSlideDocument(new Uint8Array([1, 2, 3]));
    const canvas = document.createElement("canvas");

    await expect(slides.render(1, canvas, { width: 400, height: 400 }, 2)).resolves.toBe(true);

    expect(slides.numPages).toBe(1);
    expect(pdf.state.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ data: new Uint8Array([1, 2, 3]), worker: pdf.state.workers[0] }),
    );
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(400);
    expect(canvas.style.width).toBe("400px");
    expect(canvas.style.height).toBe("200px");
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(first.render).toHaveBeenCalledWith(expect.objectContaining({ background: "#ffffff" }));
  });

  it("refuses pages outside the document", async () => {
    pdf.state.documentPromise = () => Promise.resolve(pdfDocument([page()]));
    const slides = await openSlideDocument(new Uint8Array([1]));
    const canvas = document.createElement("canvas");

    await expect(slides.render(0, canvas, { width: 10, height: 10 }, 1)).resolves.toBe(false);
    await expect(slides.render(2, canvas, { width: 10, height: 10 }, 1)).resolves.toBe(false);
  });

  it("reports a render that failed or had no drawing context", async () => {
    pdf.state.documentPromise = () => Promise.resolve(pdfDocument([page(() => Promise.reject(new Error("cancelled")))]));
    const slides = await openSlideDocument(new Uint8Array([1]));
    const canvas = document.createElement("canvas");

    await expect(slides.render(1, canvas, { width: 10, height: 10 }, 1)).resolves.toBe(false);

    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    await expect(slides.render(1, canvas, { width: 10, height: 10 }, 1)).resolves.toBe(false);
  });

  it("cancels an earlier render into the same canvas", async () => {
    let finishFirst: () => void = () => {};
    const slide = page();
    const cancel = vi.fn();
    slide.render
      .mockImplementationOnce(() => ({
        promise: new Promise<void>((resolve) => (finishFirst = resolve)),
        cancel,
      }))
      .mockImplementationOnce(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
    pdf.state.documentPromise = () => Promise.resolve(pdfDocument([slide]));
    const slides = await openSlideDocument(new Uint8Array([1]));
    const canvas = document.createElement("canvas");

    const first = slides.render(1, canvas, { width: 10, height: 10 }, 1);
    await vi.waitFor(() => expect(slide.render).toHaveBeenCalledTimes(1));
    const second = slides.render(1, canvas, { width: 10, height: 10 }, 1);
    await expect(second).resolves.toBe(true);
    finishFirst();
    await first;

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("stops rendering and releases the worker once destroyed", async () => {
    let finish: () => void = () => {};
    pdf.state.documentPromise = () =>
      Promise.resolve(pdfDocument([page(() => new Promise<void>((resolve) => (finish = resolve)))]));
    const slides = await openSlideDocument(new Uint8Array([1]));
    const canvas = document.createElement("canvas");

    const rendering = slides.render(1, canvas, { width: 10, height: 10 }, 1);
    await vi.waitFor(() => expect(pdf.state.getDocument).toHaveBeenCalled());
    await Promise.resolve();
    slides.destroy();
    slides.destroy();
    finish();

    await expect(rendering).resolves.toBe(false);
    await expect(slides.render(1, canvas, { width: 10, height: 10 }, 1)).resolves.toBe(false);
    expect(pdf.state.loadingTasks[0].destroy).toHaveBeenCalledTimes(1);
    expect(pdf.state.workers[0].destroy).toHaveBeenCalledTimes(1);
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("falls back to a main-thread worker when the worker cannot load the PDF", async () => {
    let attempt = 0;
    pdf.state.documentPromise = () => {
      attempt += 1;
      return attempt === 1 ? Promise.reject("worker crashed") : Promise.resolve(pdfDocument([page()]));
    };

    const slides = await openSlideDocument(new Uint8Array([1]));

    expect(slides.numPages).toBe(1);
    expect(pdf.state.installMainThreadPdfWorker).toHaveBeenCalledTimes(1);
    expect(pdf.state.workers[0].destroy).toHaveBeenCalledTimes(1);
    expect(pdf.state.loadingTasks[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("gives up on a worker that never starts", async () => {
    vi.useFakeTimers();
    pdf.state.workerPromise = () => new Promise<void>(() => {});
    pdf.state.documentPromise = () => Promise.resolve(pdfDocument([page()]));

    const opening = openSlideDocument(new Uint8Array([1]));
    const outcome = expect(opening).rejects.toThrow("pdf worker setup timed out after 5000ms");
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await outcome;

    expect(pdf.state.installMainThreadPdfWorker).toHaveBeenCalledTimes(1);
    expect(pdf.state.workers).toHaveLength(2);
    expect(pdf.state.getDocument).not.toHaveBeenCalled();
  });
});
