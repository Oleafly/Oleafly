import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";

export function safeHttpUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return url.toString();
}

export async function openInSystemBrowser(url: string): Promise<boolean> {
  const safe = safeHttpUrl(url);
  if (!safe) return false;
  if (isTauri()) {
    try {
      await open(safe);
      return true;
    } catch {
      return false;
    }
  }
  return Boolean(window.open(safe, "_blank", "noopener,noreferrer"));
}
