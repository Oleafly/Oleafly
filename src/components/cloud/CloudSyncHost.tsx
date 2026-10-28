import { type ComponentType, lazy, useEffect, useState } from "react";
import { cloudState } from "@/lib/cloud";
import { mountOnFirstOpen } from "@/lib/mount-on-first-open";
import { useSettingsStore } from "@/store/settings";

const CloudSyncKeeper = lazy<ComponentType>(() =>
  import("@/components/cloud/CloudSyncKeeper").catch(() => ({ default: () => null })),
);

// With no cloud account on this computer there is nothing to keep in sync, so
// the keeper and the cloud store wait for Settings, where the account is added.
function useKeeperWanted(): boolean {
  const settingsOpen = useSettingsStore((s) => s.settingsOpen);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let live = true;
    cloudState().then(
      (state) => {
        if (live && state.status !== "disconnected") setConnected(true);
      },
      // The keeper reports a failed check, as it always has.
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

export const CloudSyncHost = mountOnFirstOpen(CloudSyncKeeper, useKeeperWanted);
