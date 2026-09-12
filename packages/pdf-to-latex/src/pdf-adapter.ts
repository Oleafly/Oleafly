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

type PdfDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;
type PdfOperatorList = Awaited<ReturnType<PdfPage["getOperatorList"]>>;
type PdfTextContent = Awaited<ReturnType<PdfPage["getTextContent"]>>;

function makeFaceResolver(page: PdfPage): (id: string) => string {
  const faceNames = new Map<string, string>();
  return (id: string): string => {
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
}

function readTextItems(content: PdfTextContent, faceOf: (id: string) => string): TextItem[] {
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
  return items;
}

function makeObjectResolver(page: PdfPage): (objName: string) => Promise<any> {
  // biome-ignore lint/suspicious/noExplicitAny: pdf.js image objects are untyped
  return (objName: string): Promise<any> =>
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
}

function figurePngDataUrl(img: any): string {
  if (img.bitmap) return bitmapToPngDataUrl(img.bitmap, img.width, img.height);
  return rgbaToPngDataUrl(
    rawToRgba(img.data, img.width, img.height, img.kind ?? guessKind(img)),
    img.width,
    img.height,
  );
}

async function readFigureAt(
  ops: PdfOperatorList,
  i: number,
  resolveObj: (objName: string) => Promise<any>,
): Promise<string | null> {
  const fn = ops.fnArray[i];
  const isRef = fn === pdfjsLib.OPS.paintImageXObject;
  const isInline = fn === pdfjsLib.OPS.paintInlineImageXObject;
  if (!isRef && !isInline) return null;
  try {
    const img = isRef ? await resolveObj(ops.argsArray[i][0] as string) : ops.argsArray[i][0];
    if (!img || (!img.data && !img.bitmap)) return null;
    if (img.width < MIN_FIGURE_PX || img.height < MIN_FIGURE_PX) return null;
    return figurePngDataUrl(img);
  } catch {
    // one broken image must not sink the rest of the page
    return null;
  }
}

async function extractPageFigures(
  page: PdfPage,
  ops: PdfOperatorList | null,
  pageNumber: number,
  figures: ExtractedFigure[],
): Promise<string[]> {
  const figureNames: string[] = [];
  try {
    if (!ops) throw new Error("no operator list");
    const resolveObj = makeObjectResolver(page);
    let n = 0;
    for (let i = 0; i < ops.fnArray.length; i++) {
      const pngDataUrl = await readFigureAt(ops, i, resolveObj);
      if (pngDataUrl === null) continue;
      n++;
      const name = `figure_p${pageNumber}_${n}.png`;
      figures.push({ name, page: pageNumber, pngDataUrl });
      figureNames.push(name);
    }
  } catch {
    // operator list failures must not sink text conversion
  }
  return figureNames;
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
      let ops: PdfOperatorList | null = null;
      try {
        ops = await page.getOperatorList();
      } catch {
        ops = null;
      }
      const items = readTextItems(content, makeFaceResolver(page));
      const figureNames = await extractPageFigures(page, ops, p, figures);
      pages.push({ width: view[2] - view[0], height: view[3] - view[1], items, figureNames });
    }
  } finally {
    await loadingTask.destroy();
  }
  return { pages, figures };
}
