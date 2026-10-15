import { watchServers } from "../store";
import { startFileNotices } from "./file-notices";
import { startLiveEditing } from "./live-editing";
import { startCollabLive } from "./live-store";
import { startReconnectNudges } from "./reconnect-nudges";
import { startRemovedNotices } from "./removed-notices";
import { startSyncPause } from "./sync-pause";

export function startLive(): () => void {
  const stopPause = startSyncPause();
  const stopRemoved = startRemovedNotices();
  const stopFiles = startFileNotices();
  const stopLive = startCollabLive({ started: startLiveEditing });
  const stopServers = watchServers();
  const stopNudges = startReconnectNudges();
  return () => {
    stopNudges();
    stopServers();
    stopLive();
    stopFiles();
    stopRemoved();
    stopPause();
  };
}
