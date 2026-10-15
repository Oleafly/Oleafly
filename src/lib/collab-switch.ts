import { invoke, isTauri } from "@tauri-apps/api/core";
import { logError } from "@/lib/log";
import { useSettingsStore } from "@/store/settings";

function tellBackend(enabled: boolean): void {
  invoke<void>("collab_live_collaboration_set", { enabled }).catch((error: unknown) =>
    logError("live collaboration switch", error),
  );
}

export function syncLiveCollaborationSwitch(): () => void {
  if (!isTauri()) return () => undefined;
  tellBackend(useSettingsStore.getState().liveCollaboration);
  return useSettingsStore.subscribe((state, previous) => {
    if (state.liveCollaboration !== previous.liveCollaboration) tellBackend(state.liveCollaboration);
  });
}
