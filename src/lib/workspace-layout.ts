import { useSettingsStore, layoutPresetViewMode, type ViewMode } from "@/store/settings";
import { useZenStore } from "@/store/zen";

type WorkspaceLayout = Pick<ReturnType<typeof useSettingsStore.getState>,
  "viewMode" | "showTree" | "workspaceHidden">;

const modes: readonly ViewMode[] = ["editor", "split", "pdf"];
const key = (projectId: string) => `oleafly.workspace.${projectId}`;

export function readWorkspaceLayout(projectId: string): Partial<WorkspaceLayout> {
  try {
    const value = JSON.parse(localStorage.getItem(key(projectId)) ?? "null");
    if (!value || typeof value !== "object" || value.version !== 1) return {};
    const layout: Partial<WorkspaceLayout> = {};
    if (modes.includes(value.viewMode)) layout.viewMode = value.viewMode;
    for (const field of ["showTree", "workspaceHidden"] as const) {
      if (typeof value[field] === "boolean") layout[field] = value[field];
    }
    // Older versions could persist an AI-only workspace. Always restore the editor.
    layout.workspaceHidden = false;
    return layout;
  } catch {
    return {};
  }
}

function selectedLayout(state: ReturnType<typeof useSettingsStore.getState>): WorkspaceLayout {
  const { viewMode, showTree, workspaceHidden } = state;
  return { viewMode, showTree, workspaceHidden };
}

export function restoreWorkspaceLayout(projectId: string): () => void {
  const settings = useSettingsStore.getState();
  const saved = readWorkspaceLayout(projectId);
  useSettingsStore.setState({
    viewMode: layoutPresetViewMode(settings.defaultView),
    workspaceHidden: false,
    showTree: settings.openInTree,
    terminalOpen: false,
    ...saved,
  });
  let previous = JSON.stringify(selectedLayout(useSettingsStore.getState()));
  return useSettingsStore.subscribe((state) => {
    if (useZenStore.getState().active) return;
    const layout = selectedLayout(state);
    const serialized = JSON.stringify(layout);
    if (serialized === previous) return;
    previous = serialized;
    try {
      localStorage.setItem(key(projectId), JSON.stringify({ version: 1, ...layout }));
    } catch { /* Keep the workspace usable when browser storage is unavailable. */ }
  });
}

export const workspacePanelId = (projectId: string, group: string) =>
  `oleafly.workspace.${projectId}.${group}`;
