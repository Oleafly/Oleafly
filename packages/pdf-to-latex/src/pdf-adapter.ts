import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "@oleafly/preview/pdf.worker?worker&url";
import { rawToRgba, rgbaToPngDataUrl } from "./figure-decode";
import type { ExtractedFigure, PageInput, TextItem } from "./types";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const MIN_FIGURE_PX = 32;

export async function extractPagesForConvert(
  bytes: Uint8Array,
): Promise<{ pages: PageInput[]; figures: ExtractedFigure[] }> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const pages: PageInput[] = [];
  const figures: ExtractedFigure[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const view = page.view;
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const raw of content.items) {
        if (!("str" in raw) || !raw.str) continue;
        const t = raw.transform;
        items.push({
          str: raw.str,
          x: t[4],
          y: t[5],
          width: raw.width,
          height: raw.height,
          fontName:
            (content.styles?.[raw.fontName]?.fontFamily as string | undefined) ?? raw.fontName,
          fontSize: Math.hypot(t[2], t[3]) || Math.abs(t[3]) || raw.height,
        });
      }
      const figureNames: string[] = [];
      try {
        const ops = await page.getOperatorList();
        let n = 0;
        for (let i = 0; i < ops.fnArray.length; i++) {
          if (ops.fnArray[i] !== pdfjsLib.OPS.paintImageXObject) continue;
          const objName = ops.argsArray[i][0] as string;
          // biome-ignore lint/suspicious/noExplicitAny: pdf.js image objects are untyped
          const img = await new Promise<any>((resolve) => {
            try {
              page.objs.get(objName, resolve);
            } catch {
              resolve(null);
            }
          });
          if (!img?.data || img.width < MIN_FIGURE_PX || img.height < MIN_FIGURE_PX) continue;
          n++;
          const name = `figure_p${p}_${n}.png`;
          const rgba = rawToRgba(img.data, img.width, img.height, img.kind ?? 2);
          figures.push({ name, page: p, pngDataUrl: rgbaToPngDataUrl(rgba, img.width, img.height) });
          figureNames.push(name);
        }
      } catch {
        // operator list failures must not sink text conversion
      }
      pages.push({ width: view[2] - view[0], height: view[3] - view[1], items, figureNames });
    }
  } finally {
    await doc.destroy();
  }
  return { pages, figures };
}
