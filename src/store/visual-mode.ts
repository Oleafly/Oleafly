import { create } from "zustand";
import { getWysiwygMode, setWysiwygMode } from "@/lib/wysiwyg-mode";

interface VisualModeState {
  projectId: string | null;
  enabled: boolean;
  loadProject: (projectId: string | null) => void;
  setEnabled: (enabled: boolean) => void;
}

export const useVisualModeStore = create<VisualModeState>((set, get) => ({
  projectId: null,
  enabled: false,
  loadProject: (projectId) =>
    set({ projectId, enabled: projectId ? getWysiwygMode(projectId) : false }),
  setEnabled: (enabled) => {
    const { projectId } = get();
    if (projectId) setWysiwygMode(projectId, enabled);
    set({ enabled });
  },
}));
