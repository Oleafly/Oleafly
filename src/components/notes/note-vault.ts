import { i18n } from "@/i18n";
import {
  notesExportFolder,
  notesImportCancel,
  notesImportFolder,
  type NotesExportSummary,
  type NotesImportOutcome,
  type NotesImportProgress,
  type NotesImportSummary,
} from "@/lib/tauri";

export type ImportStep =
  | { step: "options" }
  | { step: "running"; runId: string; progress: NotesImportProgress | null; stopping: boolean }
  | { step: "seen"; importedAt: number; notes: number }
  | { step: "done"; summary: NotesImportSummary }
  | { step: "failed" };

export interface ImportChoice {
  folderTags: boolean;
  again: boolean;
  files?: boolean;
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
  const { notes, attachments, unresolved, skipped, cancelled, notCopied } = outcome;
  return { step: "done", summary: { notes, attachments, unresolved, skipped, cancelled, notCopied } };
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
