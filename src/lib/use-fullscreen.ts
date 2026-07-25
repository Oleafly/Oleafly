import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

function safelyUnlisten(unlisten: (() => void) | undefined): void {
  if (!unlisten) return;
  try {
    // Tauri types this as void, but some bridges return a promise. During a
    // webview reload that promise can reject after the listener registry has
    // already gone away, so absorb both synchronous and asynchronous teardown.
    const pending = unlisten() as unknown;
    if (
      pending &&
      typeof (pending as { then?: unknown }).then === "function"
    ) {
      void Promise.resolve(pending).catch(() => {});
    }
  } catch {
    /* listener was already removed with the webview */
  }
}

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
      if (cancelled) safelyUnlisten(unlisten);
    })();
    return () => {
      cancelled = true;
      safelyUnlisten(unlisten);
    };
  }, []);

  return fullscreen;
}
