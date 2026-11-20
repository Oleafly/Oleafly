import { type FocusEvent, type MouseEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ZoomBar } from "@/components/ui/zoom-bar";
import { DEFAULT_APP_ZOOM, useAppZoomFeedback, zoomApp } from "@/lib/app-zoom";
import { cn } from "@/lib/utils";
import { APP_ZOOM_LEVELS, useSettingsStore } from "@/store/settings";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";

export const APP_ZOOM_INDICATOR_MS = 2000;

const SMALLEST = APP_ZOOM_LEVELS[0];
const LARGEST = APP_ZOOM_LEVELS[APP_ZOOM_LEVELS.length - 1];

function keepFocus(event: MouseEvent) {
  event.preventDefault();
}

export function AppZoomIndicator() {
  const { t } = useTranslation(["shell"]);
  const level = useSettingsStore((state) => state.appZoom);
  const shown = useAppZoomFeedback((state) => state.shown);
  const bindings = useShortcutStore((state) => state.bindings);
  const [dismissed, setDismissed] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const visible = shown !== dismissed;

  useEffect(() => {
    if (hovered || focused || shown === dismissed) return;
    const timer = setTimeout(() => setDismissed(shown), APP_ZOOM_INDICATOR_MS);
    return () => clearTimeout(timer);
  }, [shown, dismissed, hovered, focused]);

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
  };
  const zoomOut = t(($) => $.shell.commands.zoomOut.label);
  const zoomIn = t(($) => $.shell.commands.zoomIn.label);

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-8 z-[130] flex justify-center">
      <ZoomBar
        aria-label={t(($) => $.shell.zoomIndicator.label)}
        data-testid="app-zoom-indicator"
        data-state={visible ? "open" : "closed"}
        onMouseDown={keepFocus}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={onBlur}
        className={cn(
          "pointer-events-auto transition-[opacity,translate,visibility] duration-200 motion-reduce:transition-none",
          !visible && "invisible translate-y-2 opacity-0",
        )}
        value={level / 100}
        min={SMALLEST / 100}
        max={LARGEST / 100}
        onStep={zoomApp}
        onReset={() => zoomApp(0)}
        resetLabel={t(($) => $.shell.zoomIndicator.reset)}
        resetDisabled={level === DEFAULT_APP_ZOOM}
        labels={{
          zoomOut,
          zoomIn,
          zoomOutTooltip: t(($) => $.shell.rail.withShortcut, { label: zoomOut, shortcut: shortcutLabel(bindings.zoomOut) }),
          zoomInTooltip: t(($) => $.shell.rail.withShortcut, { label: zoomIn, shortcut: shortcutLabel(bindings.zoomIn) }),
        }}
      />
    </div>,
    document.body,
  );
}
