import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "@oleafly/preview/pdf.worker?worker&url";
import { reconstructPdfPageText } from "./pdf-text";
import type { PdfExtractionStatus, PositionedText } from "./types";
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
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  try {
    const doc = await loadingTask.promise;

    const pages: PositionedText[][] = [];
    const pageText: string[] = [];
    const structRoots: StructNode[] = [];
    const structureFailedPages: number[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      try {
        const tc = await page.getTextContent();
        const reconstructed = reconstructPdfPageText(tc.items);
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

    return { pages, pageText, lang, title, tagged, struct, extraction };
  } finally {
    try {
      await loadingTask.destroy();
    } catch {
    }
  }
}
