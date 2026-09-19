import { useSettingsStore, layoutPresetViewMode, layoutPresetWantsAi, layoutPresetHidesWorkspace, type ViewMode } from "@/store/settings";

type WorkspaceLayout = Pick<ReturnType<typeof useSettingsStore.getState>,
  "viewMode" | "showTree" | "assistantOpen" | "workspaceHidden" | "terminalOpen">;

const modes: readonly ViewMode[] = ["editor", "split", "pdf"];
const key = (projectId: string) => `oleafly.workspace.${projectId}`;

export function readWorkspaceLayout(projectId: string): Partial<WorkspaceLayout> {
  try {
    const value = JSON.parse(localStorage.getItem(key(projectId)) ?? "null");
    if (!value || typeof value !== "object" || value.version !== 1) return {};
    const layout: Partial<WorkspaceLayout> = {};
    if (modes.includes(value.viewMode)) layout.viewMode = value.viewMode;
    for (const field of ["showTree", "assistantOpen", "workspaceHidden", "terminalOpen"] as const) {
      if (typeof value[field] === "boolean") layout[field] = value[field];
    }
    if (layout.workspaceHidden && !layout.assistantOpen) layout.workspaceHidden = false;
    return layout;
  } catch {
    return {};
  }
}

function selectedLayout(state: ReturnType<typeof useSettingsStore.getState>): WorkspaceLayout {
  const { viewMode, showTree, assistantOpen, workspaceHidden, terminalOpen } = state;
  return { viewMode, showTree, assistantOpen, workspaceHidden, terminalOpen };
}

/** Apply defaults only on a project's first visit. Subscribe after restoration. */
export function restoreWorkspaceLayout(projectId: string): () => void {
  const settings = useSettingsStore.getState();
  const saved = readWorkspaceLayout(projectId);
  useSettingsStore.setState({
    viewMode: layoutPresetViewMode(settings.defaultView),
    assistantOpen: layoutPresetWantsAi(settings.defaultView),
    workspaceHidden: layoutPresetHidesWorkspace(settings.defaultView),
    showTree: settings.openInTree,
    terminalOpen: false,
    ...saved,
  });
  let previous = JSON.stringify(selectedLayout(useSettingsStore.getState()));
  return useSettingsStore.subscribe((state) => {
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
