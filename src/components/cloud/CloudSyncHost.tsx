import { type ComponentType, lazy, useEffect, useState } from "react";
import { cloudState } from "@/lib/cloud";
import { mountOnFirstOpen } from "@/lib/mount-on-first-open";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const CloudSyncKeeper = lazy<ComponentType>(() =>
  import("@/components/cloud/CloudSyncKeeper").catch(() => ({ default: () => null })),
);

function useKeeperWanted(): boolean {
  const settingsOpen = useSettingsStore((s) => s.settingsOpen);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let live = true;
    cloudState().then(
      (state) => {
        if (live && state.status !== "disconnected") setConnected(true);
      },
      () => {
        if (live) setConnected(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return connected || settingsOpen;
}

export const CloudSyncHost = mountOnFirstOpen(CloudSyncKeeper, useKeeperWanted, undefined, {
  useResetKey: () => useFilesStore((s) => s.projectId),
});
