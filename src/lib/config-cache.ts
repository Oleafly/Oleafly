import { getConfig, type AppConfig } from "@/lib/tauri";

let cached: Promise<AppConfig> | null = null;

export function getConfigCached(): Promise<AppConfig> {
  cached ??= getConfig().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

export function primeConfigCache(config: AppConfig): void {
  cached ??= Promise.resolve(config);
}

export function invalidateConfigCache(): void {
  cached = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("oleafly:ai-config-changed", invalidateConfigCache);
}
