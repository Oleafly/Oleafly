import {
  detectDiskChange,
  reportFileSaveFailure,
  SaveFlushError,
  useFilesStore,
} from "@/store/files";
import { projectFolderAvailable } from "@/store/project-availability";
import { useIndexStore } from "@/store/project-index";
import { isProjectIntelligencePath } from "@/lib/project-intelligence/source";

export type ExternalFileChange =
  | { kind: "write"; path: string; content: string }
  | { kind: "create" | "delete"; path: string }
  | { kind: "rename"; from: string; to: string };

export interface ExternalFileChangePayload {
  projectId: string;
  paths?: string[];
  from?: string;
  change?: ExternalFileChange;
}

export function applyExternalFileChange(
  payload: ExternalFileChangePayload,
  selfLabel: string,
) {
  if (payload.from === selfLabel) return;
  const files = useFilesStore.getState();
  if (!payload.projectId) return;
  if (payload.projectId !== files.projectId) return;
  if (applyKnownExternalChange(files, payload.projectId, payload.change)) return;
  void files.refreshTree();
  if (payload.change?.kind === "create") return;
  let paths = payload.paths;
  if (!paths?.length) paths = Object.keys(files.files);
  for (const path of paths) refreshExternalFile(payload.projectId, path, files.files[path]);
}

export interface FolderChangePayload {
  projectId: string;
  paths: string[];
  rescan: boolean;
  structural?: boolean;
}

async function refreshAfterFolderChange(
  projectId: string,
  listAgain: boolean,
  sourcesChanged: boolean,
): Promise<void> {
  const treeChanged = listAgain
    ? await useFilesStore.getState().refreshTree({ keepUnchanged: true }).catch(() => false)
    : false;
  if (treeChanged || !sourcesChanged) return;
  if (useFilesStore.getState().projectId !== projectId) return;
  await useIndexStore.getState().rebuildFromDisk();
}

export function applyFolderChange(change: FolderChangePayload): void {
  const files = useFilesStore.getState();
  if (!change.projectId || change.projectId !== files.projectId) return;
  if (!projectFolderAvailable(change.projectId)) return;
  const known = new Set(files.tree.map((entry) => entry.path));
  const listAgain =
    change.rescan ||
    change.structural === true ||
    change.paths.some((path) => !known.has(path));
  const sourcesChanged = change.rescan || change.paths.some(isProjectIntelligencePath);
  void refreshAfterFolderChange(change.projectId, listAgain, sourcesChanged).catch(() => {});
  const affected = (path: string) =>
    change.rescan ||
    change.paths.some((changed) => path === changed || path.startsWith(`${changed}/`));
  for (const [path, file] of Object.entries(files.files)) {
    if (!affected(path)) continue;
    if (file.dirty) void detectDiskChange(change.projectId, path);
    else refreshExternalFile(change.projectId, path, file);
  }
}

export function refreshOpenFilesFromDisk(projectId: string | null): void {
  const files = useFilesStore.getState();
  if (!projectId || files.projectId !== projectId || !projectFolderAvailable(projectId)) return;
  void files.refreshTree({ keepUnchanged: true });
  for (const [path, file] of Object.entries(files.files)) {
    refreshExternalFile(projectId, path, file);
  }
}

export async function flushOpenFilesToDisk(projectId: string, scope: string): Promise<void> {
  const files = useFilesStore.getState();
  if (files.projectId !== projectId) return;
  try {
    await files.prepareExternalMutation(projectId);
  } catch (error) {
    if (error instanceof SaveFlushError) {
      for (const failure of error.failures) {
        reportFileSaveFailure(scope, projectId, failure.path, failure.reason, true);
      }
    }
    throw error;
  }
}

function applyKnownExternalChange(
  files: ReturnType<typeof useFilesStore.getState>,
  projectId: string,
  change: ExternalFileChange | undefined,
): boolean {
  switch (change?.kind) {
    case "delete":
      files.applyExternalDelete(projectId, change.path);
      return true;
    case "rename":
      files.applyExternalRename(projectId, change.from, change.to);
      return true;
    case "write":
      files.applyExternalWrite(projectId, change.path, change.content, { opener: "assistant" });
      return true;
    default:
      return false;
  }
}

function refreshExternalFile(
  projectId: string,
  path: string,
  file: { content: string; dirty: boolean } | undefined,
) {
  if (!file || file.dirty) return;
  const contentBeforeRead = file.content;
  void import("@/lib/tauri").then(({ readFileContent }) => {
    void readFileContent(projectId, path)
      .then((content) => {
        const current = useFilesStore.getState();
        const latest = current.files[path];
        if (current.projectId !== projectId || latest?.dirty) return;
        if (latest?.content !== contentBeforeRead) return;
        current.applyExternalReload(projectId, path, content);
      })
      .catch(() => {});
  });
}
