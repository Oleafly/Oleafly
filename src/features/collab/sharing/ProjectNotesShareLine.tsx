import { NotebookPen } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isNoteProject } from "@/lib/library-projects";
import { logError } from "@/lib/log";
import { declaresNoteFile, isProjectNotePath } from "@/lib/project-notes";
import { listFiles, readFileContent } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

export const SHARED_NOTE_SCAN_LIMIT = 500;
export const SHARED_NOTE_BATCH = 8;

export async function hasProjectNotes(projectId: string): Promise<boolean> {
  const files = useFilesStore.getState();
  const open = files.projectId === projectId;
  const entries = open ? files.tree : await listFiles(projectId);
  const paths = entries
    .filter((entry) => !entry.is_dir && isProjectNotePath(entry.path))
    .slice(0, SHARED_NOTE_SCAN_LIMIT)
    .map((entry) => entry.path);
  const held = (path: string) => (open ? files.files[path]?.content : undefined);
  if (paths.some((path) => declaresNoteFile(held(path)))) return true;
  const unread = paths.filter((path) => held(path) === undefined);
  for (let start = 0; start < unread.length; start += SHARED_NOTE_BATCH) {
    const texts = await Promise.all(
      unread.slice(start, start + SHARED_NOTE_BATCH).map((path) => readFileContent(projectId, path).catch(() => "")),
    );
    if (texts.some((text) => declaresNoteFile(text))) return true;
  }
  return false;
}

export function ProjectNotesShareLine({ projectId }: Readonly<{ projectId: string }>) {
  const { t } = useTranslation(["collab"]);
  const notesOn = useSettingsStore((state) => state.notes);
  const note = useFilesStore((state) => isNoteProject(state.projects.find((entry) => entry.id === projectId)));
  const [found, setFound] = useState<boolean | null>(null);
  const shown = notesOn && !note;

  useEffect(() => {
    if (!shown) return;
    let live = true;
    hasProjectNotes(projectId).then(
      (some) => {
        if (live) setFound(some);
      },
      (error: unknown) => {
        if (live) setFound(false);
        void logError("count the project notes for sharing", error);
      },
    );
    return () => {
      live = false;
    };
  }, [projectId, shown]);

  if (!shown || found === null) return null;
  return (
    <p data-testid="collab-share-project-notes" className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <NotebookPen aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {found ? t(($) => $.collab.share.projectNotesShared) : t(($) => $.collab.share.personalNotesPrivate)}
      </span>
    </p>
  );
}
