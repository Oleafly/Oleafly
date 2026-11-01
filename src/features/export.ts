import {
  cancelCompile,
  downloadProjectZip,
  EXPORT_LOG_EVENT,
  exportDocument,
  exportPdf,
  revealInDir,
  exportProjectImage,
  withEventListener,
} from "@/lib/tauri";
import { decodeAppError, describeError } from "@/lib/app-error";
import { isNotebookEngine } from "@/lib/notebook-engines";
import { pickSavePath } from "@/lib/native-file-dialog";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { notifyError, toast } from "@/lib/toast";
import { ensurePandoc } from "@/features/pandoc";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { i18n } from "@/i18n";
import { basename } from "@/lib/path-utils";
import type { TypstExportRequest } from "@/lib/typst-options";
import { activeTypstVariant } from "@/store/typst-variant";
import { noteUnreviewedSuggestions } from "@/lib/collab-live-bridge";

export type DocumentExportFormat = "docx" | "html" | "md" | "pptx" | "epub" | "txt" | "typst" | "tex";

const EXPORT_TOAST_KEY = "export-result";
const EXPORT_STOPPED = "notebook.export_stopped";
const STEP_LENGTH = 120;

let documentExportInFlight = false;

function exportStepReader(onStep: (step: string) => void): (chunk: string) => void {
  let partial = "";
  return (chunk) => {
    const lines = `${partial}${chunk}`.split(/\r\n|\n|\r/);
    partial = (lines.pop() ?? "").slice(-STEP_LENGTH * 4);
    for (let index = lines.length - 1; index >= 0; index--) {
      const step = lines[index].trim();
      if (!step) continue;
      onStep(step.length > STEP_LENGTH ? `${step.slice(0, STEP_LENGTH - 1)}…` : step);
      return;
    }
  };
}

function stopExport(): void {
  void cancelCompile().catch((error: unknown) => notifyError("stop export", error));
}

function exportFailed(error: unknown): void {
  if (decodeAppError(error)?.code === EXPORT_STOPPED) toast.info(describeError(error));
  else notifyError("export document", error);
}

export async function exportCurrentDocument(format: DocumentExportFormat | "zip"): Promise<void> {
  if (documentExportInFlight) return;
  const { projectId, projectName, engine } = useFilesStore.getState();
  if (!projectId) return;
  noteUnreviewedSuggestions(projectId, "export");
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
    if (format !== "zip" && !(await ensurePandoc({ notify: true }))) return;
    assertProject();
    await useFilesStore.getState().flushForQuit();
    assertProject();
    const stoppable = format !== "zip" && isNotebookEngine(engine);
    const toastId = toast.infoUnique(
      EXPORT_TOAST_KEY,
      i18n.t(($) => $.shell.toolbar.exporting, { format: extension }),
      stoppable ? { label: i18n.t(($) => $.shell.toolbar.stopExport), onClick: stopExport } : undefined,
      true,
    );
    progress = toastId;
    if (format === "zip") await downloadProjectZip(projectId, destination);
    else {
      const showStep = (step: string) =>
        toast.update(toastId, i18n.t(($) => $.shell.toolbar.exportingStep, { format: extension, step }));
      await withEventListener(EXPORT_LOG_EVENT, exportStepReader(showStep), () =>
        exportDocument(projectId, mainDoc, format, destination, activeTypstVariant(projectId, engine)),
      );
    }
    exportSuccessToast(extension.toUpperCase(), destination);
    progress = undefined;
  } catch (error) {
    exportFailed(error);
  } finally {
    if (progress !== undefined) toast.dismiss(progress);
    documentExportInFlight = false;
  }
}

function errorDetail(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "";
}

function revealExportedFile(dest: string): void {
  void revealInDir(dest).catch(() => {
    toast.info(i18n.t(($) => $.core.export.revealFailed));
  });
}

function exportSuccessToast(kind: string, dest: string): void {
  const fileName = basename(dest) || kind.toLowerCase();
  toast.successUnique(
    EXPORT_TOAST_KEY,
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
  noteUnreviewedSuggestions(projectId, "export");
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

export async function exportCurrentImagePng(scale = 3): Promise<void> {
  const { projectId, projectName } = useFilesStore.getState();
  const { pdfBytes } = useCompileStore.getState();
  if (!projectId || !pdfBytes || documentExportInFlight) return;
  noteUnreviewedSuggestions(projectId, "export");
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

export async function exportCurrentTypst(request: TypstExportRequest): Promise<void> {
  if (documentExportInFlight) return;
  const { projectId, projectName, engine } = useFilesStore.getState();
  if (!projectId || engine.id !== "typst") return;
  const mainDoc = resolveEffectiveMainDoc().mainDoc;
  const extension = request.format;
  const kind = extension.toUpperCase();
  const name = (projectName || "document").replace(/[^\w.-]+/g, "_");
  documentExportInFlight = true;
  let progress: number | undefined;
  try {
    const destination = await pickSavePath({
      defaultPath: `${name}.${extension}`,
      filters: [{ name: kind, extensions: [extension] }],
    });
    if (!destination) return;
    if (useFilesStore.getState().projectId !== projectId) {
      throw new Error("The open project changed. Start the export again from the project you want to save.");
    }
    await useFilesStore.getState().flushForQuit();
    progress = toast.infoUnique(
      EXPORT_TOAST_KEY,
      i18n.t(($) => $.shell.toolbar.exporting, { format: extension }),
      undefined,
      true,
    );
    const { exportTypstDocument } = await import("@/lib/typst-options");
    const result = await exportTypstDocument(
      projectId,
      mainDoc,
      { ...request, variant: activeTypstVariant(projectId, engine) },
      destination,
    );
    exportSuccessToast(kind, result.files[0] ?? destination);
    progress = undefined;
  } catch (error) {
    notifyError("export with Typst", error);
  } finally {
    if (progress !== undefined) toast.dismiss(progress);
    documentExportInFlight = false;
  }
}
