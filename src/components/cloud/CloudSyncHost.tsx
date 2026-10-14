import { useSettingsStore } from "@/store/settings";
import { type ComponentType, lazy, Suspense } from "react";

const CloudSyncKeeper = lazy<ComponentType>(() =>
  import("@/components/cloud/CloudSyncKeeper").catch(() => ({ default: () => null })),
);

export function CloudSyncHost() {
  const cloudSync = useSettingsStore((s) => s.cloudSync);
  if (!cloudSync) return null;
  return (
    <Suspense fallback={null}>
      <CloudSyncKeeper />
    </Suspense>
  );
}
