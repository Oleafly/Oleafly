import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { acquireEditorMutationLease } from "@/lib/editor-mutation-lease";
import { useFilesStore } from "@/store/files";

export async function registerUpdateInstallGuard(setBusy: (busy: boolean) => void): Promise<() => void> {
  let active: { token: string; release: () => void } | null = null;
  let disposed = false;
  const release = () => {
    active?.release();
    active = null;
    setBusy(false);
  };
  const stopFinished = await listen<string>("update-install-finished", ({ payload }) => {
    if (active?.token === payload) release();
  });
  let stopPrepare: () => void;
  try {
    stopPrepare = await listen<string>("update-install-prepare", ({ payload: token }) => {
      if (disposed || active) return;
      void (async () => {
        const projectId = useFilesStore.getState().projectId;
        const lease = projectId ? acquireEditorMutationLease(projectId) : null;
        const request = { token, release: () => lease?.release() };
        active = request;
        setBusy(true);
        try {
          await invoke("settle_update_work", { token });
          if (disposed || active !== request) return;
          await lease?.flush();
          await useFilesStore.getState().flushForQuit();
          lease?.assertActive();
          if (disposed || active !== request) return;
          if (useFilesStore.getState().projectId !== projectId) {
            throw new Error("The project changed while saving. Please try the update again.");
          }
          await invoke("confirm_update_install", { token, error: null });
        } catch (error) {
          if (!disposed && active === request) {
            await invoke("confirm_update_install", { token, error: String(error) }).catch(() => {});
          }
        }
      })().catch(async (error) => {
        await invoke("confirm_update_install", { token, error: String(error) }).catch(() => {});
      });
    });
  } catch (error) {
    stopFinished();
    throw error;
  }
  return () => {
    disposed = true;
    stopFinished();
    stopPrepare();
    release();
  };
}
