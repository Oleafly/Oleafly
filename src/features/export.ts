import {
  cancelCompile,
  downloadProjectZip,
  EXPORT_LOG_EVENT,
  exportDocument,
  exportPdf,
  revealInDir,
  exportProjectImage,
  uint8ToBase64,
  withEventListener,
  type ExportOutcome,
} from "@/lib/tauri";
import type { DocumentEngineDescriptor } from "@oleafly/backend-port";
import { decodeAppError, describeError } from "@/lib/app-error";
import { formatList } from "@/lib/intl";
import { isNotebookEngine } from "@/lib/notebook-engines";
import { pickSavePath } from "@/lib/native-file-dialog";
import { useFilesStore } from "@/store/files";
import { isCompileCheckpointCurrent, useCompileStore } from "@/store/compile";
import { usePdfViewStore } from "@/store/pdf-view";
import { useSettingsStore } from "@/store/settings";
import { notifyError, toast } from "@/lib/toast";
import { ensurePandoc } from "@/features/pandoc";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { i18n } from "@/i18n";
import { basename, exportFileStem } from "@/lib/path-utils";
import type { TypstExportRequest } from "@/lib/typst-options";
import { activeTypstVariant } from "@/store/typst-variant";
import { noteUnreviewedSuggestions } from "@/lib/collab-live-bridge";
import { askInApp } from "@/store/confirm-dialog";

export type DocumentExportFormat = "docx" | "html" | "md" | "pptx" | "epub" | "txt" | "typst" | "tex";

const EXPORT_TOAST_KEY = "export-result";
const EXPORT_STOPPED = "notebook.export_stopped";
const STEP_LENGTH = 120;
const SOURCE_FORMATS: ReadonlySet<string> = new Set(["tex", "typst", "md"]);

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

function assertProjectOpen(projectId: string): void {
  if (useFilesStore.getState().projectId !== projectId) {
    throw new Error(i18n.t(($) => $.core.export.projectChanged));
  }
}

type ExportResult = {
  notice: ExportNotice | undefined;
  warnings: string[];
};

type ConvertedExport = {
  projectId: string;
  mainDoc: string;
  format: DocumentExportFormat;
  destination: string;
  engine: Pick<DocumentEngineDescriptor, "id" | "typst_options">;
  showStep: (step: string) => void;
};

async function exportProjectArchive(projectId: string, destination: string): Promise<ExportResult> {
  const { skippedLinks } = await downloadProjectZip(projectId, destination);
  const notice: ExportNotice | undefined =
    skippedLinks > 0
      ? (names) => i18n.t(($) => $.core.export.savedWithoutLinks, { ...names, count: skippedLinks })
      : undefined;
  return { notice, warnings: [] };
}

async function exportConvertedDocument({
  projectId,
  mainDoc,
  format,
  destination,
  engine,
  showStep,
}: ConvertedExport): Promise<ExportResult> {
  const variant = activeTypstVariant(projectId, engine);
  const outcome = await withEventListener(EXPORT_LOG_EVENT, exportStepReader(showStep), () =>
    useSettingsStore.getState().offline
      ? exportDocument(projectId, mainDoc, format, destination, variant, true)
      : exportDocument(projectId, mainDoc, format, destination, variant),
  );
  const warnings = (outcome?.warnings ?? []).map(describeError);
  const sourceNotice: ExportNotice | undefined =
    SOURCE_FORMATS.has(format) && engine.id !== "typst"
      ? (names) => i18n.t(($) => $.core.export.savedSource, names)
      : undefined;
  return { notice: typstContentNotice(outcome) ?? sourceNotice, warnings };
}

export async function exportCurrentDocument(format: DocumentExportFormat | "zip"): Promise<void> {
  if (documentExportInFlight) return;
  const { projectId, projectName, engine } = useFilesStore.getState();
  if (!projectId) return;
  noteUnreviewedSuggestions(projectId, "export");
  const mainDoc = resolveEffectiveMainDoc().mainDoc;
  const extension = format === "typst" ? "typ" : format;
  const name = exportFileStem(projectName, "document");
  documentExportInFlight = true;
  let progress: number | undefined;
  try {
    const destination = await pickSavePath({
      defaultPath: `${name}.${extension}`,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!destination) return;
    assertProjectOpen(projectId);
    if (format !== "zip" && !(await ensurePandoc({ notify: true }))) return;
    assertProjectOpen(projectId);
    await useFilesStore.getState().flushForQuit();
    assertProjectOpen(projectId);
    const stoppable = format !== "zip" && isNotebookEngine(engine);
    const toastId = toast.infoUnique(
      EXPORT_TOAST_KEY,
      i18n.t(($) => $.shell.toolbar.exporting, { format: extension }),
      stoppable ? { label: i18n.t(($) => $.shell.toolbar.stopExport), onClick: stopExport } : undefined,
      true,
    );
    progress = toastId;
    const showStep = (step: string) =>
      toast.update(toastId, i18n.t(($) => $.shell.toolbar.exportingStep, { format: extension, step }));
    const { notice, warnings } =
      format === "zip"
        ? await exportProjectArchive(projectId, destination)
        : await exportConvertedDocument({ projectId, mainDoc, format, destination, engine, showStep });
    exportResultToast(extension.toUpperCase(), destination, notice, warnings);
    progress = undefined;
  } catch (error) {
    exportFailed(error);
  } finally {
    if (progress !== undefined) toast.dismiss(progress);
    documentExportInFlight = false;
  }
}

function errorDetail(e: unknown): string {
  if (decodeAppError(e)) return describeError(e);
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "";
}

function revealExportedFile(dest: string): void {
  void revealInDir(dest).catch(() => {
    toast.info(i18n.t(($) => $.core.export.revealFailed));
  });
}

type SavedNames = {
  kind: string;
  fileName: string;
};

type ExportNotice = (names: SavedNames) => string;

async function showExportWarnings(warnings: readonly string[], dest: string): Promise<void> {
  const reveal = await askInApp({
    title: i18n.t(($) => $.core.export.warningsTitle),
    message: warnings.join("\n"),
    confirmLabel: i18n.t(($) => $.core.export.showInFolder),
    cancelLabel: i18n.t(($) => $.common.actions.close),
  });
  if (reveal) revealExportedFile(dest);
}

function exportResultToast(
  kind: string,
  dest: string,
  notice?: ExportNotice,
  warnings: readonly string[] = [],
): void {
  const names = { kind, fileName: basename(dest) || kind.toLowerCase() };
  const action = {
    label: i18n.t(($) => $.core.export.showInFolder),
    onClick: () => revealExportedFile(dest),
  };
  if (warnings.length > 0) {
    toast.infoUnique(
      EXPORT_TOAST_KEY,
      i18n.t(($) => $.core.export.savedWithWarnings, { ...names, count: warnings.length }),
      {
        label: i18n.t(($) => $.core.export.showWarnings),
        onClick: () => void showExportWarnings(warnings, dest),
      },
      true,
    );
  } else if (notice) toast.infoUnique(EXPORT_TOAST_KEY, notice(names), action, true);
  else toast.successUnique(EXPORT_TOAST_KEY, i18n.t(($) => $.core.export.saved, names), action, true);
}

function typstContentNotice(notes: Partial<ExportOutcome> | undefined): ExportNotice | undefined {
  const sourceVersion = notes?.readFromSource;
  if (sourceVersion) {
    return (names) => i18n.t(($) => $.core.export.savedFromSource, { ...names, version: sourceVersion });
  }
  const version = notes?.outdatedTypst;
  if (version) return (names) => i18n.t(($) => $.core.export.savedWithoutEquations, { ...names, version });
  const skipped = notes?.skipped ?? [];
  if (skipped.length === 0) return undefined;
  const elements = formatList(skipped);
  return (names) => i18n.t(($) => $.core.export.savedWithoutContent, { ...names, elements });
}

function compiledOutputNotice(): ExportNotice | undefined {
  const { status, lastCompileCheckpoint } = useCompileStore.getState();
  if (status === "error" || status === "unavailable") {
    return (names) => i18n.t(($) => $.core.export.savedAfterFailedCompile, names);
  }
  if (isCompileCheckpointCurrent(lastCompileCheckpoint)) return undefined;
  return (names) => i18n.t(($) => $.core.export.savedStale, names);
}

function compiledPdfMatchesPreview(): boolean {
  const { status, lastCompileCheckpoint: checkpoint } = useCompileStore.getState();
  if (status !== "success" || checkpoint === null) return false;
  const mainDoc = useFilesStore.getState().mainDoc || "main.tex";
  return checkpoint.mainDocument === mainDoc && isCompileCheckpointCurrent(checkpoint);
}

export async function exportCurrentPdf(): Promise<void> {
  const { projectId, projectName } = useFilesStore.getState();
  if (!projectId) return;
  if (!useCompileStore.getState().pdfBytes) {
    toast.info(i18n.t(($) => $.shell.toolbar.compilePdfFirst));
    return;
  }
  const name = exportFileStem(projectName, "document");
  if (documentExportInFlight) return;
  noteUnreviewedSuggestions(projectId, "export");
  documentExportInFlight = true;
  try {
    const dest = await pickSavePath({
      defaultPath: `${name}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!dest) return;
    assertProjectOpen(projectId);
    const { pdfBytes } = useCompileStore.getState();
    if (!pdfBytes) return;
    const notice = compiledOutputNotice();
    await exportPdf(projectId, dest, compiledPdfMatchesPreview() ? undefined : uint8ToBase64(pdfBytes));
    exportResultToast("PDF", dest, notice);
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

async function renderExportedPage(bytes: Uint8Array, page: number, scale: number): Promise<string> {
  const { pdfPageToPng } = await import("@/lib/pdf-image");
  try {
    return await pdfPageToPng(bytes, page, scale);
  } catch (error) {
    if (page === 1) throw error;
    return pdfPageToPng(bytes, 1, scale);
  }
}

export async function exportCurrentImagePng(scale = 3): Promise<void> {
  const { projectId, projectName } = useFilesStore.getState();
  if (!projectId || !useCompileStore.getState().pdfBytes || documentExportInFlight) return;
  noteUnreviewedSuggestions(projectId, "export");
  const name = exportFileStem(projectName, "figure");
  documentExportInFlight = true;
  try {
    const dest = await pickSavePath({
      defaultPath: `${name}.png`,
      filters: [
        { name: i18n.t(($) => $.core.dialog.filters.pngImage), extensions: ["png"] },
      ],
    });
    if (!dest) return;
    assertProjectOpen(projectId);
    const { pdfBytes } = useCompileStore.getState();
    if (!pdfBytes) return;
    const notice = compiledOutputNotice();
    const dataUrl = await renderExportedPage(pdfBytes, usePdfViewStore.getState().page, scale);
    assertProjectOpen(projectId);
    await exportProjectImage(projectId, dest, dataUrl.slice(dataUrl.indexOf(",") + 1));
    exportResultToast("PNG", dest, notice);
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
  const name = exportFileStem(projectName, "document");
  documentExportInFlight = true;
  let progress: number | undefined;
  try {
    const destination = await pickSavePath({
      defaultPath: `${name}.${extension}`,
      filters: [{ name: kind, extensions: [extension] }],
    });
    if (!destination) return;
    assertProjectOpen(projectId);
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
      {
        ...request,
        variant: activeTypstVariant(projectId, engine),
        ...(useSettingsStore.getState().offline ? { offline: true } : {}),
      },
      destination,
    );
    exportResultToast(kind, result.files[0] ?? destination, typstContentNotice(result));
    progress = undefined;
  } catch (error) {
    notifyError("export with Typst", error);
  } finally {
    if (progress !== undefined) toast.dismiss(progress);
    documentExportInFlight = false;
  }
}
