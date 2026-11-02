import { useSyncExternalStore } from "react";

/** Which icons the app draws: the neutral line icons, or the downloadable colour pack. */
export type IconPack = "neutral" | "color";

export const ICON_PACKS: readonly IconPack[] = ["neutral", "color"];

/** One element of a colour icon, already checked against the allowed SVG subset. */
export type SvgNode = Readonly<{ tag: string; props: Readonly<Record<string, unknown>>; children: readonly SvgNode[] }>;

export type InstalledIconPack = Readonly<{
  css: string;
  defs: readonly SvgNode[];
  icons: Readonly<Record<string, readonly SvgNode[]>>;
}>;

type State = Readonly<{ selected: IconPack; installed: InstalledIconPack | null }>;

// Kept apart from the settings store so every icon can read it without pulling the store in.
let state: State = { selected: "neutral", installed: null };
const listeners = new Set<() => void>();

function update(next: Partial<State>) {
  state = { ...state, ...next };
  if (typeof document !== "undefined") {
    document.documentElement.dataset.iconPack = state.selected === "color" && state.installed ? "color" : "neutral";
  }
  for (const listener of listeners) listener();
}

export function getIconPackState(): State {
  return state;
}

export function setIconPack(selected: IconPack): void {
  if (selected !== state.selected) update({ selected });
}

export function setInstalledIconPack(installed: InstalledIconPack | null): void {
  update({ installed });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useIconPackState(): State {
  return useSyncExternalStore(subscribe, getIconPackState, getIconPackState);
}

/** The colour drawing for an icon, or null when the neutral pack is showing or it has none. */
export function useColorDrawing(name: string): readonly SvgNode[] | null {
  const { selected, installed } = useIconPackState();
  return selected === "color" ? (installed?.icons[name] ?? null) : null;
}
