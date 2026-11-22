import { ClipboardCopy, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContextMenuItem } from "@/components/ui/context-menu";
import type { FileReference } from "@/features/file-links";
import { showInFileManagerLabel } from "@/lib/file-manager-label";
import { revealProject } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { useFilesStore } from "@/store/files";

export function copyReference(path: string, reference: FileReference): void {
  void import("@/features/file-links")
    .then((links) => links.copyFileReference(path, reference))
    .catch((error: unknown) => notifyError("copy file reference", error));
}

function revealEntry(path: string): void {
  const { projectId } = useFilesStore.getState();
  if (!projectId) return;
  void revealProject(projectId, path || null).catch((error: unknown) => notifyError("show in folder", error));
}

export function FilePathMenuItems({ path, icons = false }: Readonly<{ path: string; icons?: boolean }>) {
  const { t } = useTranslation(["workspace"]);
  const copyIcon = icons ? <ClipboardCopy className="mr-2 size-4" /> : null;
  return (
    <>
      <ContextMenuItem onClick={() => copyReference(path, "path")}>
        {copyIcon}
        {t(($) => $.workspace.files.copyPath)}
      </ContextMenuItem>
      {path && (
        <ContextMenuItem onClick={() => copyReference(path, "relativePath")}>
          {copyIcon}
          {t(($) => $.workspace.files.copyRelativePath)}
        </ContextMenuItem>
      )}
      <ContextMenuItem onClick={() => revealEntry(path)}>
        {icons ? <FolderOpen className="mr-2 size-4" /> : null}
        {showInFileManagerLabel()}
      </ContextMenuItem>
    </>
  );
}
