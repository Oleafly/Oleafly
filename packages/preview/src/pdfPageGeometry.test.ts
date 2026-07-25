import { describe, expect, it, vi } from "vitest";
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
