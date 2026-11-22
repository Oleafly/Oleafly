import { useSettingsStore } from "@/store/settings";

type SettingsKey = keyof ReturnType<typeof useSettingsStore.getState>;

export interface AppearanceStyle {
  variables: Readonly<Record<string, string>>;
  attributes: Readonly<Record<string, string | null>>;
}

const EMPTY_APPEARANCE_STYLE: AppearanceStyle = { variables: {}, attributes: {} };

export function writeAppearanceStyle(
  element: HTMLElement,
  next: AppearanceStyle,
  previous: AppearanceStyle = EMPTY_APPEARANCE_STYLE,
): AppearanceStyle {
  for (const name of Object.keys(previous.variables)) {
    if (!(name in next.variables)) element.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(next.variables)) {
    if (previous.variables[name] !== value) element.style.setProperty(name, value);
  }
  for (const name of Object.keys(previous.attributes)) {
    if (!(name in next.attributes)) element.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(next.attributes)) {
    if (previous.attributes[name] === value) continue;
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
  return next;
}

export function attachAppearanceStyle(
  element: HTMLElement,
  keys: readonly SettingsKey[],
  style: () => AppearanceStyle,
  watchers: readonly ((apply: () => void) => () => void)[] = [],
): () => void {
  let applied = writeAppearanceStyle(element, style());
  const apply = () => {
    applied = writeAppearanceStyle(element, style(), applied);
  };
  const stops = [
    useSettingsStore.subscribe((state, previous) => {
      if (keys.some((key) => state[key] !== previous[key])) apply();
    }),
    ...watchers.map((watch) => watch(apply)),
  ];
  return () => {
    for (const stop of stops) stop();
    writeAppearanceStyle(element, EMPTY_APPEARANCE_STYLE, applied);
  };
}
