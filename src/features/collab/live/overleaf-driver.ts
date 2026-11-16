import { installOverleafLiveActions } from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import {
  overleafLivePause,
  overleafLiveProject,
  overleafLiveResume,
  overleafLiveStart,
  overleafLiveStop,
  overleafLiveUnlink,
} from "@/lib/overleaf-live";
import { useOverleafImportStore } from "@/store/overleaf-import";
import { useSettingsStore } from "@/store/settings";
import type { CollabLiveStoreState, LiveBackendDriver } from "./live-store";
import { useCollabLiveStore } from "./live-store";
import { startOverleafNotices } from "./overleaf-notices";

export function wantsOverleaf(state: CollabLiveStoreState): boolean {
  const link = state.overleaf;
  return link !== null && !link.paused && (link.signedIn || state.status?.state === "signed_out");
}

async function loadOverleaf(projectId: string): Promise<void> {
  if (!useSettingsStore.getState().overleafLive) {
    if (useCollabLiveStore.getState().overleaf !== null) useCollabLiveStore.setState({ overleaf: null });
    return;
  }
  let overleaf: CollabLiveStoreState["overleaf"];
  try {
    overleaf = await overleafLiveProject(projectId);
  } catch (error) {
    void logError("overleaf live project", error);
    return;
  }
  if (useCollabLiveStore.getState().projectId !== projectId) return;
  if (!useSettingsStore.getState().overleafLive) overleaf = null;
  useCollabLiveStore.setState({ overleaf });
}

export function overleafDriver(): LiveBackendDriver {
  return {
    kind: "overleaf",
    wants: wantsOverleaf,
    start: (projectId) => overleafLiveStart(projectId),
    stop: (projectId) => overleafLiveStop(projectId),
    refresh: (projectId) => loadOverleaf(projectId),
    resumable: (reason) => reason === "signed_out",
  };
}

async function reload(): Promise<void> {
  const projectId = useCollabLiveStore.getState().projectId;
  if (!projectId) return;
  await loadOverleaf(projectId);
  const state = useCollabLiveStore.getState();
  if (state.projectId === projectId && state.ended === "signed_out" && state.overleaf?.signedIn) {
    state.goLiveAgain();
  }
}

export function startOverleafLive(): () => void {
  const unsubscribePref = useSettingsStore.subscribe((state, previous) => {
    if (state.overleafLive !== previous.overleafLive) void reload();
  });
  const unsubscribeSignIn = useOverleafImportStore.subscribe((state, previous) => {
    if (state.status?.signedIn !== previous.status?.signedIn) void reload();
  });
  const uninstall = installOverleafLiveActions({
    pause: async (projectId, anyway) => {
      const outcome = await overleafLivePause(projectId, anyway);
      if (outcome.paused) await loadOverleaf(projectId);
      return outcome;
    },
    resume: async (projectId) => {
      await overleafLiveResume(projectId);
      await loadOverleaf(projectId);
    },
    unlink: async (projectId) => {
      await overleafLiveUnlink(projectId);
      await loadOverleaf(projectId);
    },
  });
  const stopNotices = startOverleafNotices();
  return () => {
    stopNotices();
    uninstall();
    unsubscribeSignIn();
    unsubscribePref();
  };
}
