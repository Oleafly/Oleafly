import { afterEach, describe, expect, it, vi } from "vitest";
import type * as pdfjsLib from "pdfjs-dist";
import {
  PDF_SEARCH_CONCURRENCY,
  PDF_SEARCH_PAGE_TIMEOUT_MS,
  searchPdfDocument,
} from "./pdfSearch";

type TextItem = { str: string; hasEOL?: boolean } | { type: string };

interface FakePage {
  getTextContent: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
}

function fakeDocument(
  pages: TextItem[][],
  options: {
    getPage?: (pageNumber: number) => Promise<FakePage>;
    textContent?: (pageNumber: number) => Promise<{ items: TextItem[] }>;
  } = {},
) {
  const created: FakePage[] = [];
  const makePage = (pageNumber: number): FakePage => {
    const page = {
      getTextContent: vi.fn(() =>
        options.textContent
          ? options.textContent(pageNumber)
          : Promise.resolve({ items: pages[pageNumber - 1] ?? [] }),
      ),
      cleanup: vi.fn(),
    };
    created.push(page);
    return page;
  };
  const document = {
    numPages: pages.length,
    getPage: vi.fn((pageNumber: number) =>
      options.getPage ? options.getPage(pageNumber) : Promise.resolve(makePage(pageNumber)),
    ),
  };
  return {
    document: document as unknown as pdfjsLib.PDFDocumentProxy,
    getPage: document.getPage,
    created,
    makePage,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("searchPdfDocument", () => {
  it("returns no matches for a blank query without touching the document", async () => {
    const { document, getPage } = fakeDocument([[{ str: "anything" }]]);

    await expect(
      searchPdfDocument(document, "   ", new AbortController().signal),
    ).resolves.toEqual([]);
    expect(getPage).not.toHaveBeenCalled();
  });

  it("finds case-insensitive matches in page order with item offsets", async () => {
    const { document } = fakeDocument([
      [{ str: "Results are " }, { str: "RESULTS" }],
      [],
      [{ str: "no hits here" }],
      [{ str: "final results" }],
    ]);

    const matches = await searchPdfDocument(
      document,
      "  results ",
      new AbortController().signal,
    );

    expect(matches).toEqual([
      { pageNumber: 1, startItem: 0, startOffset: 0, endItem: 0, endOffset: 7 },
      { pageNumber: 1, startItem: 1, startOffset: 0, endItem: 1, endOffset: 7 },
      { pageNumber: 4, startItem: 0, startOffset: 6, endItem: 0, endOffset: 13 },
    ]);
  });

  it("maps a match that spans two text items and ignores marked-content entries", async () => {
    const { document } = fakeDocument([
      [
        { type: "beginMarkedContent" },
        { str: "conclu" },
        { type: "endMarkedContent" },
        { str: "sion follows" },
      ],
    ]);

    await expect(
      searchPdfDocument(document, "conclusion", new AbortController().signal),
    ).resolves.toEqual([
      { pageNumber: 1, startItem: 0, startOffset: 0, endItem: 1, endOffset: 4 },
    ]);
  });

  it("treats regular-expression characters in the query literally", async () => {
    const { document } = fakeDocument([[{ str: "cost (USD) is $5.00 or 5x00" }]]);

    await expect(
      searchPdfDocument(document, "$5.00", new AbortController().signal),
    ).resolves.toEqual([
      { pageNumber: 1, startItem: 0, startOffset: 14, endItem: 0, endOffset: 19 },
    ]);
    await expect(
      searchPdfDocument(document, "(USD)", new AbortController().signal),
    ).resolves.toHaveLength(1);
  });

  it("keeps line breaks between items so text never joins across lines", async () => {
    const { document } = fakeDocument([
      [{ str: "data", hasEOL: true }, { str: "base" }],
    ]);

    await expect(
      searchPdfDocument(document, "database", new AbortController().signal),
    ).resolves.toEqual([]);
    await expect(
      searchPdfDocument(document, "base", new AbortController().signal),
    ).resolves.toEqual([
      { pageNumber: 1, startItem: 1, startOffset: 0, endItem: 1, endOffset: 4 },
    ]);
  });

  it("reports progress for every scanned page and releases each page proxy", async () => {
    const { document, created } = fakeDocument([
      [{ str: "a" }],
      [{ str: "b" }],
      [{ str: "c" }],
    ]);
    const onProgress = vi.fn();

    await searchPdfDocument(document, "b", new AbortController().signal, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith({ scannedPages: 3, totalPages: 3 });
    expect(created).toHaveLength(3);
    for (const page of created) {
      expect(page.getTextContent).toHaveBeenCalledWith({
        includeMarkedContent: true,
        disableNormalization: true,
      });
      expect(page.cleanup).toHaveBeenCalledOnce();
    }
  });

  it("still completes when a page proxy refuses cleanup", async () => {
    const harness = fakeDocument([[{ str: "keep going" }]], {
      getPage: (pageNumber) => {
        const page = harness.makePage(pageNumber);
        page.cleanup.mockImplementation(() => {
          throw new Error("page is owned by the renderer");
        });
        return Promise.resolve(page);
      },
    });

    await expect(
      searchPdfDocument(harness.document, "going", new AbortController().signal),
    ).resolves.toHaveLength(1);
  });

  it("returns nothing for a document without pages", async () => {
    const { document, getPage } = fakeDocument([]);

    await expect(
      searchPdfDocument(document, "x", new AbortController().signal),
    ).resolves.toEqual([]);
    expect(getPage).not.toHaveBeenCalled();
  });

  it("never has more than four pages in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const pending: Array<() => void> = [];
    const pages = Array.from({ length: 10 }, () => [{ str: "word" }]);
    const harness = fakeDocument(pages, {
      textContent: (pageNumber) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        return new Promise((resolve) => {
          pending.push(() => {
            inFlight--;
            resolve({ items: pages[pageNumber - 1] });
          });
        });
      },
    });

    let settled = false;
    const search = searchPdfDocument(
      harness.document,
      "word",
      new AbortController().signal,
    );
    search.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    for (let turn = 0; turn < 500 && !settled; turn++) {
      await Promise.resolve();
      pending.shift()?.();
    }

    await expect(search).resolves.toHaveLength(10);
    expect(peak).toBe(PDF_SEARCH_CONCURRENCY);
  });

  it("rejects with the abort reason when cancelled before it starts", async () => {
    const { document, getPage } = fakeDocument([[{ str: "a" }]]);
    const controller = new AbortController();
    controller.abort("A newer PDF search started");

    await expect(
      searchPdfDocument(document, "a", controller.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
      message: "A newer PDF search started",
    });
    expect(getPage).not.toHaveBeenCalled();
  });

  it("rejects with a generic cancellation while a page is still extracting", async () => {
    const harness = fakeDocument([[{ str: "a" }]], {
      textContent: () => new Promise(() => {}),
    });
    const controller = new AbortController();

    const search = searchPdfDocument(harness.document, "a", controller.signal);
    await vi.waitFor(() => expect(harness.created).toHaveLength(1));
    controller.abort();

    await expect(search).rejects.toMatchObject({
      name: "AbortError",
      message: "PDF search cancelled",
    });
    expect(harness.created[0].cleanup).toHaveBeenCalledOnce();
  });

  it("stops other workers once progress reporting cancels the search", async () => {
    const { document } = fakeDocument([
      [{ str: "a" }],
      [{ str: "a" }],
      [{ str: "a" }],
      [{ str: "a" }],
      [{ str: "a" }],
    ]);
    const controller = new AbortController();
    const onProgress = vi.fn(() => controller.abort("closed"));

    await expect(
      searchPdfDocument(document, "a", controller.signal, onProgress),
    ).rejects.toMatchObject({ name: "AbortError", message: "closed" });
    expect(onProgress).toHaveBeenCalledOnce();
  });

  it("fails the whole search when one page cannot be loaded", async () => {
    const harness = fakeDocument([[{ str: "a" }], [{ str: "a" }]], {
      getPage: (pageNumber) =>
        pageNumber === 2
          ? Promise.reject(new Error("page 2 is damaged"))
          : Promise.resolve(harness.makePage(pageNumber)),
    });

    await expect(
      searchPdfDocument(harness.document, "a", new AbortController().signal),
    ).rejects.toThrow("page 2 is damaged");
  });

  it("times out a page whose text never arrives", async () => {
    vi.useFakeTimers();
    const harness = fakeDocument([[{ str: "a" }]], {
      textContent: () => new Promise(() => {}),
    });

    const search = searchPdfDocument(
      harness.document,
      "a",
      new AbortController().signal,
    );
    const outcome = expect(search).rejects.toThrow(
      `Text extraction for PDF page 1 timed out after ${PDF_SEARCH_PAGE_TIMEOUT_MS}ms`,
    );
    await vi.advanceTimersByTimeAsync(PDF_SEARCH_PAGE_TIMEOUT_MS);

    await outcome;
    expect(harness.created[0].cleanup).toHaveBeenCalledOnce();
  });
});
