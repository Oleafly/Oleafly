import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// So macOS traffic-light padding can be dropped when the lights are
// overlaid (fullscreen).
export function useFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const win = getCurrentWindow();
        setFullscreen(await win.isFullscreen());
        unlisten = await win.onResized(async () => {
          try {
            setFullscreen(await win.isFullscreen());
          } catch {
            /* ignore */
          }
        });
      } catch {
        /* not running in Tauri */
      }
      if (cancelled && unlisten) unlisten();
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  return fullscreen;
}
