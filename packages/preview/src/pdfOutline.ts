import type * as pdfjsLib from "pdfjs-dist";
import type { PreviewTranslator } from "./messages";
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
  t: PreviewTranslator,
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
    const noDestination = !externalUrl && !destination ? t("outline.noDestination") : undefined;
    const disabledReason = rawUrl && !externalUrl ? t("outline.blockedScheme") : noDestination;
    targets.set(id, { destination, externalUrl });
    return {
      id,
      title: item.title?.trim() || t("outline.untitled"),
      children: normalizeItems(item.items ?? [], itemPath, targets, t),
      external: externalUrl !== null,
      ...(disabledReason ? { disabledReason } : {}),
    };
  });
}

export function normalizePdfOutline(
  outline: RawOutline | null,
  t: PreviewTranslator,
): NormalizedPdfOutline {
  const targets = new Map<string, PdfOutlineTarget>();
  return {
    items: normalizeItems(outline ?? [], [], targets, t),
    targets,
  };
}
