import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "@oleafly/preview/pdf.worker?worker&url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

function textContentToPageText(items: readonly unknown[]): string {
  const line: string[] = [];
  let lastY: number | null = null;
  for (const raw of items) {
    const item = raw as { str?: unknown; transform?: number[] };
    if (!("str" in item)) continue;
    const str = typeof item?.str === "string" ? item.str : "";
    const y = item?.transform?.[5];
    if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) {
      line.push("\n");
    }
    line.push(str);
    if (y !== undefined) lastY = y;
  }
  return line.join("").replace(/(?<![ \t])[ \t]+\n/g, "\n").trim();
}

/** Longest a PDF may take to give up its text; a document that wedges the worker never answers. */
const EXTRACT_TIMEOUT_MS = 20_000;

async function readPages(
  loadingTask: pdfjsLib.PDFDocumentLoadingTask,
  maxPages: number | undefined,
): Promise<{ pages: string[]; numPages: number }> {
  const doc = await loadingTask.promise;
  const numPages = doc.numPages;
  const lastPage = Math.min(numPages, maxPages ?? numPages);
  const pages: string[] = [];

  for (let p = 1; p <= lastPage; p++) {
    const page = await doc.getPage(p);
    try {
      const tc = await page.getTextContent();
      pages.push(textContentToPageText(tc.items));
    } finally {
      try {
        page.cleanup();
      } catch {
      }
    }
  }

  return { pages, numPages };
}

/**
 * The text of each page, up to `maxPages` (all pages by default).
 * `numPages` is always the document's real page count. Rejects when the
 * document takes longer than `timeoutMs` (20 seconds by default).
 */
export async function extractPdfText(
  bytes: Uint8Array,
  opts?: { maxPages?: number; timeoutMs?: number },
): Promise<{ pages: string[]; numPages: number }> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      // A wedged worker does not answer a destroy either, so nothing waits for it.
      void Promise.resolve()
        .then(() => loadingTask.destroy())
        .catch(() => {});
      reject(new Error("PDF text extraction timed out"));
    }, opts?.timeoutMs ?? EXTRACT_TIMEOUT_MS);
  });
  const work = readPages(loadingTask, opts?.maxPages);
  // After a timeout the destroy aborts the work, which rejects with nobody listening.
  work.catch(() => {});
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    if (!timedOut) {
      try {
        await loadingTask.destroy();
      } catch {
      }
    }
  }
}
