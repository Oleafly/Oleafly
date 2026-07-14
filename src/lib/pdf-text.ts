import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export async function extractPdfText(
  bytes: Uint8Array
): Promise<{ pages: string[]; numPages: number }> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const doc = await loadingTask.promise;
  const numPages = doc.numPages;
  const pages: string[] = [];

  for (let p = 1; p <= numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const line: string[] = [];
    let lastY: number | null = null;
    for (const item of tc.items as any[]) {
      const str = typeof item?.str === "string" ? item.str : "";
      const y = item?.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) {
        line.push("\n");
      }
      line.push(str);
      if (y !== undefined) lastY = y;
    }
    pages.push(line.join("").replace(/[ \t]+\n/g, "\n").trim());
    page.cleanup();
  }

  await loadingTask.destroy();
  return { pages, numPages };
}
