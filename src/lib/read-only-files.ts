import { i18n } from "@/i18n";
import { isManagedProjectPath, isReadOnlyLink, isReadOnlyProjectPath } from "@/lib/project-paths";
import { useFilesStore } from "@/store/files";
import {
  projectFolderIsReadOnly,
  readOnlyFolderMessage,
  useProjectFolderReadOnly,
} from "@/store/folder-access";

export function activeFileReadOnly(): boolean {
  const { projectId, activePath, manifestHome, tree } = useFilesStore.getState();
  return (
    projectFolderIsReadOnly(projectId) ||
    (!!activePath && isReadOnlyProjectPath(activePath, manifestHome, tree))
  );
}

export function useActiveFileReadOnly(): boolean {
  const projectId = useFilesStore((s) => s.projectId);
  const readOnlyPath = useFilesStore(
    (s) => !!s.activePath && isReadOnlyProjectPath(s.activePath, s.manifestHome, s.tree),
  );
  const readOnlyFolder = useProjectFolderReadOnly(projectId);
  return readOnlyFolder || readOnlyPath;
}

export function readOnlyEditMessage(path: string | null): string | null {
  const { projectId, manifestHome, tree } = useFilesStore.getState();
  if (projectFolderIsReadOnly(projectId)) return readOnlyFolderMessage();
  if (!path) return null;
  if (isManagedProjectPath(path, manifestHome)) {
    return i18n.t(($) => $.editor.shell.managedFileReadOnly, { file: path });
  }
  if (isReadOnlyLink(path, tree)) {
    return i18n.t(($) => $.editor.shell.linkedFileReadOnly, { file: path });
  }
  return null;
}
