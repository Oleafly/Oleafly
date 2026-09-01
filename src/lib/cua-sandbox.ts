import type { CuaSurface } from "@oleafly/ai-tools";

// Bridges the harness browser pane to the CUA driver. The sandbox surface is
// a same-origin local document the agent may drive; cross-origin remote pages
// stay observation-only (the browser's own security model forbids scripting
// them), so the agent reads and navigates but cannot click into another
// origin. This keeps the computer-use loop strictly local-only.
let currentSurface: CuaSurface | null = null;

export function registerCuaSurface(surface: CuaSurface | null): void {
  currentSurface = surface;
}

export function activeCuaSurface(): CuaSurface | null {
  return currentSurface;
}
