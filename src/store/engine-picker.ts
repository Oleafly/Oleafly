import { create } from "zustand";
import type { ImportCompatFinding } from "@oleafly/latex";

export type EnginePickerSource = "project-open" | "compile-failure" | "manual";

interface EnginePickerStore {
  open: boolean;
  source: EnginePickerSource;
  findings: ImportCompatFinding[];
  openPicker: (source: EnginePickerSource, findings: ImportCompatFinding[]) => void;
  close: () => void;
}

export const useEnginePickerStore = create<EnginePickerStore>((set) => ({
  open: false,
  source: "manual",
  findings: [],
  openPicker: (source, findings) => set({ open: true, source, findings }),
  close: () => set({ open: false }),
}));

// --- "Don't nag" memory -------------------------------------------------------
//
// The project-open hint is shown once per project per set of findings. Choosing
// "Keep using Tectonic" (or dismissing the toast) records the finding signature;
// the hint returns only when a NEW gap appears (e.g. the user adds minted).
// Compile-failure prompts are not gated: a failing compile is worth interrupting.

const dismissKey = (projectId: string) => `oleafly.engineHint.${projectId}`;

export function engineHintDismissed(
  projectId: string,
  findings: ImportCompatFinding[],
): boolean {
  try {
    const stored = localStorage.getItem(dismissKey(projectId));
    if (stored === null) return false;
    const seen = new Set(stored.split(","));
    return findings.every((finding) => seen.has(finding.id));
  } catch {
    return false;
  }
}

export function dismissEngineHint(
  projectId: string,
  findings: ImportCompatFinding[],
): void {
  try {
    const previous = localStorage.getItem(dismissKey(projectId));
    const merged = new Set(previous ? previous.split(",").filter(Boolean) : []);
    for (const finding of findings) merged.add(finding.id);
    localStorage.setItem(dismissKey(projectId), [...merged].sort().join(","));
  } catch {
    /* best-effort memory */
  }
}
