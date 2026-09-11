import { useFilesStore } from "@/store/files";

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
      files.applyExternalWrite(projectId, change.path, change.content);
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
