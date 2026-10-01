import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { usesNativeDockMenu } from "@/lib/native-dock-shortcuts";
import { togglePersonalDetails, usePersonalDetailsStore } from "@/store/personal-details";

/** Sent by the View menu's "Hide Personal Details" item (src-tauri/src/menu.rs). */
export const PERSONAL_DETAILS_MENU_EVENT = "menu://toggle-personal-details";

function syncCheckMark(hidden: boolean): void {
  invoke("set_personal_details_hidden", { hidden }).catch((error: unknown) =>
    console.error("Failed to sync the personal details menu item", error),
  );
}

/**
 * Connects the View menu item to screenshot mode. The check mark follows the
 * mode whichever way it was turned on, including after a reload, which
 * resets the mode but not the native menu. Windows has no native menu bar.
 */
export async function startPersonalDetailsMenuBridge(): Promise<() => void> {
  if (!usesNativeDockMenu()) return () => {};
  syncCheckMark(usePersonalDetailsStore.getState().hidden);
  const unsubscribe = usePersonalDetailsStore.subscribe((state, previous) => {
    if (state.hidden !== previous.hidden) syncCheckMark(state.hidden);
  });
  const unlisten = await listen(PERSONAL_DETAILS_MENU_EVENT, () => togglePersonalDetails());
  return () => {
    unsubscribe();
    unlisten();
  };
}
