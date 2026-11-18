import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const GLASS_PANEL =
  "border border-black/10 bg-background/55 text-foreground shadow-[0_10px_36px_-10px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.7)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/12 dark:bg-background/45 dark:shadow-[0_10px_36px_-10px_rgba(0,0,0,0.7),inset_0_1px_0_0_rgba(255,255,255,0.1)]";

export const WHITE_PANEL = "border border-border bg-card shadow-xl";

export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export const isWindows =
  typeof navigator !== "undefined" && /Win/.test(navigator.platform || navigator.userAgent);

export const isLinux =
  typeof navigator !== "undefined" && /Linux/.test(navigator.platform || navigator.userAgent);

export const modKey = isMac ? "⌘" : "Ctrl";
export const altKey = isMac ? "⌥" : "Alt";
export const shiftKey = isMac ? "⇧" : "Shift";

export function shortcut(mac: string, onMac: boolean = isMac): string {
  if (onMac) return mac;
  return mac
    .replaceAll("⌘", "Ctrl+")
    .replaceAll("⌃", "Ctrl+")
    .replaceAll("⌥", "Alt+")
    .replaceAll("⇧", "Shift+")
    .replaceAll(/[↵⏎]/g, "Enter");
}

