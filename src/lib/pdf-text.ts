import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "@oleafly/preview/pdf.worker?worker&url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export async function extractPdfText(
  bytes: Uint8Array
): Promise<{ pages: string[]; numPages: number }> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  try {
    const doc = await loadingTask.promise;
    const numPages = doc.numPages;
    const pages: string[] = [];

    for (let p = 1; p <= numPages; p++) {
      const page = await doc.getPage(p);
      try {
        const tc = await page.getTextContent();
        const line: string[] = [];
        let lastY: number | null = null;
        for (const item of tc.items) {
          if (!("str" in item)) continue;
          const str = typeof item?.str === "string" ? item.str : "";
          const y = item?.transform?.[5];
          if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) {
            line.push("\n");
          }
          line.push(str);
          if (y !== undefined) lastY = y;
        }
        pages.push(line.join("").replace(/[ \t]+\n/g, "\n").trim());
      } finally {
        try {
          page.cleanup();
        } catch {
        }
      }
    }

    return { pages, numPages };
  } finally {
    try {
      await loadingTask.destroy();
    } catch {
    }
  }
}
