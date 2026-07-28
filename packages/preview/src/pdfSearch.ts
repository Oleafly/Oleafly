import type * as pdfjsLib from "pdfjs-dist";

export const PDF_SEARCH_CONCURRENCY = 4;
export const PDF_SEARCH_PAGE_TIMEOUT_MS = 15_000;

export interface PdfSearchMatch {
  pageNumber: number;
  startItem: number;
  startOffset: number;
  endItem: number;
  endOffset: number;
}

export interface PdfSearchProgress {
  scannedPages: number;
  totalPages: number;
}

interface TextSegment {
  item: number;
  start: number;
  end: number;
}

function abortError(signal: AbortSignal): DOMException {
  return new DOMException(
    typeof signal.reason === "string" && signal.reason
      ? signal.reason
      : "PDF search cancelled",
    "AbortError",
  );
}

function racePageWork<T>(
  work: Promise<T>,
  signal: AbortSignal,
  pageNumber: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortError(signal)));
    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(
            new Error(
              `Text extraction for PDF page ${pageNumber} timed out after ${PDF_SEARCH_PAGE_TIMEOUT_MS}ms`,
            ),
          ),
        ),
      PDF_SEARCH_PAGE_TIMEOUT_MS,
    );
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function pageMatches(
  pageNumber: number,
  content: Awaited<
    ReturnType<pdfjsLib.PDFPageProxy["getTextContent"]>
  >,
  query: string,
): PdfSearchMatch[] {
  const segments: TextSegment[] = [];
  let text = "";
  let textItemIndex = 0;
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const start = text.length;
    text += item.str;
    const end = text.length;
    segments.push({ item: textItemIndex++, start, end });
    if (item.hasEOL) text += "\n";
  }
  if (!text || !segments.length) return [];

  const results: PdfSearchMatch[] = [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matcher = new RegExp(escaped, "giu");
  for (const match of text.matchAll(matcher)) {
    const index = match.index;
    const endIndex = index + match[0].length;
    const first =
      segments.find(
        (segment) => index >= segment.start && index < segment.end,
      ) ?? null;
    const last =
      [...segments]
        .reverse()
        .find(
          (segment) =>
            endIndex > segment.start && endIndex <= segment.end,
        ) ?? null;
    if (first && last) {
      results.push({
        pageNumber,
        startItem: first.item,
        startOffset: index - first.start,
        endItem: last.item,
        endOffset: endIndex - last.start,
      });
    }
  }
  return results;
}

/**
 * Search every page without truncation. Work is bounded to four page proxies
 * at a time, and a failure is surfaced for the complete search rather than
 * silently returning a partial count.
 */
export async function searchPdfDocument(
  document: pdfjsLib.PDFDocumentProxy,
  query: string,
  signal: AbortSignal,
  onProgress?: (progress: PdfSearchProgress) => void,
): Promise<PdfSearchMatch[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const matchesByPage = new Map<number, PdfSearchMatch[]>();
  let nextPage = 1;
  let scannedPages = 0;
  const workerCount = Math.min(
    PDF_SEARCH_CONCURRENCY,
    Math.max(1, document.numPages),
  );

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!signal.aborted) {
        const pageNumber = nextPage++;
        if (pageNumber > document.numPages) return;
        const page = await racePageWork(
          Promise.resolve(document.getPage(pageNumber)),
          signal,
          pageNumber,
        );
        try {
          const content = await racePageWork(
            page.getTextContent({
              includeMarkedContent: true,
              disableNormalization: true,
            }),
            signal,
            pageNumber,
          );
          if (signal.aborted) throw abortError(signal);
          matchesByPage.set(
            pageNumber,
            pageMatches(pageNumber, content, normalizedQuery),
          );
          scannedPages++;
          onProgress?.({
            scannedPages,
            totalPages: document.numPages,
          });
        } finally {
          try {
            page.cleanup();
          } catch {
            /* the renderer may still own this cached page proxy */
          }
        }
      }
      throw abortError(signal);
    }),
  );

  if (signal.aborted) throw abortError(signal);
  return [...matchesByPage.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, matches]) => matches);
}
