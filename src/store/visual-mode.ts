import { create } from "zustand";
import { getMarkdownSplitLayout, getMarkdownSplitMode, getWysiwygMode, setMarkdownSplitLayout, setMarkdownSplitMode, setWysiwygMode, type MarkdownSplitLayout } from "@/lib/wysiwyg-mode";

interface VisualModeState {
  projectId: string | null;
  enabled: boolean;
  markdownSplit: boolean;
  markdownSplitLayout: MarkdownSplitLayout;
  loadProject: (projectId: string | null) => void;
  setEnabled: (enabled: boolean) => void;
  setMarkdownSplit: (enabled: boolean) => void;
  setMarkdownSplitLayout: (layout: MarkdownSplitLayout) => void;
}

export const useVisualModeStore = create<VisualModeState>((set, get) => ({
  projectId: null,
  enabled: false,
  markdownSplit: false,
  markdownSplitLayout: "split",
  loadProject: (projectId) =>
    set({ projectId, enabled: projectId ? getWysiwygMode(projectId) : false,
      markdownSplit: projectId ? getMarkdownSplitMode(projectId) : false,
      markdownSplitLayout: projectId ? getMarkdownSplitLayout(projectId) : "split" }),
  setEnabled: (enabled) => {
    const { projectId } = get();
    if (projectId) setWysiwygMode(projectId, enabled);
    set({ enabled });
  },
  setMarkdownSplit: (markdownSplit) => {
    const { projectId } = get();
    if (projectId) setMarkdownSplitMode(projectId, markdownSplit);
    set({ markdownSplit });
  },
  setMarkdownSplitLayout: (markdownSplitLayout) => {
    const { projectId } = get();
    if (projectId) setMarkdownSplitLayout(projectId, markdownSplitLayout);
    set({ markdownSplitLayout });
  },
}));
