import { create } from "zustand";
import { useFilesStore } from "@/store/files";

interface CoauthorEdit {
  projectId: string | null;
  path: string | null;
  text: string | null;
  at: number | null;
}

export const useCoauthorEdits = create<CoauthorEdit>(() => ({ projectId: null, path: null, text: null, at: null }));

export function mirrorFileText(projectId: string, path: string, text: string): void {
  useFilesStore.setState((state) => {
    const file = state.files[path];
    if (state.projectId !== projectId || !file || file.dirty || file.content === text) return state;
    return { files: { ...state.files, [path]: { ...file, content: text } } };
  });
}

export function noteCoauthorText(projectId: string, path: string, text: string): void {
  useCoauthorEdits.setState({ projectId, path, text, at: Date.now() });
}

export function useCoauthorsChangedSince(projectId: string | null, since: number | null): boolean {
  return useCoauthorEdits(
    (edit) => projectId !== null && since !== null && edit.projectId === projectId && edit.at !== null && edit.at > since,
  );
}

export function fromCoauthor(projectId: string | null, path: string, text: string): boolean {
  const last = useCoauthorEdits.getState();
  return last.projectId === projectId && last.path === path && last.text === text;
}
