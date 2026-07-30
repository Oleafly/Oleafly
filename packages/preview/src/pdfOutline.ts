import type * as pdfjsLib from "pdfjs-dist";
import { safePdfExternalUrl } from "./pdfSecurity";

type RawOutline = NonNullable<
  Awaited<ReturnType<pdfjsLib.PDFDocumentProxy["getOutline"]>>
>;
type RawOutlineItem = RawOutline[number];

export interface PdfOutlineItem {
  id: string;
  title: string;
  children: PdfOutlineItem[];
  external: boolean;
  disabledReason?: string;
}

export interface PdfOutlineTarget {
  destination: string | unknown[] | null;
  externalUrl: string | null;
}

export interface NormalizedPdfOutline {
  items: PdfOutlineItem[];
  targets: Map<string, PdfOutlineTarget>;
}

function normalizeItems(
  input: RawOutline,
  path: number[],
  targets: Map<string, PdfOutlineTarget>,
): PdfOutlineItem[] {
  return input.map((item: RawOutlineItem, index) => {
    const itemPath = [...path, index];
    const id = `pdf-outline-${itemPath.join("-")}`;
    const rawUrl = typeof item.url === "string" ? item.url : null;
    const externalUrl = rawUrl ? safePdfExternalUrl(rawUrl) : null;
    const destination =
      typeof item.dest === "string" || Array.isArray(item.dest)
        ? item.dest
        : null;
    const disabledReason =
      rawUrl && !externalUrl
        ? "This link uses a blocked URL scheme."
        : !externalUrl && !destination
          ? "This outline item has no destination."
          : undefined;
    targets.set(id, { destination, externalUrl });
    return {
      id,
      title: item.title?.trim() || "Untitled section",
      children: normalizeItems(item.items ?? [], itemPath, targets),
      external: externalUrl !== null,
      ...(disabledReason ? { disabledReason } : {}),
    };
  });
}

export function normalizePdfOutline(
  outline: RawOutline | null,
): NormalizedPdfOutline {
  const targets = new Map<string, PdfOutlineTarget>();
  return {
    items: normalizeItems(outline ?? [], [], targets),
    targets,
  };
}
