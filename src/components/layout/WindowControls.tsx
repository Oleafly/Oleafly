import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { isWindows } from "@/lib/utils";

export function WindowControls() {
  const { t } = useTranslation(["common", "shell"]);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isWindows) return;
    const win = getCurrentWindow();
    let active = true;
    const sync = () =>
      win
        .isMaximized()
        .then((m) => {
          if (active) setMaximized(m);
        })
        .catch(() => {});
    sync();
    const unlisten = win.onResized(sync);
    return () => {
      active = false;
      unlisten.then((u) => u()).catch(() => {});
    };
  }, []);

  if (!isWindows) return null;

  const win = getCurrentWindow();
  const base =
    "flex w-[46px] shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

  return (
    <fieldset
      className="m-0 flex h-12 shrink-0 border-0 p-0"
      aria-label={t(($) => $.shell.windowControls.group)}
    >
      <div className="mx-1 h-5 w-px shrink-0 self-center bg-border" />
      <button
        type="button"
        aria-label={t(($) => $.shell.windowControls.minimize)}
        className={base}
        onClick={() => void win.minimize()}
      >
        <Minus className="size-4" />
      </button>
      <button
        type="button"
        aria-label={
          maximized
            ? t(($) => $.shell.windowControls.restore)
            : t(($) => $.shell.windowControls.maximize)
        }
        className={base}
        onClick={() => void win.toggleMaximize()}
      >
        {maximized ? <Copy className="size-3.5" /> : <Square className="size-3" />}
      </button>
      <button
        type="button"
        aria-label={t(($) => $.common.actions.close)}
        className="flex w-[46px] shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-[#e81123] hover:text-white"
        onClick={() => void win.close()}
      >
        <X className="size-4" />
      </button>
    </fieldset>
  );
}
