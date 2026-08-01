import { getConfig, type AppConfig } from "@/lib/tauri";

// Several boot-path consumers each issued their own get_config IPC within
// the same second. Single-flight the read; the ai-config-changed event (the
// app's existing "config was written" signal) invalidates the cache.

let cached: Promise<AppConfig> | null = null;

export function getConfigCached(): Promise<AppConfig> {
  cached ??= getConfig().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

export function invalidateConfigCache(): void {
  cached = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("oleafly:ai-config-changed", invalidateConfigCache);
}
