import { installOverleafLiveActions } from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import {
  onOverleafLiveMembers,
  overleafLivePause,
  overleafLiveProject,
  overleafLiveResume,
  overleafLiveStart,
  overleafLiveStop,
  overleafLiveUnlink,
} from "@/lib/overleaf-live";
import { accountsOf, useOverleafImportStore } from "@/store/overleaf-import";
import { useSettingsStore } from "@/store/settings";
import type { CollabErrorCode } from "@/lib/tauri";
import { collabErrorText } from "../errors";
import type { CollabLiveStoreState, LiveBackendDriver, StartRefusal } from "./live-store";
import { startLearnedWords } from "./learned-words";
import { useCollabLiveStore } from "./live-store";
import { startOverleafNotices } from "./overleaf-notices";
import { startOverleafTree } from "./overleaf-tree";

const REFUSALS: Readonly<Partial<Record<CollabErrorCode, StartRefusal>>> = {
  signed_out: "signed_out",
  unauthorized: "signed_out",
  not_found: "cancelled",
  access_ended: "access_ended",
  failed: "failed",
  live_elsewhere: "failed",
  collab_shared: "failed",
  conflict: "failed",
  forbidden: "access_ended",
};

function wantsOverleaf(state: CollabLiveStoreState): boolean {
  const link = state.overleaf;
  if (!state.shareChecked || state.share !== null) return false;
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
    refusal: (code) => REFUSALS[code] ?? null,
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
  const stopTree = startOverleafTree();
  const unsubscribePref = useSettingsStore.subscribe((state, previous) => {
    if (state.overleafLive !== previous.overleafLive) void reload();
  });
  const unsubscribeSignIn = useOverleafImportStore.subscribe((state, previous) => {
    if (accountsOf(state.status) !== accountsOf(previous.status)) void reload();
  });
  const stopMembers = onOverleafLiveMembers((projectId) => {
    const state = useCollabLiveStore.getState();
    if (state.projectId === projectId && state.backend === "overleaf") void state.refreshMembers();
  }).catch((error: unknown) => {
    void logError("overleaf live members listen", error);
    return () => undefined;
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
    errorText: (error) => collabErrorText(error),
  });
  const stopNotices = startOverleafNotices();
  const stopLearnedWords = startLearnedWords();
  return () => {
    stopLearnedWords();
    stopNotices();
    void stopMembers.then((stop) => stop());
    uninstall();
    unsubscribeSignIn();
    unsubscribePref();
    stopTree();
  };
}
