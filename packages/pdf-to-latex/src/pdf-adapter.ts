import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "@oleafly/preview/pdf.worker?worker&url";
import { bitmapToPngDataUrl, rawToRgba, rgbaToPngDataUrl } from "./figure-decode";
import type { ExtractedFigure, PageInput, TextItem } from "./types";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const MIN_FIGURE_PX = 32;

/** Infer the pixel layout when pdf.js omits `kind` (e.g. decoded JPEGs). */
// biome-ignore lint/suspicious/noExplicitAny: pdf.js image objects are untyped
function guessKind(img: any): number {
  const len = img.data?.length ?? 0;
  const px = (img.width ?? 0) * (img.height ?? 0);
  if (px <= 0) return 2;
  if (len >= px * 4) return 3;
  if (len >= px * 3) return 2;
  return 1;
}

export async function extractPagesForConvert(
  bytes: Uint8Array,
): Promise<{ pages: PageInput[]; figures: ExtractedFigure[] }> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const doc = await loadingTask.promise;
  const pages: PageInput[] = [];
  const figures: ExtractedFigure[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const view = page.view;
      const content = await page.getTextContent();
      // getOperatorList also populates commonObjs, which holds the real face
      // names ("ABCDEF+Times-Bold") behind the internal ids getTextContent uses.
      let ops: Awaited<ReturnType<typeof page.getOperatorList>> | null = null;
      try {
        ops = await page.getOperatorList();
      } catch {
        ops = null;
      }
      const faceNames = new Map<string, string>();
      const faceOf = (id: string): string => {
        const cached = faceNames.get(id);
        if (cached) return cached;
        let name = id;
        try {
          // biome-ignore lint/suspicious/noExplicitAny: pdf.js font objects are untyped
          const font = page.commonObjs.has(id) ? (page.commonObjs.get(id) as any) : null;
          if (font?.name) name = String(font.name);
        } catch {
          // keep the internal id; style detection degrades gracefully
        }
        faceNames.set(id, name);
        return name;
      };
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
          fontName: faceOf(raw.fontName),
          fontSize: Math.hypot(t[2], t[3]) || Math.abs(t[3]) || raw.height,
        });
      }
      const figureNames: string[] = [];
      try {
        if (!ops) throw new Error("no operator list");
        // biome-ignore lint/suspicious/noExplicitAny: pdf.js image objects are untyped
        const resolveObj = (objName: string): Promise<any> =>
          new Promise((resolve) => {
            try {
              // Shared XObjects land in commonObjs, page-local ones in objs.
              if (page.commonObjs.has(objName)) {
                page.commonObjs.get(objName, resolve);
              } else {
                page.objs.get(objName, resolve);
              }
            } catch {
              resolve(null);
            }
          });
        let n = 0;
        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i];
          const isRef = fn === pdfjsLib.OPS.paintImageXObject;
          const isInline = fn === pdfjsLib.OPS.paintInlineImageXObject;
          if (!isRef && !isInline) continue;
          try {
            const img = isRef ? await resolveObj(ops.argsArray[i][0] as string) : ops.argsArray[i][0];
            if (!img || (!img.data && !img.bitmap)) continue;
            if (img.width < MIN_FIGURE_PX || img.height < MIN_FIGURE_PX) continue;
            const pngDataUrl = img.bitmap
              ? bitmapToPngDataUrl(img.bitmap, img.width, img.height)
              : rgbaToPngDataUrl(
                  rawToRgba(img.data, img.width, img.height, img.kind ?? guessKind(img)),
                  img.width,
                  img.height,
                );
            n++;
            const name = `figure_p${p}_${n}.png`;
            figures.push({ name, page: p, pngDataUrl });
            figureNames.push(name);
          } catch {
            // one broken image must not sink the rest of the page
          }
        }
      } catch {
        // operator list failures must not sink text conversion
      }
      pages.push({ width: view[2] - view[0], height: view[3] - view[1], items, figureNames });
    }
  } finally {
    await loadingTask.destroy();
  }
  return { pages, figures };
}
