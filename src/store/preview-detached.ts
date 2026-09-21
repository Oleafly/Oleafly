import { create } from "zustand";

export const usePreviewDetachedStore = create<{ projectId: string | null }>(() => ({ projectId: null }));

export function wantsDetachedPreview(projectId: string): boolean {
  try { return localStorage.getItem(`oleafly.preview.detached.${projectId}`) === "true"; }
  catch { return false; }
}

export function setPreviewDetached(projectId: string, open: boolean): void {
  usePreviewDetachedStore.setState({ projectId: open ? projectId : null });
  try { localStorage.setItem(`oleafly.preview.detached.${projectId}`, String(open)); }
  catch { /* Storage is optional. */ }
}
