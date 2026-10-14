import { watchSettingsSources } from "@/lib/settings-file/transfer";
import { useCloudStore } from "@/store/cloud";
import { useSettingsStore } from "@/store/settings";
import { useEffect } from "react";

const SYNC_INTERVAL_MS = 60_000;
const SETTINGS_DEBOUNCE_MS = 2_000;

export function CloudSyncKeeper() {
  const cloudSync = useSettingsStore((s) => s.cloudSync);

  useEffect(() => {
    if (!cloudSync) return;
    let cancelled = false;
    const run = async () => {
      await useCloudStore.getState().refresh();
      if (!cancelled) await useCloudStore.getState().syncNow();
    };
    void run();
    const timer = window.setInterval(() => {
      void useCloudStore.getState().syncNow();
    }, SYNC_INTERVAL_MS);
    let debounce = 0;
    const stopWatching = watchSettingsSources(() => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        void useCloudStore.getState().syncNow();
      }, SETTINGS_DEBOUNCE_MS);
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(debounce);
      stopWatching();
    };
  }, [cloudSync]);

  return null;
}
