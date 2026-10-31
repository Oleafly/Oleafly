import type { AttachmentKind } from "@/components/ai/composer/types";
import type { ATTACHMENT_LIMITS } from "@/lib/attachments-intake";
import { AttachmentError } from "@/lib/attachments-intake";
import { base64ToBytes } from "@/lib/base64";
import { normalizeImage } from "@/lib/image-normalize";

export interface NormalizedAttachment {
  name: string;
  mime: string;
  bytes: Uint8Array;
  pages?: number;
  text?: string;
  thumbnailUrl?: string;
  pageImages?: { mime: string; bytes: Uint8Array }[];
}

const SCANNED_CHARS_PER_PAGE = 20;

export function pdfTextForModel(pages: readonly string[], totalPages: number, limit: number): string {
  const body = pages.map((text, index) => `[Page ${index + 1}]\n${text}`).join("\n\n");
  if (totalPages <= limit) return body;
  return `${body}\n\n[Only the first ${limit} of ${totalPages} pages are included.]`;
}

export function isScannedPdf(pages: readonly string[]): boolean {
  if (pages.length === 0) return true;
  const characters = pages.reduce((total, text) => total + text.replace(/\s+/g, "").length, 0);
  return characters / pages.length < SCANNED_CHARS_PER_PAGE;
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  return base64ToBytes(dataUrl.slice(dataUrl.indexOf(",") + 1));
}

async function normalizePdf(
  file: File,
  limits: typeof ATTACHMENT_LIMITS,
): Promise<NormalizedAttachment> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new AttachmentError("readFailed");
  }
  let extracted: { pages: string[]; numPages: number };
  try {
    const { extractPdfText } = await import("@/lib/pdf-text");
    extracted = await extractPdfText(bytes, { maxPages: limits.pdfPages });
  } catch {
    throw new AttachmentError("unreadablePdf");
  }
  const { pdfPageToPng } = await import("@/lib/pdf-image");
  const thumbnailUrl = await pdfPageToPng(bytes, 1, 0.2, "#ffffff", {
    overallTimeoutMs: 15_000,
  }).catch(() => undefined);
  const result: NormalizedAttachment = {
    name: file.name,
    mime: "application/pdf",
    bytes,
    pages: extracted.numPages,
    thumbnailUrl,
  };
  if (!isScannedPdf(extracted.pages)) {
    result.text = pdfTextForModel(extracted.pages, extracted.numPages, limits.pdfPages);
    return result;
  }
  const pageImages: { mime: string; bytes: Uint8Array }[] = [];
  const count = Math.min(limits.scannedPageImages, extracted.numPages);
  for (let page = 1; page <= count; page += 1) {
    try {
      const png = await pdfPageToPng(bytes, page, 1.5, "#ffffff", { overallTimeoutMs: 20_000 });
      pageImages.push({ mime: "image/png", bytes: dataUrlBytes(png) });
    } catch {
      break;
    }
  }
  if (pageImages.length > 0) result.pageImages = pageImages;
  return result;
}

async function normalizeText(file: File): Promise<NormalizedAttachment> {
  try {
    return {
      name: file.name,
      mime: file.type.startsWith("text/") ? file.type : "text/plain",
      bytes: new Uint8Array(await file.arrayBuffer()),
    };
  } catch {
    throw new AttachmentError("readFailed");
  }
}

export async function normalizeAttachment(
  file: File,
  kind: AttachmentKind,
  limits: typeof ATTACHMENT_LIMITS,
): Promise<NormalizedAttachment> {
  if (kind === "pdf") return normalizePdf(file, limits);
  if (kind === "text") return normalizeText(file);
  const image = await normalizeImage(file, { maxEdge: limits.imageMaxEdge, thumbEdge: limits.thumbEdge });
  return {
    name: file.name,
    mime: image.mime,
    bytes: image.bytes,
    thumbnailUrl: image.thumbnailUrl,
  };
}
