import { installNoteLive } from "../notes/note-live-port";
import { watchServers } from "../store";
import { startFileNotices } from "./file-notices";
import { startCollabLive } from "./live-store";
import { startLiveTarget } from "./note-slot";
import { startReconnectNudges } from "./reconnect-nudges";
import { startRemovedNotices } from "./removed-notices";
import { startSyncPause } from "./sync-pause";

export function startLive(): () => void {
  const stopPause = startSyncPause();
  const stopRemoved = startRemovedNotices();
  const stopFiles = startFileNotices();
  const stopNotes = installNoteLive();
  const stopLive = startCollabLive({ started: startLiveTarget });
  const stopServers = watchServers();
  const stopNudges = startReconnectNudges();
  return () => {
    stopNudges();
    stopServers();
    stopLive();
    stopNotes();
    stopFiles();
    stopRemoved();
    stopPause();
  };
}
