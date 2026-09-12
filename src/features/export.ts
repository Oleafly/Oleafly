import { downloadProjectZip, exportDocument, exportPdf, revealInDir, exportProjectImage } from "@/lib/tauri";
import { pickSavePath } from "@/lib/native-file-dialog";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { notifyError, toast } from "@/lib/toast";
import { ensurePandoc } from "@/features/pandoc";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { i18n } from "@/i18n";

export type DocumentExportFormat = "docx" | "html" | "md" | "pptx" | "epub" | "txt" | "typst" | "tex";

let documentExportInFlight = false;

export async function exportCurrentDocument(format: DocumentExportFormat | "zip"): Promise<void> {
  if (documentExportInFlight) return;
  const { projectId, projectName } = useFilesStore.getState();
  if (!projectId) return;
  const mainDoc = resolveEffectiveMainDoc().mainDoc;
  const extension = format === "typst" ? "typ" : format;
  const name = (projectName || "document").replace(/[^\w.-]+/g, "_");
  documentExportInFlight = true;
  let progress: number | undefined;
  try {
    const destination = await pickSavePath({
      defaultPath: `${name}.${extension}`,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!destination) return;
    const assertProject = () => {
      if (useFilesStore.getState().projectId !== projectId) {
        throw new Error("The open project changed. Start the export again from the project you want to save.");
      }
    };
    assertProject();
    if (format !== "zip" && !(await ensurePandoc())) return;
    assertProject();
    await useFilesStore.getState().flushForQuit();
    assertProject();
    progress = toast.info(`Exporting ${extension.toUpperCase()}…`, undefined, true);
    if (format === "zip") await downloadProjectZip(projectId, destination);
    else await exportDocument(projectId, mainDoc, format, destination);
    exportSuccessToast(extension.toUpperCase(), destination);
  } catch (error) {
    notifyError("export document", error);
  } finally {
    if (progress !== undefined) toast.dismiss(progress);
    documentExportInFlight = false;
  }
}

function errorDetail(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "";
}

/** Show in Finder/Explorer; never flip a successful save into a failure toast. */
function revealExportedFile(dest: string): void {
  void revealInDir(dest).catch(() => {
    toast.info(i18n.t(($) => $.core.export.revealFailed));
  });
}

function exportSuccessToast(kind: string, dest: string): void {
  const fileName = dest.split(/[/\\]/).pop() || kind.toLowerCase();
  toast.success(
    i18n.t(($) => $.core.export.saved, { kind, fileName }),
    {
      label: i18n.t(($) => $.core.export.showInFolder),
      onClick: () => revealExportedFile(dest),
    },
    true,
  );
}

export async function exportCurrentPdf(): Promise<void> {
  const { projectId, projectName } = useFilesStore.getState();
  const { pdfBytes } = useCompileStore.getState();
  if (!projectId || !pdfBytes) return;
  const name = (projectName || "document").replace(/[^\w.-]+/g, "_");
  if (documentExportInFlight) return;
  documentExportInFlight = true;
  try {
    const dest = await pickSavePath({
      defaultPath: `${name}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!dest) return;
    if (useFilesStore.getState().projectId !== projectId) {
      throw new Error("The open project changed. Start the export again from the project you want to save.");
    }
    await exportPdf(projectId, dest);
    // Destination path is known and the file was published — always success.
    exportSuccessToast("PDF", dest);
  } catch (e) {
    const detail = errorDetail(e);
    notifyError(
      "export pdf",
      e,
      detail
        ? i18n.t(($) => $.core.export.pdfFailedDetail, { detail })
        : i18n.t(($) => $.core.export.pdfFailed),
    );
  } finally {
    documentExportInFlight = false;
  }
}

// For image projects, where the output is an image rather than a document.
export async function exportCurrentImagePng(scale = 3): Promise<void> {
  const { projectId, projectName } = useFilesStore.getState();
  const { pdfBytes } = useCompileStore.getState();
  if (!projectId || !pdfBytes || documentExportInFlight) return;
  const name = (projectName || "figure").replace(/[^\w.-]+/g, "_");
  documentExportInFlight = true;
  try {
    const dest = await pickSavePath({
      defaultPath: `${name}.png`,
      filters: [
        { name: i18n.t(($) => $.core.dialog.filters.pngImage), extensions: ["png"] },
      ],
    });
    if (!dest) return;
    const assertProject = () => {
      if (useFilesStore.getState().projectId !== projectId) {
        throw new Error("The open project changed. Start the export again from the project you want to save.");
      }
    };
    assertProject();
    const { pdfPageToPng } = await import("@/lib/pdf-image");
    const dataUrl = await pdfPageToPng(pdfBytes, 1, scale);
    assertProject();
    await exportProjectImage(projectId, dest, dataUrl.slice(dataUrl.indexOf(",") + 1));
    exportSuccessToast("PNG", dest);
  } catch (e) {
    const detail = errorDetail(e);
    notifyError(
      "export png",
      e,
      detail
        ? i18n.t(($) => $.core.export.pngFailedDetail, { detail })
        : i18n.t(($) => $.core.export.pngFailed),
    );
  } finally {
    documentExportInFlight = false;
  }
}
