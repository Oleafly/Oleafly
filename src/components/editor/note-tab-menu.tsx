import { useTranslation } from "react-i18next";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { logError } from "@/lib/log";
import { isMarkdownFile, noteFileFacts } from "@/lib/project-notes";
import { useFilesStore } from "@/store/files";
import { editsAsMarkdown, useNoteTabsStore } from "@/store/note-tabs";
import { useSettingsStore } from "@/store/settings";
import type { EditorTab } from "./editor-tabs";

function noteActions() {
  return import("@/components/notes/project-note-actions");
}

function runNoteAction(scope: string, action: (module: Awaited<ReturnType<typeof noteActions>>) => Promise<unknown>) {
  noteActions()
    .then(action)
    .catch((error: unknown) => logError(scope, error));
}

function NoteFileMenuItems({ path }: Readonly<{ path: string }>) {
  const { t } = useTranslation(["editor"]);
  const notesOn = useSettingsStore((s) => s.notes);
  const projectId = useFilesStore((s) => s.projectId);
  const note = useFilesStore(
    (s) => notesOn && s.projectKind !== "note" && isMarkdownFile(path) && noteFileFacts(s.files[path]?.content) !== null,
  );
  const markdown = useNoteTabsStore((s) => editsAsMarkdown(s, projectId, path));
  if (!note || !projectId) return null;
  return (
    <>
      <ContextMenuItem
        data-testid="editor-tab-menu-note-mode"
        onClick={() => useNoteTabsStore.getState().setMarkdown(projectId, path, !markdown)}
      >
        {markdown ? t(($) => $.editor.shell.editAsNote) : t(($) => $.editor.shell.editAsMarkdown)}
      </ContextMenuItem>
      <ContextMenuItem
        data-testid="editor-tab-menu-copy-note"
        onClick={() =>
          runNoteAction("copy a project note to my notes", (module) => module.copyProjectNoteToMine(projectId, path))
        }
      >
        {t(($) => $.editor.shell.copyToMyNotes)}
      </ContextMenuItem>
      <ContextMenuSeparator />
    </>
  );
}

function PersonalNoteMenuItems({ noteId }: Readonly<{ noteId: string }>) {
  const { t } = useTranslation(["editor"]);
  const projectId = useFilesStore((s) => s.projectId);
  if (!projectId) return null;
  return (
    <>
      <ContextMenuItem
        data-testid="editor-tab-menu-open-in-notes"
        onClick={() =>
          void import("@/features/open-tool")
            .then((module) => module.openNotes(noteId))
            .catch((error: unknown) => logError("open a note in Notes", error))
        }
      >
        {t(($) => $.editor.shell.openInNotes)}
      </ContextMenuItem>
      <ContextMenuItem
        data-testid="editor-tab-menu-move-note"
        onClick={() =>
          runNoteAction("move a note into the project", (module) => module.moveNoteIntoProject(noteId, projectId))
        }
      >
        {t(($) => $.editor.shell.moveIntoProject)}
      </ContextMenuItem>
      <ContextMenuSeparator />
    </>
  );
}

export default function NoteTabMenuItems({ tab }: Readonly<{ tab: EditorTab }>) {
  if (tab.kind === "file") return <NoteFileMenuItems path={tab.id} />;
  if (tab.kind === "note") return <PersonalNoteMenuItems noteId={tab.id} />;
  return null;
}
