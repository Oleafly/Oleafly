import type { Theme } from "@/lib/theme";
import type { ThemeTokenOverrides } from "@/lib/theme-customization";

export type ThemePalette = Readonly<{
  background: string;
  foreground: string;
  sidebar: string;
  card: string;
  popover: string;
  muted: string;
  mutedForeground: string;
  hover: string;
  selected: string;
  border: string;
  input: string;
  primary: string;
  codeBlock: string;
  pdfPage?: string;
  pdfText?: string;
  radius?: string;
}>;

export type ThemePreset = Readonly<{
  id: string;
  name: string;
  mode: Theme;
  palette: ThemePalette;
  builtIn?: true;
}>;

export const DEFAULT_THEME_PRESET = "oleafly";

export const THEME_PRESET_STORAGE_KEYS: Readonly<Record<Theme, string>> = {
  light: "oleafly.appTheme.light",
  dark: "oleafly.appTheme.dark",
};

const ONE_DARK_PRO: ThemePalette = {
  background: "#282c34",
  foreground: "#abb2bf",
  sidebar: "#21252b",
  card: "#21252b",
  popover: "#21252b",
  muted: "#2c313a",
  mutedForeground: "#9aa0ab",
  hover: "#2c313a",
  selected: "#323842",
  border: "#181a1f",
  input: "#3e4452",
  primary: "#4570c4",
  codeBlock: "#21252b",
  pdfPage: "#2c313a",
  pdfText: "#c8ccd4",
  radius: "0.375rem",
};

const LIGHT_PRESETS: readonly ThemePreset[] = [
  {
    id: DEFAULT_THEME_PRESET,
    name: "Oleafly",
    mode: "light",
    builtIn: true,
    palette: {
      background: "#ffffff",
      foreground: "#0a0a0a",
      sidebar: "#f8f8f8",
      card: "#fafafa",
      popover: "#fafafa",
      muted: "#f2f2f2",
      mutedForeground: "#737373",
      hover: "#f2f2f2",
      selected: "#ededed",
      border: "#e5e5e5",
      input: "#e5e5e5",
      primary: "#2563eb",
      codeBlock: "#f8f8f8",
    },
  },
  {
    id: "charcoal",
    name: "Charcoal",
    mode: "light",
    palette: {
      background: "#ffffff",
      foreground: "#181818",
      sidebar: "#f5f5f5",
      card: "#ffffff",
      popover: "#ffffff",
      muted: "#ececec",
      mutedForeground: "#6b6b6b",
      hover: "#f0f0f0",
      selected: "#e6e6e6",
      border: "#e5e5e5",
      input: "#e5e5e5",
      primary: "#1f6fd1",
      codeBlock: "#f5f5f5",
    },
  },
  {
    id: "ink",
    name: "Ink",
    mode: "light",
    palette: {
      background: "#ffffff",
      foreground: "#0d0d0d",
      sidebar: "#f9f9f9",
      card: "#ffffff",
      popover: "#ffffff",
      muted: "#ececec",
      mutedForeground: "#5d5d5d",
      hover: "#f3f3f3",
      selected: "#ececec",
      border: "#e8e8e8",
      input: "#e3e3e3",
      primary: "#1f6fd1",
      codeBlock: "#f4f4f4",
      radius: "0.75rem",
    },
  },
  {
    id: "quiet-gray",
    name: "Quiet gray",
    mode: "light",
    palette: {
      background: "#ffffff",
      foreground: "#0d0d0d",
      sidebar: "#fafafb",
      card: "#ffffff",
      popover: "#ffffff",
      muted: "#f1f1f3",
      mutedForeground: "#5f5f73",
      hover: "#f1f1f3",
      selected: "#ececf0",
      border: "#e6e6ec",
      input: "#e6e6ec",
      primary: "#1f6fd1",
      codeBlock: "#f4f4f7",
      radius: "0.3125rem",
    },
  },
  {
    id: "atom-one-light",
    name: "Atom One Light",
    mode: "light",
    palette: {
      background: "#fafafa",
      foreground: "#383a42",
      sidebar: "#eaeaeb",
      card: "#ffffff",
      popover: "#ffffff",
      muted: "#e5e5e6",
      mutedForeground: "#616470",
      hover: "#e5e5e6",
      selected: "#dbdbdc",
      border: "#dbdbdc",
      input: "#dbdbdc",
      primary: "#4d64e8",
      codeBlock: "#eaeaeb",
      radius: "0.375rem",
    },
  },
  {
    id: "github-light",
    name: "GitHub Light",
    mode: "light",
    palette: {
      background: "#ffffff",
      foreground: "#1f2328",
      sidebar: "#f6f8fa",
      card: "#ffffff",
      popover: "#ffffff",
      muted: "#eff2f5",
      mutedForeground: "#656d76",
      hover: "#f3f5f7",
      selected: "#eaeef2",
      border: "#d0d7de",
      input: "#d0d7de",
      primary: "#0969da",
      codeBlock: "#f6f8fa",
      radius: "0.375rem",
    },
  },
  {
    id: "islands-light",
    name: "Islands Light",
    mode: "light",
    palette: {
      background: "#ffffff",
      foreground: "#080808",
      sidebar: "#ffffff",
      card: "#ffffff",
      popover: "#ffffff",
      muted: "#ebecf0",
      mutedForeground: "#66696f",
      hover: "#eef0f4",
      selected: "#d0dffe",
      border: "#e4e6eb",
      input: "#c9ccd6",
      primary: "#3871e1",
      codeBlock: "#f7f8fa",
      radius: "0.5rem",
    },
  },
];

const DARK_PRESETS: readonly ThemePreset[] = [
  {
    id: DEFAULT_THEME_PRESET,
    name: "Oleafly",
    mode: "dark",
    builtIn: true,
    palette: {
      background: "#0a0a0a",
      foreground: "#fafafa",
      sidebar: "#171717",
      card: "#171717",
      popover: "#121212",
      muted: "#262626",
      mutedForeground: "#a3a3a3",
      hover: "#262626",
      selected: "#262626",
      border: "#232323",
      input: "#2e2e2e",
      primary: "#2563eb",
      codeBlock: "#262626",
    },
  },
  {
    id: "charcoal",
    name: "Charcoal",
    mode: "dark",
    palette: {
      background: "#181818",
      foreground: "#ececec",
      sidebar: "#242424",
      card: "#1e1e1e",
      popover: "#262626",
      muted: "#2c2c2c",
      mutedForeground: "#a3a3a3",
      hover: "#2e2e2e",
      selected: "#3d3d3d",
      border: "#343434",
      input: "#3b3b3b",
      primary: "#1f6fd1",
      codeBlock: "#242424",
      pdfPage: "#2e2e2e",
      pdfText: "#dcdcdc",
    },
  },
  {
    id: "ink",
    name: "Ink",
    mode: "dark",
    palette: {
      background: "#212121",
      foreground: "#ececec",
      sidebar: "#181818",
      card: "#2a2a2a",
      popover: "#353535",
      muted: "#2a2a2a",
      mutedForeground: "#9b9b9b",
      hover: "#2f2f2f",
      selected: "#303030",
      border: "#343434",
      input: "#3a3a3a",
      primary: "#1f6fd1",
      codeBlock: "#171717",
      pdfPage: "#262626",
      pdfText: "#dedede",
      radius: "0.75rem",
    },
  },
  {
    id: "quiet-gray",
    name: "Quiet gray",
    mode: "dark",
    palette: {
      background: "#18181b",
      foreground: "#ececf1",
      sidebar: "#131316",
      card: "#1f1f24",
      popover: "#1b1b1f",
      muted: "#26262c",
      mutedForeground: "#a9a9bc",
      hover: "#232329",
      selected: "#2c2c34",
      border: "#26262c",
      input: "#2e2e35",
      primary: "#1f6fd1",
      codeBlock: "#0f0f12",
      pdfPage: "#1f1f24",
      pdfText: "#d8d8e0",
      radius: "0.3125rem",
    },
  },
  { id: "one-dark-pro", name: "One Dark Pro", mode: "dark", palette: ONE_DARK_PRO },
  {
    id: "one-dark-pro-darker",
    name: "One Dark Pro Darker",
    mode: "dark",
    palette: {
      ...ONE_DARK_PRO,
      background: "#23272e",
      sidebar: "#1e2227",
      card: "#1e2227",
      popover: "#1e2227",
      codeBlock: "#1e2227",
    },
  },
  {
    id: "one-dark-pro-flat",
    name: "One Dark Pro Flat",
    mode: "dark",
    palette: { ...ONE_DARK_PRO, sidebar: "#282c34", border: "#23252c" },
  },
  {
    id: "github-dark",
    name: "GitHub Dark",
    mode: "dark",
    palette: {
      background: "#0d1117",
      foreground: "#e6edf3",
      sidebar: "#010409",
      card: "#161b22",
      popover: "#161b22",
      muted: "#21262d",
      mutedForeground: "#8b949e",
      hover: "#181d24",
      selected: "#262c36",
      border: "#30363d",
      input: "#30363d",
      primary: "#1f6feb",
      codeBlock: "#161b22",
      pdfPage: "#161b22",
      pdfText: "#e6edf3",
      radius: "0.375rem",
    },
  },
  {
    id: "islands-dark",
    name: "Islands Dark",
    mode: "dark",
    palette: {
      background: "#191a1c",
      foreground: "#d1d3d9",
      sidebar: "#191a1c",
      card: "#26282c",
      popover: "#26282c",
      muted: "#2b2d30",
      mutedForeground: "#9a9da4",
      hover: "#2b2d30",
      selected: "#2a4371",
      border: "#33353b",
      input: "#43454a",
      primary: "#3871e1",
      codeBlock: "#1e1f22",
      pdfPage: "#2b2d30",
      pdfText: "#d1d3d9",
      radius: "0.5rem",
    },
  },
  {
    id: "jetbrains-dark",
    name: "JetBrains Dark",
    mode: "dark",
    palette: {
      background: "#1e1f22",
      foreground: "#dfe1e5",
      sidebar: "#2b2d30",
      card: "#2b2d30",
      popover: "#2b2d30",
      muted: "#393b40",
      mutedForeground: "#a8abb2",
      hover: "#393b40",
      selected: "#2e436e",
      border: "#393b40",
      input: "#4e5157",
      primary: "#3871e1",
      codeBlock: "#2b2d30",
      pdfPage: "#313438",
      pdfText: "#dfe1e5",
      radius: "0.5rem",
    },
  },
  {
    id: "darcula",
    name: "Darcula",
    mode: "dark",
    palette: {
      background: "#2b2b2b",
      foreground: "#bbbbbb",
      sidebar: "#3c3f41",
      card: "#3c3f41",
      popover: "#3c3f41",
      muted: "#45494a",
      mutedForeground: "#acacac",
      hover: "#46494b",
      selected: "#214283",
      border: "#515151",
      input: "#646464",
      primary: "#4b6eaf",
      codeBlock: "#313335",
      pdfPage: "#313335",
      pdfText: "#bbbbbb",
      radius: "0.25rem",
    },
  },
];

const PRESETS: Readonly<Record<Theme, readonly ThemePreset[]>> = { light: LIGHT_PRESETS, dark: DARK_PRESETS };

export function themePresets(mode: Theme): readonly ThemePreset[] {
  return PRESETS[mode];
}

export function themePresetIds(mode: Theme): readonly string[] {
  return PRESETS[mode].map((preset) => preset.id);
}

export function isThemePresetId(mode: Theme, value: unknown): value is string {
  return typeof value === "string" && PRESETS[mode].some((preset) => preset.id === value);
}

export function findThemePreset(mode: Theme, id: unknown): ThemePreset {
  return PRESETS[mode].find((preset) => preset.id === id) ?? PRESETS[mode][0];
}

export function readThemePresetId(mode: Theme, storage: Storage | undefined = globalThis.localStorage): string {
  try {
    const stored = storage?.getItem(THEME_PRESET_STORAGE_KEYS[mode]);
    return isThemePresetId(mode, stored) ? stored : DEFAULT_THEME_PRESET;
  } catch {
    return DEFAULT_THEME_PRESET;
  }
}

export function activeThemePreset(mode: Theme, storage?: Storage): ThemePreset {
  return findThemePreset(mode, readThemePresetId(mode, storage));
}

export type ThemePresetStyle = Readonly<{
  tokens: ThemeTokenOverrides;
  properties: Readonly<Record<string, string>>;
  radius: string | null;
  primary: string | null;
}>;

const NO_PRESET_STYLE: ThemePresetStyle = { tokens: {}, properties: {}, radius: null, primary: null };

export function themePresetStyle(preset: ThemePreset): ThemePresetStyle {
  if (preset.builtIn) return NO_PRESET_STYLE;
  const palette = preset.palette;
  const tokens: ThemeTokenOverrides = {
    background: palette.background,
    foreground: palette.foreground,
    card: palette.card,
    "card-foreground": palette.foreground,
    popover: palette.popover,
    "popover-foreground": palette.foreground,
    secondary: palette.muted,
    "secondary-foreground": palette.foreground,
    muted: palette.muted,
    "muted-foreground": palette.mutedForeground,
    accent: palette.hover,
    "accent-foreground": palette.foreground,
    border: palette.border,
    input: palette.input,
    sidebar: palette.sidebar,
    "sidebar-foreground": palette.foreground,
    "sidebar-border": palette.border,
    "sidebar-accent": palette.selected,
    "sidebar-accent-foreground": palette.foreground,
  };
  if (palette.pdfPage) tokens["pdf-dark-page"] = palette.pdfPage;
  if (palette.pdfText) tokens["pdf-dark-text"] = palette.pdfText;
  return {
    tokens,
    properties: { "--code-block-bg": palette.codeBlock, "--home-background": palette.background },
    radius: palette.radius ?? null,
    primary: palette.primary,
  };
}
