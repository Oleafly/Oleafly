import { useCompileStore, type RecompileOptions } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { useSettingsStore } from "@/store/settings";
import { useZenStore } from "@/store/zen";

export function revealPreviewForCompile(): void {
  const projectId = useFilesStore.getState().projectId;
  const detached = projectId !== null && usePreviewDetachedStore.getState().projectId === projectId;
  const settings = useSettingsStore.getState();
  if (useZenStore.getState().active && !settings.zenShowPdfOnCompile) return;
  if (settings.viewMode === "editor" && !detached) settings.setViewMode("split");
}

export function togglePreviewPane(): boolean {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId || usePreviewDetachedStore.getState().projectId === projectId) return false;
  const settings = useSettingsStore.getState();
  const shown = !settings.workspaceHidden && settings.viewMode !== "editor";
  settings.setViewMode(shown ? "editor" : "split");
  return true;
}

export function recompileWithPreview(options?: RecompileOptions) {
  revealPreviewForCompile();
  return useCompileStore.getState().recompile(options);
}
