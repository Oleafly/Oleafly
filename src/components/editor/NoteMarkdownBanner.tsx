import { NotebookPen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WorkspaceBanner, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { isEditorNoteFile } from "@/lib/project-notes";
import { useFilesStore } from "@/store/files";
import { editsAsMarkdown, useNoteTabsStore } from "@/store/note-tabs";
import { useSettingsStore } from "@/store/settings";

export function NoteMarkdownBanner() {
  const { t } = useTranslation(["editor"]);
  const notes = useSettingsStore((state) => state.notes);
  const projectId = useFilesStore((state) => state.projectId);
  const path = useFilesStore((state) => state.activePath);
  const asMarkdown = useNoteTabsStore((state) => editsAsMarkdown(state, projectId, path));
  const note = useFilesStore(
    (state) =>
      asMarkdown &&
      state.activePath !== null &&
      isEditorNoteFile(state.activePath, state.files[state.activePath]?.content, {
        notes,
        projectKind: state.projectKind,
      }),
  );
  if (!note || projectId === null || path === null) return null;
  return (
    <WorkspaceBanner tone="primary" data-testid="note-markdown-banner">
      <NotebookPen aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <output className="min-w-0 flex-1">{t(($) => $.editor.shell.noteAsMarkdown)}</output>
      <WorkspaceBannerButton
        tone="primary"
        data-testid="note-markdown-banner-note"
        onClick={() => useNoteTabsStore.getState().setMarkdown(projectId, path, false)}
      >
        {t(($) => $.editor.shell.editAsNote)}
      </WorkspaceBannerButton>
    </WorkspaceBanner>
  );
}
