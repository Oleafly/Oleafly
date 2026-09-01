import { create } from "zustand";

export interface PlanModeState {
  enabledByProject: Record<string, boolean>;
  loaded: Record<string, boolean>;
  load: (projectId: string | null) => boolean;
  isEnabled: (projectId: string | null) => boolean;
  setEnabled: (projectId: string | null, enabled: boolean) => void;
  toggle: (projectId: string | null) => boolean;
}

const storageKey = (projectId: string) => `oleafly.plan-mode.${projectId}`;

function readStored(projectId: string): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(storageKey(projectId)) === "1";
  } catch {
    return false;
  }
}

function writeStored(projectId: string, enabled: boolean): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(storageKey(projectId), enabled ? "1" : "0");
    }
  } catch {
    return;
  }
}

export function planModeForProject(
  enabledByProject: Readonly<Record<string, boolean>>,
  projectId: string | null,
): boolean {
  return projectId ? enabledByProject[projectId] === true : false;
}

export const usePlanModeStore = create<PlanModeState>((set, get) => ({
  enabledByProject: {},
  loaded: {},
  load: (projectId) => {
    if (!projectId) return false;
    if (get().loaded[projectId]) {
      return planModeForProject(get().enabledByProject, projectId);
    }
    const enabled = readStored(projectId);
    set((state) => ({
      enabledByProject: { ...state.enabledByProject, [projectId]: enabled },
      loaded: { ...state.loaded, [projectId]: true },
    }));
    return enabled;
  },
  isEnabled: (projectId) => {
    if (!projectId) return false;
    if (!get().loaded[projectId]) return get().load(projectId);
    return planModeForProject(get().enabledByProject, projectId);
  },
  setEnabled: (projectId, enabled) => {
    if (!projectId) return;
    writeStored(projectId, enabled);
    set((state) => ({
      enabledByProject: { ...state.enabledByProject, [projectId]: enabled },
      loaded: { ...state.loaded, [projectId]: true },
    }));
  },
  toggle: (projectId) => {
    if (!projectId) return false;
    const enabled = !get().isEnabled(projectId);
    get().setEnabled(projectId, enabled);
    return enabled;
  },
}));
