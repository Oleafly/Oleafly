import type { Theme } from "@/lib/theme";

export const THEME_CUSTOMIZATION_STORAGE_KEY = "oleafly.theme-customization.v1";
export const THEME_CUSTOMIZATION_VERSION = 1;
export const MAX_THEME_IMPORT_BYTES = 128 * 1024;
export const MAX_CUSTOM_CSS_BYTES = 64 * 1024;

export const THEME_TOKEN_NAMES = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-border",
  "sidebar-accent",
  "sidebar-accent-foreground",
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];
export type ThemeTokenOverrides = Partial<Record<ThemeTokenName, string>>;
export type ThemeCustomization = {
  version: typeof THEME_CUSTOMIZATION_VERSION;
  light: ThemeTokenOverrides;
  dark: ThemeTokenOverrides;
  radius: string | null;
  customCss: string | null;
};

type JsonRecord = Record<string, unknown>;

const tokenNameSet = new Set<string>(THEME_TOKEN_NAMES);
const cssValuePattern = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)\([\d.\s,%/a-z+-]+\)|(?:transparent|currentcolor|black|white|red|blue|green|yellow|orange|purple|gray|grey))$/i;
const radiusPattern = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%))$/;
const customPropertyPattern = /^--oleafly-[a-z][a-z0-9-]{0,62}$/;
const scopedPropertyPattern = /^(?:color|background-color|border-color|outline-color|box-shadow|font-family|font-size|font-weight|letter-spacing|line-height)$/;
const forbiddenCssPattern = /(?:@|url\s*\(|expression\s*\(|-moz-binding|<|>|\{|\}|<\/style)/i;

export const emptyThemeCustomization = (): ThemeCustomization => ({
  version: THEME_CUSTOMIZATION_VERSION,
  light: {},
  dark: {},
  radius: null,
  customCss: null,
});

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function validColorValue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const candidate = value.trim();
  return candidate.length > 0 && candidate.length <= 160 && cssValuePattern.test(candidate);
}

export function normalizeThemeTokenName(value: string): ThemeTokenName | null {
  const normalized = value.replace(/^--/, "");
  return tokenNameSet.has(normalized) ? (normalized as ThemeTokenName) : null;
}

export function validateThemeTokenOverrides(value: unknown): ThemeTokenOverrides {
  if (!isRecord(value)) throw new Error("Theme tokens must be an object.");
  const output: ThemeTokenOverrides = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const token = normalizeThemeTokenName(key);
    if (!token) throw new Error(`Unsupported theme token: ${key}.`);
    if (!validColorValue(rawValue)) throw new Error(`Theme token ${token} has an invalid color value.`);
    output[token] = rawValue.trim();
  }
  return output;
}

export function validateRadius(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !radiusPattern.test(value.trim())) {
    throw new Error("Corner radius must use px, rem, em, or percent.");
  }
  return value.trim();
}

function declarations(css: string) {
  const trimmed = css.trim();
  if (!trimmed) return "";
  if (bytes(trimmed) > MAX_CUSTOM_CSS_BYTES) {
    throw new Error("Custom CSS is larger than 64 KiB.");
  }
  if (forbiddenCssPattern.test(trimmed)) {
    throw new Error("Custom CSS cannot use at-rules, URLs, or selectors.");
  }
  const rows = trimmed.split(";").map((row) => row.trim()).filter(Boolean);
  if (rows.length > 64) throw new Error("Custom CSS can contain at most 64 declarations.");
  const accepted: string[] = [];
  for (const row of rows) {
    const separator = row.indexOf(":");
    if (separator <= 0 || row.indexOf(":", separator + 1) !== -1) {
      throw new Error("Custom CSS must contain simple property declarations.");
    }
    const property = row.slice(0, separator).trim().toLowerCase();
    const value = row.slice(separator + 1).trim();
    if ((!customPropertyPattern.test(property) && !scopedPropertyPattern.test(property)) || !value) {
      throw new Error(`Custom CSS property is not allowed: ${property || "unknown"}.`);
    }
    if (value.length > 512 || forbiddenCssPattern.test(value)) {
      throw new Error("Custom CSS contains an unsafe value.");
    }
    accepted.push(`${property}: ${value}`);
  }
  return accepted.join("; ");
}

export function validateCustomCss(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Custom CSS must be text.");
  const normalized = declarations(value);
  return normalized || null;
}

export function validateThemeCustomization(value: unknown): ThemeCustomization {
  if (!isRecord(value)) throw new Error("Theme customization must be an object.");
  const version = value.version;
  if (version !== undefined && version !== THEME_CUSTOMIZATION_VERSION) {
    throw new Error("This theme file uses an unsupported version.");
  }
  return {
    version: THEME_CUSTOMIZATION_VERSION,
    light: validateThemeTokenOverrides(value.light ?? {}),
    dark: validateThemeTokenOverrides(value.dark ?? {}),
    radius: validateRadius(value.radius),
    customCss: validateCustomCss(value.customCss),
  };
}

function importThemeTokens(value: JsonRecord, mode: Theme) {
  const cssVars = isRecord(value.cssVars) ? value.cssVars : null;
  if (!cssVars) return null;
  const modeTokens = cssVars[mode];
  return validateThemeTokenOverrides(modeTokens ?? {});
}

export function parseThemeCustomizationJson(text: string): ThemeCustomization {
  if (bytes(text) > MAX_THEME_IMPORT_BYTES) throw new Error("Theme file is larger than 128 KiB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Theme file is not valid JSON.");
  }
  if (!isRecord(parsed)) throw new Error("Theme file must contain an object.");
  if ("light" in parsed || "dark" in parsed || "version" in parsed) {
    return validateThemeCustomization(parsed);
  }
  const light = importThemeTokens(parsed, "light");
  const dark = importThemeTokens(parsed, "dark");
  if (!light || !dark) {
    throw new Error("Theme file must include light and dark CSS variables.");
  }
  const radius = validateRadius(parsed.radius ?? (isRecord(parsed.cssVars) ? parsed.cssVars.radius : null));
  const oleafly = isRecord(parsed.oleafly) ? parsed.oleafly : {};
  return {
    version: THEME_CUSTOMIZATION_VERSION,
    light,
    dark,
    radius,
    customCss: validateCustomCss(oleafly.customCss),
  };
}

export function serializeThemeCustomization(customization: ThemeCustomization): string {
  const valid = validateThemeCustomization(customization);
  return JSON.stringify(
    {
      $schema: "https://ui.shadcn.com/schema/registry-theme.json",
      name: "oleafly-custom",
      cssVars: {
        light: valid.light,
        dark: valid.dark,
      },
      radius: valid.radius,
      oleafly: {
        version: valid.version,
        customCss: valid.customCss,
      },
    },
    null,
    2,
  );
}

export function readThemeCustomization(storage: Storage = window.localStorage): ThemeCustomization {
  const stored = storage.getItem(THEME_CUSTOMIZATION_STORAGE_KEY);
  if (!stored) return emptyThemeCustomization();
  try {
    return parseThemeCustomizationJson(stored);
  } catch {
    return emptyThemeCustomization();
  }
}

export function writeThemeCustomization(
  customization: ThemeCustomization,
  storage: Storage = window.localStorage,
): ThemeCustomization {
  const valid = validateThemeCustomization(customization);
  storage.setItem(THEME_CUSTOMIZATION_STORAGE_KEY, JSON.stringify(valid));
  return valid;
}

export function resetThemeCustomization(storage: Storage = window.localStorage): ThemeCustomization {
  storage.removeItem(THEME_CUSTOMIZATION_STORAGE_KEY);
  return emptyThemeCustomization();
}

function styleElement() {
  const existing = document.querySelector<HTMLStyleElement>("style[data-oleafly-custom-theme]");
  if (existing) return existing;
  const style = document.createElement("style");
  style.dataset.oleaflyCustomTheme = "";
  document.head.append(style);
  return style;
}

export function applyThemeCustomization(
  theme: Theme,
  customization: ThemeCustomization = readThemeCustomization(),
): ThemeCustomization {
  const valid = validateThemeCustomization(customization);
  const root = document.documentElement;
  for (const token of THEME_TOKEN_NAMES) root.style.removeProperty(`--${token}`);
  root.style.removeProperty("--radius");
  for (const [token, value] of Object.entries(valid[theme])) {
    root.style.setProperty(`--${token}`, value);
  }
  if (valid.radius) root.style.setProperty("--radius", valid.radius);
  const style = styleElement();
  style.textContent = valid.customCss ? `#root { ${valid.customCss} }` : "";
  return valid;
}

export function clearThemeCustomization(): void {
  const root = document.documentElement;
  for (const token of THEME_TOKEN_NAMES) root.style.removeProperty(`--${token}`);
  root.style.removeProperty("--radius");
  document.querySelector("style[data-oleafly-custom-theme]")?.remove();
}
