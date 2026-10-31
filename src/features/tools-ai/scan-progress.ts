import type { ConverterProgress } from "@/features/ad-hoc-converters";
import { i18n } from "@/i18n";

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
