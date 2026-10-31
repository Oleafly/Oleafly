import "@oleafly/preview/polyfills";
import * as pdfjsLib from "pdfjs-dist";
import { pdfDocumentOptions } from "@oleafly/preview/pdfDocumentOptions";
import "@oleafly/preview/pdfWorkerRuntime";
import { bitmapToPngDataUrl, rawToRgba, rgbaToPngDataUrl } from "./figure-decode";
import type { ExtractedFigure, PageInput, TextItem } from "./types";

const MIN_FIGURE_PX = 32;

/** Infer the pixel layout when pdf.js omits `kind` (e.g. decoded JPEGs). */
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
  return (objName: string): Promise<any> =>
    new Promise((resolve) => {
      try {
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

export interface ExtractOptions {
  pageRange?: readonly [number, number];
  figures?: boolean | "if-text";
  signal?: AbortSignal;
}

export interface ExtractedPdf {
  pages: PageInput[];
  figures: ExtractedFigure[];
  pageCount: number;
}

export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const loadingTask = pdfjsLib.getDocument(pdfDocumentOptions({ data: bytes.slice() }));
  try {
    return (await loadingTask.promise).numPages;
  } finally {
    await loadingTask.destroy();
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function hasText(content: PdfTextContent): boolean {
  return content.items.some((raw) => "str" in raw && Boolean(raw.str));
}

export async function extractPagesForConvert(
  bytes: Uint8Array,
  options: ExtractOptions = {},
): Promise<ExtractedPdf> {
  throwIfAborted(options.signal);
  const loadingTask = pdfjsLib.getDocument(pdfDocumentOptions({ data: bytes.slice() }));
  const pages: PageInput[] = [];
  const figures: ExtractedFigure[] = [];
  let pageCount = 0;
  try {
    const doc = await loadingTask.promise;
    pageCount = doc.numPages;
    const first = Math.max(1, Math.floor(options.pageRange?.[0] ?? 1));
    const last = Math.min(pageCount, Math.floor(options.pageRange?.[1] ?? pageCount));
    const read: { number: number; page: PdfPage; content: PdfTextContent }[] = [];
    for (let p = first; p <= last; p++) {
      throwIfAborted(options.signal);
      const page = await doc.getPage(p);
      read.push({ number: p, page, content: await page.getTextContent() });
    }
    const wanted = options.figures ?? true;
    const decodeFigures = wanted === "if-text" ? read.some(({ content }) => hasText(content)) : wanted;
    for (const { number, page, content } of read) {
      throwIfAborted(options.signal);
      const view = page.view;
      const size = { width: view[2] - view[0], height: view[3] - view[1] };
      if (!decodeFigures && !hasText(content)) {
        pages.push({ ...size, items: [], figureNames: [] });
        continue;
      }
      let ops: PdfOperatorList | null = null;
      try {
        ops = await page.getOperatorList();
      } catch {
        ops = null;
      }
      const items = readTextItems(content, makeFaceResolver(page));
      const figureNames = decodeFigures ? await extractPageFigures(page, ops, number, figures) : [];
      pages.push({ ...size, items, figureNames });
    }
  } finally {
    await loadingTask.destroy();
  }
  return { pages, figures, pageCount };
}
