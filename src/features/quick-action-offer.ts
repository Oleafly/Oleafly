import { logError } from "@/lib/log";
import { claimQuickActionOffer, setSystemIntegration } from "@/lib/tauri";
import { isMac } from "@/lib/utils";
import { useQuickActionOfferStore } from "@/store/quick-action-offer";

export async function offerQuickActionOnce(mac: boolean = isMac): Promise<void> {
  if (!mac) return;
  try {
    if (await claimQuickActionOffer()) useQuickActionOfferStore.getState().setPhase("offer");
  } catch (error) {
    void logError("offer the Finder Quick Action", error);
  }
}

export async function addQuickAction(): Promise<void> {
  const { setPhase } = useQuickActionOfferStore.getState();
  setPhase("adding");
  try {
    const item = await setSystemIntegration("quick_action", true);
    setPhase(item.state === "installed" ? "added" : "failed");
  } catch (error) {
    void logError("add the Finder Quick Action", error);
    setPhase("failed");
  }
}

export function dismissQuickActionOffer(): void {
  useQuickActionOfferStore.getState().setPhase("hidden");
}
