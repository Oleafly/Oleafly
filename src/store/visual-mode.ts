import { create } from "zustand";
import {
  type EditorMode,
  getKindModes,
  getMarkdownSplitLayout,
  type KindModes,
  kindMode,
  type MarkdownSplitLayout,
  saveKindModes,
  setMarkdownSplitLayout,
  viewKind,
} from "@/lib/wysiwyg-mode";
import { useFilesStore } from "@/store/files";

interface FileModes {
  projectId: string | null;
  kinds: KindModes;
  files: Readonly<Record<string, EditorMode>>;
}

interface VisualModeState extends FileModes {
  markdownSplitLayout: MarkdownSplitLayout;
  loadProject: (projectId: string | null) => void;
  remember: (path: string) => void;
  setMode: (path: string, mode: EditorMode) => void;
  setMarkdownSplitLayout: (layout: MarkdownSplitLayout) => void;
}

const fileKey = (projectId: string | null, path: string) => `${projectId ?? ""}\n${path}`;

export function fileMode(state: FileModes, path: string | null): EditorMode {
  if (!path) return "code";
  return state.files[fileKey(state.projectId, path)] ?? kindMode(state.kinds, path);
}

export const useVisualModeStore = create<VisualModeState>((set, get) => ({
  projectId: null,
  kinds: {},
  files: {},
  markdownSplitLayout: "split",
  loadProject: (projectId) =>
    set({
      projectId,
      kinds: projectId ? getKindModes(projectId) : {},
      markdownSplitLayout: projectId ? getMarkdownSplitLayout(projectId) : "split",
    }),
  remember: (path) => {
    const state = get();
    const key = fileKey(state.projectId, path);
    if (state.files[key] === undefined) set({ files: { ...state.files, [key]: kindMode(state.kinds, path) } });
  },
  setMode: (path, mode) => {
    const { projectId, kinds, files } = get();
    const kind = viewKind(path);
    const nextKinds = kinds[kind] === mode ? kinds : { ...kinds, [kind]: mode };
    if (projectId && nextKinds !== kinds) saveKindModes(projectId, nextKinds);
    set({ kinds: nextKinds, files: { ...files, [fileKey(projectId, path)]: mode } });
  },
  setMarkdownSplitLayout: (markdownSplitLayout) => {
    const { projectId } = get();
    if (projectId) setMarkdownSplitLayout(projectId, markdownSplitLayout);
    set({ markdownSplitLayout });
  },
}));

export function useFileMode(path: string | null): EditorMode {
  return useVisualModeStore((state) => fileMode(state, path));
}

export function setActiveFileMode(mode: EditorMode): void {
  const path = useFilesStore.getState().activePath;
  if (path) useVisualModeStore.getState().setMode(path, mode);
}
