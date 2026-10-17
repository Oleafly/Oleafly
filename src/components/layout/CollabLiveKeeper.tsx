import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { logError } from "@/lib/log";
import { useSettingsStore } from "@/store/settings";

export function CollabLiveKeeper() {
  const enabled = useSettingsStore((state) => state.liveCollaboration);

  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let active = true;
    let stop: (() => void) | null = null;
    import("@/features/collab/live")
      .then((live) => {
        if (active) stop = live.startLive();
      })
      .catch((error) => logError("collab live", error));
    return () => {
      active = false;
      stop?.();
    };
  }, [enabled]);

  return null;
}
