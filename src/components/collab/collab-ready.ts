import { useEffect, useState } from "react";
import { i18n, loadNamespace } from "@/i18n";
import { useSettingsStore } from "@/store/settings";

// True once live collaboration is on and its strings are loaded.
export function useCollabReady(): boolean {
  const enabled = useSettingsStore((state) => state.liveCollaboration);
  const [loaded, setLoaded] = useState(() => i18n.hasResourceBundle("en", "collab"));
  useEffect(() => {
    if (!enabled || loaded) return;
    let active = true;
    loadNamespace("collab").then(
      () => {
        if (active) setLoaded(true);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [enabled, loaded]);
  return enabled && loaded;
}
