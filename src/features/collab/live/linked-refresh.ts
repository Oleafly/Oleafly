import { create } from "zustand";
import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import { overleafLiveRefreshLinked } from "@/lib/overleaf-live";
import { isCollabCommandError } from "@/lib/tauri-collab";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { collabErrorText } from "../errors";

interface LinkedRefreshState {
  projectId: string | null;
  refreshing: string | null;
  failure: { path: string; text: string } | null;
}

export const useLinkedRefresh = create<LinkedRefreshState>(() => ({
  projectId: null,
  refreshing: null,
  failure: null,
}));

export function linkedRefreshFailure(error: unknown): string {
  if (isCollabCommandError(error) && error.code === "linked_refresh_failed" && error.message.trim()) {
    return i18n.t(($) => $.collab.overleafLinked.refusedWith, { message: error.message.trim() });
  }
  return collabErrorText(error);
}

export async function refreshLinked(projectId: string, path: string): Promise<boolean> {
  const { refreshing } = useLinkedRefresh.getState();
  if (refreshing !== null) return false;
  useLinkedRefresh.setState({ projectId, refreshing: path, failure: null });
  try {
    await overleafLiveRefreshLinked(projectId, path);
    return true;
  } catch (error) {
    void logError("refresh a linked file from Overleaf", error);
    const text = linkedRefreshFailure(error);
    useLinkedRefresh.setState({ failure: { path, text } });
    const files = useFilesStore.getState();
    if (files.projectId !== projectId || files.activePath !== path) toast.error(text);
    return false;
  } finally {
    useLinkedRefresh.setState({ refreshing: null });
  }
}
