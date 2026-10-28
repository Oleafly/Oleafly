// Plain-text clipboard access for commands that run from a menu rather than
// from a copy or paste key. WKWebView and WebKitGTK refuse a clipboard read
// that no key press started, so the desktop app goes through the clipboard
// plugin; the browser dev server falls back to navigator.clipboard.
import { isTauri } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

export function readClipboardText(): Promise<string> {
  return isTauri() ? readText() : navigator.clipboard.readText();
}

export function writeClipboardText(text: string): Promise<void> {
  return isTauri() ? writeText(text) : navigator.clipboard.writeText(text);
}
