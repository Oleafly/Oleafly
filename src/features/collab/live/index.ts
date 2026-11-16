import { installNoteLive } from "../notes/note-live-port";
import { watchServers } from "../store";
import { startFileNotices } from "./file-notices";
import { startCollabLive, useCollabLiveStore } from "./live-store";
import { startLiveTarget } from "./note-slot";
import { overleafDriver, startOverleafLive } from "./overleaf-driver";
import { startReconnectNudges } from "./reconnect-nudges";
import { startRemovedNotices } from "./removed-notices";
import { serverDriver } from "./server-driver";
import { startSyncPause } from "./sync-pause";

export function startLive(): () => void {
  const stopPause = startSyncPause();
  const stopRemoved = startRemovedNotices();
  const stopFiles = startFileNotices();
  const stopNotes = installNoteLive();
  const stopOverleaf = startOverleafLive();
  const stopLive = startCollabLive({
    started: startLiveTarget,
    drivers: [serverDriver(() => useCollabLiveStore.getState().refreshShare()), overleafDriver()],
  });
  const stopServers = watchServers();
  const stopNudges = startReconnectNudges();
  return () => {
    stopNudges();
    stopServers();
    stopLive();
    stopOverleaf();
    stopNotes();
    stopFiles();
    stopRemoved();
    stopPause();
  };
}
