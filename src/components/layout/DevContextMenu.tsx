import { useEffect, useState } from "react";
import { Bug, RefreshCw } from "lucide-react";
import { openDevtools } from "@/lib/tauri";

// Yields to component-level context menus (e.g. the editor's) by bailing
// when the event was already handled (`defaultPrevented`).
export function DevContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onContext = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    };
    document.addEventListener("contextmenu", onContext);
    return () => document.removeEventListener("contextmenu", onContext);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (!import.meta.env.DEV || !menu) return null;

  const left = Math.min(menu.x, window.innerWidth - 176);
  const top = Math.min(menu.y, window.innerHeight - 88);

  return (
    <div
      className="fixed z-[300] min-w-[160px] overflow-hidden rounded-md border bg-popover p-1 text-sm shadow-lg"
      style={{ top, left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          setMenu(null);
          window.location.reload();
        }}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
      >
        <RefreshCw className="size-3.5 text-muted-foreground" /> Refresh App
      </button>
      <button
        type="button"
        onClick={() => {
          setMenu(null);
          void openDevtools();
        }}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
      >
        <Bug className="size-3.5 text-muted-foreground" /> Inspect
      </button>
    </div>
  );
}
