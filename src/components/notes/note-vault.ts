import { i18n } from "@/i18n";
import { formatList } from "@/lib/intl";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import {
  notesExportFolder,
  notesImportCancel,
  notesImportFolder,
  revealInDir,
  type NotesExportSummary,
  type NotesImportOutcome,
  type NotesImportProgress,
  type NotesImportSummary,
} from "@/lib/tauri";

export type ImportStep =
  | { step: "options" }
  | { step: "running"; runId: string; progress: NotesImportProgress | null; stopping: boolean }
  | { step: "seen"; importedAt: number; notes: number }
  | { step: "large"; notes: number }
  | { step: "done"; summary: NotesImportSummary }
  | { step: "failed" };

export interface ImportChoice {
  folderTags: boolean;
  again: boolean;
  files?: boolean;
  confirmLarge?: boolean;
}

export function newRunId(): string {
  return crypto.randomUUID();
}

export function progressPercent(progress: NotesImportProgress | null): number {
  if (!progress || progress.total <= 0) return 0;
  const share = Math.min(1, progress.done / progress.total) / 2;
  return Math.round((progress.phase === "read" ? share : 0.5 + share) * 100);
}

export function stepAfter(outcome: NotesImportOutcome): ImportStep {
  if (outcome.kind === "dismissed") return { step: "options" };
  if (outcome.kind === "seen") return { step: "seen", importedAt: outcome.importedAt, notes: outcome.notes };
  if (outcome.kind === "large") return { step: "large", notes: outcome.notes };
  const { kind: _kind, ...summary } = outcome;
  return { step: "done", summary };
}

export function importFolder(
  runId: string,
  choice: ImportChoice,
  onProgress: (progress: NotesImportProgress) => void,
): Promise<NotesImportOutcome> {
  return notesImportFolder(
    {
      runId,
      folderTags: choice.folderTags,
      again: choice.again,
      files: choice.files === true,
      confirmLarge: choice.confirmLarge === true,
      title: choice.files
        ? i18n.t(($) => $.notes.vault.import.filesPickerTitle)
        : i18n.t(($) => $.notes.vault.import.pickerTitle),
    },
    onProgress,
  );
}

export function cancelImport(runId: string): Promise<boolean> {
  return notesImportCancel(runId);
}

export function exportFolder(note: { id: string; title: string } | null): Promise<NotesExportSummary | null> {
  return notesExportFolder({
    noteId: note?.id ?? null,
    folderName: note?.title ?? i18n.t(($) => $.notes.vault.import.export.folderName),
    title: i18n.t(($) => $.notes.vault.import.export.pickerTitle),
  });
}

export function announceExport(summary: NotesExportSummary): void {
  const done = i18n.t(($) => $.notes.vault.import.export.done, { count: summary.notes });
  const losses = [
    ...(summary.skipped > 0 ? [i18n.t(($) => $.notes.vault.import.export.skipped, { count: summary.skipped })] : []),
    ...(summary.paperLinks.length > 0 ? [i18n.t(($) => $.notes.vault.import.export.paperLinks, { count: summary.paperLinks.length })] : []),
  ];
  const message = losses.length > 0 ? i18n.t(($) => $.notes.vault.import.export.doneSkipped, { done, skipped: formatList(losses) }) : done;
  toast.success(message, {
    label: i18n.t(($) => $.notes.vault.import.export.showFolder),
    onClick: () => {
      void revealInDir(summary.folder).catch((error: unknown) => void logError("show the exported notes", error));
    },
  });
}
