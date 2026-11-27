import { useEffect, useState } from "react";
import { logError } from "@/lib/log";
import { overleafBrowserIcons } from "@/lib/overleaf";

export function useBrowserIcons(): Record<string, string> {
  const [icons, setIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    overleafBrowserIcons()
      .then((found) => {
        if (live) setIcons(found);
      })
      .catch((error: unknown) => void logError("load browser icons", error));
    return () => {
      live = false;
    };
  }, []);
  return icons;
}
