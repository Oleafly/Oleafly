// What a scanned-PDF transcription is doing, in words: shared by the
// converter page and the PDF import view. Small, so the import view (in the
// entry chunk) can use it without the converters.
import type { ConverterProgress } from "@/features/ad-hoc-converters";
import { i18n } from "@/i18n";

/** The page being read: its PDF page number, and its place in the run when
 * the two differ (a range such as 41-50 starts at page 41, 1 of 10). */
export function transcribingPageLabel(progress: ConverterProgress): string {
  const page = progress.page ?? 0;
  const total = progress.total ?? 0;
  const model = progress.model ?? "";
  if (progress.pdfPage !== undefined && progress.pdfPage !== page) {
    return i18n.t(($) => $.researchTools.converter.progressTranscribingPdfPage, {
      pdfPage: progress.pdfPage,
      page,
      total,
      model,
    });
  }
  return i18n.t(($) => $.researchTools.converter.progressTranscribingPage, { page, total, model });
}

/** The steps of a scan transcription; null for any other step. */
export function scanProgressLabel(progress: ConverterProgress): string | null {
  switch (progress.step) {
    case "readingPages":
      return i18n.t(($) => $.researchTools.converter.progressReadingPages);
    case "transcribingPage":
      return transcribingPageLabel(progress);
    case "uploadingPdf":
      return i18n.t(($) => $.researchTools.converterModel.progressUploading);
    case "formattingTranscription":
      return i18n.t(($) => $.researchTools.converterModel.progressFormatting);
    default:
      return null;
  }
}
