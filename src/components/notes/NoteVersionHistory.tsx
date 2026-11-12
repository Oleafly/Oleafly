import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CheckpointSource } from "@/components/editor/CheckpointsPanel";
import { InlineDiffPreview } from "@/components/editor/diff/InlineDiffPreview";
import { VersioningModal } from "@/components/editor/VersioningModal";
import { ErrorState, LoadingState } from "@/components/ui/empty";
import { logError } from "@/lib/log";
import { notifyError, toast } from "@/lib/toast";
import { lf } from "./note-outside-changes";
import { noteVersionFile, readNoteVersion, restoreNoteVersion, saveNoteVersion } from "./note-versions";
import { useNotesData } from "./notes-data";
import type { NoteItem } from "./types";

function VersionChanges({ noteId, snapshotRoot }: Readonly<{ noteId: string; snapshotRoot: string }>) {
  const { t } = useTranslation(["notes"]);
  const { loadNote } = useNotesData();
  const [texts, setTexts] = useState<{ current: string; version: string } | "failed" | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([loadNote(noteId), readNoteVersion(noteId, snapshotRoot)]).then(
      ([current, version]) => {
        if (live) setTexts({ current: lf(current.text), version: lf(version) });
      },
      (error: unknown) => {
        void logError("read a note version", error);
        if (live) setTexts("failed");
      },
    );
    return () => {
      live = false;
    };
  }, [loadNote, noteId, snapshotRoot]);

  if (texts === "failed") return <ErrorState size="compact" message={t(($) => $.notes.versions.readFailed)} />;
  if (texts === null) return <LoadingState size="compact" label={t(($) => $.notes.versions.comparing)} />;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t(($) => $.notes.versions.textOnly)}</p>
      <div data-note-version-diff className="h-64 overflow-hidden rounded-md border">
        <InlineDiffPreview
          path={noteVersionFile(noteId) ?? ""}
          oldText={texts.current}
          newText={texts.version}
          ariaLabel={t(($) => $.notes.versions.changes)}
          className="h-full"
        />
      </div>
    </div>
  );
}

export default function NoteVersionHistory({ note, onClose }: Readonly<{ note: NoteItem; onClose: () => void }>) {
  const { t } = useTranslation(["notes"]);
  const { loadNote, saveNote } = useNotesData();
  const source = useMemo<CheckpointSource>(
    () => ({
      projectId: note.id,
      name: note.title,
      summary: t(($) => $.notes.versions.summary),
      emptyHint: t(($) => $.notes.versions.empty),
      saveLabel: t(($) => $.notes.versions.save),
      restoreLabel: t(($) => $.notes.versions.restore),
      save: () =>
        saveNoteVersion(note.id).then(
          (kept) => {
            toast.success(kept ? t(($) => $.notes.versions.saved) : t(($) => $.notes.versions.unchanged));
          },
          (error: unknown) => notifyError("save a note version", error, t(($) => $.notes.versions.saveFailed)),
        ),
      restore: (snapshotRoot) =>
        restoreNoteVersion({ loadNote, saveNote }, note.id, snapshotRoot).then(
          () => {
            toast.success(t(($) => $.notes.versions.restored));
            return true;
          },
          (error: unknown) => {
            notifyError("restore a note version", error, t(($) => $.notes.versions.restoreFailed));
            return false;
          },
        ),
      preview: (snapshotRoot) => <VersionChanges noteId={note.id} snapshotRoot={snapshotRoot} />,
      close: onClose,
    }),
    [loadNote, note.id, note.title, onClose, saveNote, t],
  );
  return <VersioningModal source={source} title={t(($) => $.notes.versions.title)} />;
}
