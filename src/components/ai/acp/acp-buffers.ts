import { useFilesStore } from "@/store/files";

/**
 * The open editor text of `path` when this window shows `projectId` and has
 * the file open; the agent reads the file from disk otherwise.
 */
export function bufferContent(projectId: string, path: string): string | null {
  const files = useFilesStore.getState();
  if (files.projectId !== projectId) return null;
  return files.files[path]?.content ?? null;
}
