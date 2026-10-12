import { startLiveEditing } from "./live-editing";
import { startCollabLive } from "./live-store";
import { startSyncPause } from "./sync-pause";

export function startLive(): () => void {
  const stopPause = startSyncPause();
  const stopLive = startCollabLive({ started: startLiveEditing });
  return () => {
    stopLive();
    stopPause();
  };
}
