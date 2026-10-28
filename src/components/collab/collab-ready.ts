import { useEffect, useState } from "react";
import { i18n, loadNamespace } from "@/i18n";

// True once the collaboration strings are loaded.
export function useCollabReady(): boolean {
  const [loaded, setLoaded] = useState(() => i18n.hasResourceBundle("en", "collab"));
  useEffect(() => {
    if (loaded) return;
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
  }, [loaded]);
  return loaded;
}
