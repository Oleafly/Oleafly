import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "@oleafly/preview/pdf.worker?worker&url";
import { reconstructPdfPageText } from "./pdf-text";
import type { PdfExtractionStatus, PdfFacts, PositionedText } from "./types";
import type { StructNode, StructDoc } from "./structure";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfExtract {
  pages: PositionedText[][];
  pageText: string[];
  lang: string | null;
  title: string | null;
  tagged: boolean | null;
  struct: StructDoc;
  extraction: PdfExtractionStatus;
  facts: PdfFacts;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringProperty(value: unknown, key: string): string | null {
  const candidate = recordOf(value)?.[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function normStruct(node: unknown): StructNode | null {
  if (!node || typeof node !== "object") return null;
  const record = recordOf(node);
  if (!record) return null;
  // Marked-content / object leaf refs carry no structural role; skip them.
  if (typeof record.type === "string") return null;
  const children = Array.isArray(record.children)
    ? record.children.map(normStruct).filter((child): child is StructNode => child !== null)
    : [];
  return {
    role: typeof record.role === "string" ? record.role : "",
    alt: typeof record.alt === "string" ? record.alt : null,
    lang: typeof record.lang === "string" ? record.lang : null,
    children,
  };
}

export async function extractForPreflight(bytes: Uint8Array): Promise<PdfExtract> {
  const header = new TextDecoder("ascii").decode(bytes.slice(0, 16));
  const version = /%PDF-(\d+\.\d+)/.exec(header)?.[1] ?? null;
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  try {
    const doc = await loadingTask.promise;

    const pages: PositionedText[][] = [];
    const pageText: string[] = [];
    const structRoots: StructNode[] = [];
    const structureFailedPages: number[] = [];
    const pageFacts: PdfFacts["pages"] = [];
    let linkCount = 0;
    let formFieldCount = 0;
    const fontFacts = new Map<string, boolean | null>();
    const inspectedFontIds = new Set<string>();
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      try {
        const [tc, annotations] = await Promise.all([
          page.getTextContent(),
          page.getAnnotations({ intent: "display" }),
        ]);
        const viewport = page.getViewport({ scale: 1 });
        pageFacts.push({ width: viewport.width, height: viewport.height, rotation: viewport.rotation });
        for (const annotation of annotations) {
          if (annotation.subtype === "Link") linkCount++;
          if (annotation.subtype === "Widget") formFieldCount++;
        }
        const reconstructed = reconstructPdfPageText(tc.items);
        for (const item of tc.items) {
          if (!("str" in item) || inspectedFontIds.has(item.fontName)) continue;
          inspectedFontIds.add(item.fontName);
          let embedded: boolean | null = null;
          let name = item.fontName;
          try {
            const font = page.commonObjs.get(item.fontName) as {
              name?: unknown;
              data?: unknown;
              missingFile?: unknown;
            };
            if (typeof font.name === "string" && font.name.trim()) name = font.name.trim();
            if (font.data instanceof Uint8Array || font.data instanceof ArrayBuffer) embedded = true;
            else if (font.missingFile === true) embedded = false;
          } catch {
          }
          fontFacts.set(name, embedded);
        }
        pages.push(reconstructed.items);
        pageText.push(reconstructed.text);

        try {
          const tree: unknown = await page.getStructTree();
          const norm = tree ? normStruct(tree) : null;
          if (norm) structRoots.push(norm);
        } catch {
          structureFailedPages.push(p);
        }
      } finally {
        try {
          page.cleanup();
        } catch {
        }
      }
    }

    let lang: string | null = null;
    let title: string | null = null;
    let marked: boolean | null = null;
    let author: string | null = null;
    let creator: string | null = null;
    let producer: string | null = null;
    let metadataStatus: PdfExtractionStatus["metadata"] = "ok";
    let markInfoStatus: PdfExtractionStatus["markInfo"] = "ok";
    try {
      const metadata = await doc.getMetadata();
      title =
        stringProperty(metadata.info, "Title") ??
        metadata.metadata?.get("dc:title")?.trim() ??
        null;
      lang =
        stringProperty(metadata.info, "Language") ??
        stringProperty(metadata.info, "Lang") ??
        metadata.metadata?.get("dc:language")?.trim() ??
        null;
      author = stringProperty(metadata.info, "Author") ?? metadata.metadata?.get("dc:creator")?.trim() ?? null;
      creator = stringProperty(metadata.info, "Creator");
      producer = stringProperty(metadata.info, "Producer");
    } catch {
      metadataStatus = "failed";
    }
    try {
      const markInfo = await doc.getMarkInfo();
      marked = markInfo?.Marked === true;
    } catch {
      markInfoStatus = "failed";
    }

    const structChildren = structRoots.flatMap((r) => r.children);
    const structureStatus: PdfExtractionStatus["structure"] =
      structureFailedPages.length > 0 ? "failed" : "ok";
    const tagged =
      structChildren.length > 0
        ? true
        : markInfoStatus === "ok"
          ? marked === true
          : structureStatus === "ok"
            ? false
            : null;
    const struct: StructDoc = {
      root: structChildren.length ? { role: "Document", alt: null, lang, children: structChildren } : null,
      tagged,
    };
    const extraction: PdfExtractionStatus = {
      metadata: metadataStatus,
      markInfo: markInfoStatus,
      structure: structureStatus,
      structureFailedPages,
    };

    let outlineCount = 0;
    try {
      const outline = await doc.getOutline();
      const count = (items: NonNullable<typeof outline>): number =>
        items.reduce((total, item) => total + 1 + count(item.items), 0);
      outlineCount = outline ? count(outline) : 0;
    } catch {
    }
    let attachmentCount = 0;
    try {
      attachmentCount = Object.keys((await doc.getAttachments()) ?? {}).length;
    } catch {
    }
    let restricted: boolean | null = null;
    try {
      restricted = (await doc.getPermissions()) !== null;
    } catch {
    }
    const facts: PdfFacts = {
      version,
      pageCount: doc.numPages,
      pages: pageFacts,
      outlineCount,
      linkCount,
      attachmentCount,
      formFieldCount,
      restricted,
      author,
      creator,
      producer,
      fonts: [...fontFacts].map(([name, embedded]) => ({ name, embedded })),
    };

    return { pages, pageText, lang, title, tagged, struct, extraction, facts };
  } finally {
    try {
      await loadingTask.destroy();
    } catch {
    }
  }
}
