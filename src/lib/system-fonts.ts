import { invoke } from "@tauri-apps/api/core";

export interface SystemFontFamily {
  readonly name: string;
  readonly monospace: boolean;
}

let cached: readonly SystemFontFamily[] | null = null;
let inFlight: Promise<readonly SystemFontFamily[]> | null = null;

export function cachedSystemFonts(): readonly SystemFontFamily[] | null {
  return cached;
}

export function listSystemFonts(): Promise<readonly SystemFontFamily[]> {
  inFlight ??= invoke<SystemFontFamily[]>("list_system_fonts")
    .then((families) => {
      cached = families;
      return families;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function resetSystemFontsCache(): void {
  cached = null;
  inFlight = null;
}
