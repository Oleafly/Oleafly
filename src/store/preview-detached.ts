import { create } from "zustand";
import { readString, writeString } from "@/lib/local-storage";

export const usePreviewDetachedStore = create<{ projectId: string | null }>(() => ({ projectId: null }));

export function wantsDetachedPreview(projectId: string): boolean {
  return readString(`oleafly.preview.detached.${projectId}`) === "true";
}

export function setPreviewDetached(projectId: string, open: boolean): void {
  usePreviewDetachedStore.setState({ projectId: open ? projectId : null });
  writeString(`oleafly.preview.detached.${projectId}`, String(open));
}
