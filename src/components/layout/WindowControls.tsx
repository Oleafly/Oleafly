import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { Copy, Minus, Square, X } from "lucide-react";
import { cn, isWindows } from "@/lib/utils";
import { useFullscreen } from "@/lib/use-fullscreen";

// The main window has no native chrome on Windows (tauri.windows.conf.json
// sets decorations: false so it matches macOS's borderless-overlay look
// instead of the stock opaque titlebar); these buttons are the replacement.
// macOS keeps its native traffic lights, Linux keeps native decorations, so
// this only renders on Windows.
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const fullscreen = useFullscreen();

  useEffect(() => {
    if (!isWindows || !isTauri()) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized);
    void win.onResized(() => {
      void win.isMaximized().then(setMaximized);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  if (!isWindows || !isTauri() || fullscreen) return null;

  const btn = "flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground";

  return (
    <div className="fixed right-0 top-0 z-[100] flex h-9">
      <button
        type="button"
        aria-label="Minimize"
        className={btn}
        onClick={() => void getCurrentWindow().minimize()}
      >
        <Minus className="size-4" />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        className={btn}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        {maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
      </button>
      <button
        type="button"
        aria-label="Close"
        className={cn(btn, "hover:bg-red-600 hover:text-white")}
        onClick={() => void getCurrentWindow().close()}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

// Width to reserve on the right edge of any header so its content doesn't
// sit under the buttons above (mirrors the isMac pl-[78px] reservation for
// the traffic lights on the left).
export const WINDOW_CONTROLS_WIDTH_PX = 132;
