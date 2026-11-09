import { useFilesStore } from "@/store/files";

export function mirrorFileText(projectId: string, path: string, text: string): void {
  useFilesStore.setState((state) => {
    const file = state.files[path];
    if (state.projectId !== projectId || !file || file.dirty || file.content === text) return state;
    return { files: { ...state.files, [path]: { ...file, content: text } } };
  });
}
