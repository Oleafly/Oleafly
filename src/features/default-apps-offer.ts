import { logError } from "@/lib/log";
import { claimDefaultAppsOffer, type DefaultAppItemId, setSystemIntegration } from "@/lib/tauri";
import { useDefaultAppsOfferStore } from "@/store/default-apps-offer";

export async function offerDefaultAppsOnce(): Promise<void> {
  try {
    const offered = await claimDefaultAppsOffer();
    if (offered.length > 0) useDefaultAppsOfferStore.getState().open(offered);
  } catch (error) {
    void logError("offer to open documents with Oleafly", error);
  }
}

async function claimed(id: DefaultAppItemId): Promise<boolean> {
  try {
    const item = await setSystemIntegration(id, true);
    return item.state !== "needs_attention";
  } catch (error) {
    void logError(`make Oleafly the default for ${id}`, error);
    return false;
  }
}

export async function applyDefaultApps(): Promise<void> {
  const { chosen, setPhase } = useDefaultAppsOfferStore.getState();
  setPhase("applying");
  const results = await chosen.reduce<Promise<boolean[]>>(
    async (earlier, id) => [...(await earlier), await claimed(id)],
    Promise.resolve([]),
  );
  setPhase(results.every(Boolean) ? "done" : "failed");
}

export function dismissDefaultAppsOffer(): void {
  useDefaultAppsOfferStore.getState().setPhase("hidden");
}
