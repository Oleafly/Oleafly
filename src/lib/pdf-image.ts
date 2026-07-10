import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

/**
 * Rasterize one page of a PDF byte array to a PNG data URL using pdf.js.
 * Used to show a compiled figure to a vision model (and in the Playground).
 * `scale` 2 gives a crisp thumbnail without ballooning the data URL.
 */
export async function pdfPageToPng(
  bytes: Uint8Array,
  page = 1,
  scale = 2,
): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const doc = await loadingTask.promise;
  try {
    const pageNo = Math.min(Math.max(1, page), doc.numPages);
    const p = await doc.getPage(pageNo);
    const viewport = p.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    await p.render({ canvas, canvasContext: ctx, viewport }).promise;
    p.cleanup();
    return canvas.toDataURL("image/png");
  } finally {
    await loadingTask.destroy();
  }
}
