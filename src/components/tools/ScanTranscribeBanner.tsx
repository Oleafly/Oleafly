// The PDF to LaTeX banner for a scanned PDF: what to do, the Tools model,
// where the pages go and the estimate for the chosen page range. Loaded
// lazily by PdfImportView, which the entry chunk carries.
import { useTranslation } from "react-i18next";
import { ScanEstimateText, ToolsModelNotice, ToolsModelPicker } from "@/components/tools/ToolsModelBar";
import { selectedPages, type PageSize } from "@/features/tools-ai/scan-estimate";

export function ScanTranscribeBanner({
  pages,
  range,
}: Readonly<{ pages: readonly PageSize[]; range?: readonly [number, number] }>) {
  const { t } = useTranslation(["library"]);
  const selected = selectedPages(pages.length, range)
    .map((page) => pages[page - 1])
    .filter((size): size is PageSize => size !== undefined);
  return (
    <div
      data-testid="scan-transcribe-banner"
      className="space-y-2 border-b px-4 py-2 text-xs text-muted-foreground"
    >
      <p>{t(($) => $.library.pdfImport.scannedLocal)}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ToolsModelPicker compact />
        <ToolsModelNotice scope="scans" />
      </div>
      <ScanEstimateText sizes={selected} />
    </div>
  );
}
