import { useFilesStore } from "@/store/files";

export function bufferContent(projectId: string, path: string): string | null {
  const files = useFilesStore.getState();
  if (files.projectId !== projectId) return null;
  return files.files[path]?.content ?? null;
}
