import { type ComponentType, lazy, Suspense } from "react";

const CloudSyncKeeper = lazy<ComponentType>(() =>
  import("@/components/cloud/CloudSyncKeeper").catch(() => ({ default: () => null })),
);

export function CloudSyncHost() {
  return (
    <Suspense fallback={null}>
      <CloudSyncKeeper />
    </Suspense>
  );
}
