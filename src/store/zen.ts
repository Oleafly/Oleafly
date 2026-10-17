import { create } from "zustand";
import type { RailTab, ViewMode } from "@/store/settings";

export interface ZenLayoutSnapshot {
  showTree: boolean;
  railTab: RailTab;
  assistantOpen: boolean;
  workspaceHidden: boolean;
  viewMode: ViewMode;
  terminalOpen: boolean;
}

export type ZenFullscreen = "none" | "entering" | "on";

export interface ZenStart {
  projectId: string;
  snapshot: ZenLayoutSnapshot;
  pdfVisibleAtStart: boolean;
  fullscreen: ZenFullscreen;
}

interface ZenState {
  active: boolean;
  projectId: string | null;
  snapshot: ZenLayoutSnapshot | null;
  pdfVisibleAtStart: boolean;
  fullscreen: ZenFullscreen;
  logsOpen: boolean;
  begin: (start: ZenStart) => void;
  end: () => void;
  setFullscreen: (fullscreen: ZenFullscreen) => void;
  setLogsOpen: (open: boolean) => void;
}

const IDLE = {
  active: false,
  projectId: null,
  snapshot: null,
  pdfVisibleAtStart: false,
  fullscreen: "none" as ZenFullscreen,
  logsOpen: false,
};

export const useZenStore = create<ZenState>((set) => ({
  ...IDLE,
  begin: ({ projectId, snapshot, pdfVisibleAtStart, fullscreen }) =>
    set({ ...IDLE, active: true, projectId, snapshot, pdfVisibleAtStart, fullscreen }),
  end: () => set(IDLE),
  setFullscreen: (fullscreen) => set({ fullscreen }),
  setLogsOpen: (logsOpen) => set({ logsOpen }),
}));
