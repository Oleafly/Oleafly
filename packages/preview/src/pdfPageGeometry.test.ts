import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPdfPageViewport,
  scanPdfPageViewports,
} from "./pdfPageGeometry";

interface MockPage {
  cleanup: ReturnType<typeof vi.fn>;
  getViewport: ReturnType<typeof vi.fn>;
}

function page(width = 612, height = 792): MockPage {
  return {
    cleanup: vi.fn(),
    getViewport: vi.fn(() => ({
      width,
      height,
      scale: 1,
      userUnit: 1,
      rotation: 0,
    })),
  };
}

describe("progressive PDF page geometry", () => {
  it("cleans a page proxy that resolves after its request was cancelled", async () => {
    let resolvePage!: (value: MockPage) => void;
    const latePage = page();
    const doc = {
      getPage: vi.fn(
        () =>
          new Promise<MockPage>((resolve) => {
            resolvePage = resolve;
          }),
      ),
    };
    const abort = new AbortController();

    const pending = loadPdfPageViewport(
      doc as never,
      2,
      abort.signal,
      10_000,
    );
    abort.abort("document switched");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    resolvePage(latePage);
    await Promise.resolve();
    expect(latePage.cleanup).toHaveBeenCalledOnce();
  });

  it("stops all 400-page scan workers when one page rejects", async () => {
    const claimed: number[] = [];
    const pages = new Map<number, MockPage>();
    const doc = {
      numPages: 400,
      getPage: vi.fn((pageNumber: number) => {
        claimed.push(pageNumber);
        if (pageNumber === 3) {
          return Promise.reject(new Error("corrupt page tree"));
        }
        // Other sibling workers hang until the scan aborts. Their late results
        // are supplied below to verify cleanup.
        return new Promise<MockPage>(() => {});
      }),
    };
    const lifecycle = new AbortController();
    const failures: Array<{ pageNumber: number; error: unknown }> = [];

    const scan = scanPdfPageViewports(doc as never, {
      signal: lifecycle.signal,
      startPage: 2,
      concurrency: 8,
      timeoutMs: 10_000,
      onViewport: vi.fn(),
      onError: (error, pageNumber) => failures.push({ error, pageNumber }),
    });
    await scan.done;

    expect(failures).toHaveLength(1);
    expect(failures[0]?.pageNumber).toBe(3);
    expect(claimed.length).toBeLessThanOrEqual(8);
    expect(Math.max(...claimed)).toBeLessThanOrEqual(9);
    expect(doc.getPage).toHaveBeenCalledTimes(claimed.length);
    expect(pages.size).toBe(0);
  });

  it("reports exact mixed geometry progressively without waiting for page 400", async () => {
    let resolveLast!: (value: MockPage) => void;
    const seen: number[] = [];
    const doc = {
      numPages: 400,
      getPage: vi.fn((pageNumber: number) => {
        if (pageNumber === 400) {
          return new Promise<MockPage>((resolve) => {
            resolveLast = resolve;
          });
        }
        return Promise.resolve(page(500 + pageNumber, 700 + pageNumber));
      }),
    };
    const lifecycle = new AbortController();
    const scan = scanPdfPageViewports(doc as never, {
      signal: lifecycle.signal,
      startPage: 2,
      concurrency: 8,
      timeoutMs: 10_000,
      onViewport: (pageNumber) => seen.push(pageNumber),
    });

    await vi.waitFor(() => expect(seen).toContain(399));
    expect(seen).not.toContain(400);
    expect(seen).toContain(2);
    lifecycle.abort();
    await scan.done;

    // Resolve the unabortable pdf.js request after teardown; it must be cleaned.
    const latePage = page(900, 900);
    resolveLast(latePage);
    await Promise.resolve();
    expect(latePage.cleanup).toHaveBeenCalledOnce();
  });
});

describe("PDF page geometry cancellation and timeouts", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function pendingDocument() {
    let resolvePage!: (value: MockPage) => void;
    const doc = {
      numPages: 3,
      getPage: vi.fn(
        () =>
          new Promise<MockPage>((resolve) => {
            resolvePage = resolve;
          }),
      ),
    };
    return { doc, resolve: (value: MockPage) => resolvePage(value) };
  }

  it("rejects at once with the abort reason when already cancelled", async () => {
    const { doc, resolve } = pendingDocument();
    const abort = new AbortController();
    abort.abort("document closed");

    await expect(loadPdfPageViewport(doc as never, 2, abort.signal)).rejects.toMatchObject({
      name: "AbortError",
      message: "document closed",
    });

    const late = page();
    late.cleanup.mockImplementation(() => {
      throw new Error("already released");
    });
    resolve(late);
    await Promise.resolve();
    expect(late.cleanup).toHaveBeenCalledOnce();
  });

  it("keeps a DOMException abort reason and names non-text reasons generically", async () => {
    const reason = new DOMException("superseded", "AbortError");
    const domAbort = new AbortController();
    domAbort.abort(reason);
    await expect(
      loadPdfPageViewport(pendingDocument().doc as never, 1, domAbort.signal),
    ).rejects.toBe(reason);

    const objectAbort = new AbortController();
    objectAbort.abort({ code: 7 });
    await expect(
      loadPdfPageViewport(pendingDocument().doc as never, 4, objectAbort.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
      message: "PDF page 4 geometry cancelled",
    });
  });

  it("times out a page that never arrives", async () => {
    vi.useFakeTimers();
    const pending = loadPdfPageViewport(
      pendingDocument().doc as never,
      3,
      new AbortController().signal,
      50,
    );
    const outcome = expect(pending).rejects.toThrow("PDF page 3 geometry timed out after 50ms");

    await vi.advanceTimersByTimeAsync(50);

    await outcome;
  });

  it("applies the viewer rotation on top of the page's own rotation", async () => {
    const proxy = { ...page(), rotate: 90 };
    const doc = { getPage: vi.fn(() => Promise.resolve(proxy)) };

    await loadPdfPageViewport(doc as never, 1, new AbortController().signal, 1_000, 270);

    expect(proxy.getViewport).toHaveBeenCalledWith({ scale: 1, rotation: 0 });
    expect(proxy.cleanup).toHaveBeenCalledOnce();
  });

  it("does nothing when the parent signal is already aborted", async () => {
    const doc = { numPages: 3, getPage: vi.fn() };
    const abort = new AbortController();
    abort.abort("closed");
    const onViewport = vi.fn();
    const onError = vi.fn();

    await scanPdfPageViewports(doc as never, { signal: abort.signal, onViewport, onError }).done;

    expect(doc.getPage).not.toHaveBeenCalled();
    expect(onViewport).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("has nothing to scan past the last page", async () => {
    const doc = { numPages: 1, getPage: vi.fn() };
    const onViewport = vi.fn();

    await scanPdfPageViewports(doc as never, {
      signal: new AbortController().signal,
      startPage: 2,
      onViewport,
    }).done;

    expect(doc.getPage).not.toHaveBeenCalled();
  });

  it("scans from the first page by default and tolerates a missing error handler", async () => {
    const doc = {
      numPages: 2,
      getPage: vi.fn((pageNumber: number) =>
        pageNumber === 2 ? Promise.reject(new Error("broken")) : Promise.resolve(page()),
      ),
    };
    const onViewport = vi.fn();

    await scanPdfPageViewports(doc as never, {
      signal: new AbortController().signal,
      onViewport,
    }).done;

    expect(doc.getPage).toHaveBeenCalledWith(1);
    expect(onViewport).toHaveBeenCalledWith(1, expect.objectContaining({ width: 612 }));
  });
});
