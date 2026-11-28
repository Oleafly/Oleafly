import { logError } from "@/lib/log";
import { claimDefaultAppsOffer, setSystemIntegration } from "@/lib/tauri";
import { useDefaultAppsOfferStore } from "@/store/default-apps-offer";

export async function offerDefaultAppsOnce(): Promise<void> {
  try {
    const offered = await claimDefaultAppsOffer();
    if (offered.length > 0) useDefaultAppsOfferStore.getState().open(offered);
  } catch (error) {
    void logError("offer to open documents with Oleafly", error);
  }
}

export async function applyDefaultApps(): Promise<void> {
  const { chosen, setPhase } = useDefaultAppsOfferStore.getState();
  setPhase("applying");
  let failed = false;
  for (const id of chosen) {
    try {
      const item = await setSystemIntegration(id, true);
      if (item.state === "needs_attention") failed = true;
    } catch (error) {
      void logError(`make Oleafly the default for ${id}`, error);
      failed = true;
    }
  }
  setPhase(failed ? "failed" : "done");
}

export function dismissDefaultAppsOffer(): void {
  useDefaultAppsOfferStore.getState().setPhase("hidden");
}
