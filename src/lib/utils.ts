import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const GLASS_PANEL =
  "border border-white/25 bg-white/12 text-foreground shadow-[0_20px_60px_-12px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.25)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-white/8 dark:shadow-[0_20px_60px_-12px_rgba(0,0,0,0.6),inset_0_1px_0_0_rgba(255,255,255,0.08)]";

export const WHITE_PANEL = "force-light-surface border border-border shadow-xl";

// Used to reserve space for the traffic-light buttons and to pick the right
// modifier glyphs in shortcut hints.
export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export const modKey = isMac ? "⌘" : "Ctrl";
export const altKey = isMac ? "⌥" : "Alt";
export const shiftKey = isMac ? "⇧" : "Shift";

// Pass the mac glyph form (e.g. "⌘↵", "⌘⇧F"); on Windows/Linux it becomes
// "Ctrl+Enter", "Ctrl+Shift+F". The keyboard handlers already fire on Ctrl
// too - this only fixes the displayed label so non-Mac users don't see ⌘.
//
// Do NOT use for strings that already spell out both (e.g. "⌘/Ctrl-click").
//
// `onMac` defaults to the detected platform; it is a parameter only so the
// conversion is deterministically unit-testable (call sites omit it).
export function shortcut(mac: string, onMac: boolean = isMac): string {
  if (onMac) return mac;
  return mac
    .replace(/⌘/g, "Ctrl+")
    .replace(/⌃/g, "Ctrl+")
    .replace(/⌥/g, "Alt+")
    .replace(/⇧/g, "Shift+")
    .replace(/↵|⏎/g, "Enter");
}

