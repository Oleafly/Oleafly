import type * as pdfjsLib from "pdfjs-dist";

export type PdfPageViewport = ReturnType<pdfjsLib.PDFPageProxy["getViewport"]>;

export const PDF_PAGE_GEOMETRY_TIMEOUT_MS = 8_000;
export const PDF_PAGE_GEOMETRY_CONCURRENCY = 8;

function abortError(signal: AbortSignal, fallback: string): DOMException {
  const reason = signal.reason;
  if (reason instanceof DOMException) return reason;
  return new DOMException(
    typeof reason === "string" && reason ? reason : fallback,
    "AbortError",
  );
}

function raceWithAbortAndTimeout<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  description: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal, `${description} cancelled`));
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
    const onAbort = () =>
      finish(() => reject(abortError(signal, `${description} cancelled`)));
    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(new Error(`${description} timed out after ${timeoutMs}ms`)),
        ),
      timeoutMs,
    );

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

/**
 * Load one page's exact scale-one viewport without allowing a stuck `getPage`
 * request to pin the viewer forever.
 *
 * pdf.js cannot abort an individual `getPage` call. If cancellation or timeout
 * wins, the late page proxy is cleaned as soon as it arrives, so its resources
 * cannot leak into a superseded document.
 */
export async function loadPdfPageViewport(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  signal: AbortSignal,
  timeoutMs = PDF_PAGE_GEOMETRY_TIMEOUT_MS,
): Promise<PdfPageViewport> {
  let abandoned = false;
  const pagePromise = Promise.resolve(doc.getPage(pageNumber));
  void pagePromise.then(
    (latePage) => {
      if (!abandoned) return;
      try {
        latePage.cleanup();
      } catch {
        /* the late proxy was already released */
      }
    },
    () => {},
  );

  let page: pdfjsLib.PDFPageProxy;
  try {
    page = await raceWithAbortAndTimeout(
      pagePromise,
      signal,
      timeoutMs,
      `PDF page ${pageNumber} geometry`,
    );
  } catch (error) {
    abandoned = true;
    throw error;
  }

  try {
    if (signal.aborted) {
      throw abortError(signal, `PDF page ${pageNumber} geometry cancelled`);
    }
    return page.getViewport({ scale: 1 });
  } finally {
    page.cleanup();
  }
}

export interface PdfPageGeometryScan {
  abort: (reason?: unknown) => void;
  done: Promise<void>;
}

export interface ScanPdfPageViewportsOptions {
  signal: AbortSignal;
  startPage?: number;
  concurrency?: number;
  timeoutMs?: number;
  onViewport: (pageNumber: number, viewport: PdfPageViewport) => void;
  onError?: (error: unknown, pageNumber: number) => void;
}

/**
 * Progressively scan page geometry with bounded concurrency.
 *
 * The first real failure aborts every sibling wait and prevents workers from
 * claiming more pages. `done` resolves after teardown; the caller can keep the
 * already-built layout usable and retry individual pages on demand.
 */
export function scanPdfPageViewports(
  doc: pdfjsLib.PDFDocumentProxy,
  options: ScanPdfPageViewportsOptions,
): PdfPageGeometryScan {
  const scanAbort = new AbortController();
  const startPage = Math.max(1, Math.floor(options.startPage ?? 1));
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? PDF_PAGE_GEOMETRY_TIMEOUT_MS));
  const concurrency = Math.max(
    1,
    Math.min(
      doc.numPages - startPage + 1,
      Math.floor(options.concurrency ?? PDF_PAGE_GEOMETRY_CONCURRENCY),
    ),
  );
  let nextPage = startPage;
  let reportedFailure = false;

  const abortFromParent = () => scanAbort.abort(options.signal.reason);
  if (options.signal.aborted) {
    abortFromParent();
  } else {
    options.signal.addEventListener("abort", abortFromParent, { once: true });
  }

  const workers =
    startPage > doc.numPages
      ? []
      : Array.from({ length: concurrency }, async () => {
          while (!scanAbort.signal.aborted) {
            const pageNumber = nextPage++;
            if (pageNumber > doc.numPages) return;
            try {
              const viewport = await loadPdfPageViewport(
                doc,
                pageNumber,
                scanAbort.signal,
                timeoutMs,
              );
              if (scanAbort.signal.aborted) return;
              options.onViewport(pageNumber, viewport);
            } catch (error) {
              if (
                scanAbort.signal.aborted &&
                (options.signal.aborted ||
                  (error instanceof DOMException && error.name === "AbortError"))
              ) {
                return;
              }
              if (!reportedFailure) {
                reportedFailure = true;
                options.onError?.(error, pageNumber);
              }
              scanAbort.abort(error);
              return;
            }
          }
        });

  const done = Promise.all(workers).then(() => {
    options.signal.removeEventListener("abort", abortFromParent);
  });

  return {
    abort: (reason?: unknown) => scanAbort.abort(reason),
    done,
  };
}
