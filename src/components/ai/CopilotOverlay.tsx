import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { PanelBottomClose, GripVertical } from "lucide-react";
import { ChatCore } from "@/components/ai/ChatCore";
import { useSettingsStore } from "@/store/settings";
import { clampRect, type Rect } from "@/lib/overlay-rect";

const KEY = "openleaf.ai.overlay.rect";

function loadRect(): Rect {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Rect;
  } catch {
    /* ignore */
  }
  const w = 440;
  const h = Math.min(720, window.innerHeight - 80);
  return { x: window.innerWidth - w - 24, y: 64, w, h };
}

export function CopilotOverlay() {
  const floating = useSettingsStore((s) => s.chatFloating);
  const setFloating = useSettingsStore((s) => s.setChatFloating);
  const [rect, setRect] = useState<Rect>(() =>
    clampRect(loadRect(), { width: window.innerWidth, height: window.innerHeight }),
  );

  const persist = useCallback((r: Rect) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(r));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!floating) return;
    const onResize = () =>
      setRect((r) => clampRect(r, { width: window.innerWidth, height: window.innerHeight }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [floating]);

  const startDrag = (mode: "move" | "resize", e: ReactPointerEvent) => {
    e.preventDefault();
    // Snapshot starting rect so move uses fixed offsets, not live rect stale state.
    let current = rect;
    const dx = e.clientX - rect.x;
    const dy = e.clientY - rect.y;

    const move = (ev: PointerEvent) => {
      const vp = { width: window.innerWidth, height: window.innerHeight };
      const next =
        mode === "move"
          ? { ...current, x: ev.clientX - dx, y: ev.clientY - dy }
          : { ...current, w: ev.clientX - current.x, h: ev.clientY - current.y };
      current = clampRect(next, vp);
      setRect(current);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      persist(current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!floating) return null;

  return createPortal(
    <div
      role="dialog"
      aria-label="AI assistant"
      data-testid="copilot-overlay"
      className="fixed z-[70] flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div
        data-testid="copilot-overlay-drag"
        onPointerDown={(e) => startDrag("move", e)}
        className="flex h-8 cursor-move items-center justify-between border-b bg-muted/40 px-2"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <GripVertical className="size-3.5" /> AI assistant
        </span>
        <button
          type="button"
          aria-label="Dock chat back to the sidebar"
          data-testid="copilot-overlay-dock"
          onClick={() => setFloating(false)}
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <PanelBottomClose className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ChatCore />
      </div>
      <div
        data-testid="copilot-overlay-resize"
        onPointerDown={(e) => startDrag("resize", e)}
        className="absolute bottom-0 right-0 size-4 cursor-nwse-resize"
      />
    </div>,
    document.body,
  );
}
