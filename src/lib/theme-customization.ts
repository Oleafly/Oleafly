import { i18n } from "@/i18n";
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
const cssValuePattern = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)\([\d.\s,%/a-z+-]+\)|(?:transparent|currentcolor|black|white|red|blue|green|yellow|orange|purple|gray|grey))$/i;
const MAX_IMPORT_TOKEN_KEYS = 256;
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

type ThemeTokenScope = "tokens" | "light" | "dark";

function acceptedTokenName(
  key: string,
  options: { skipUnknown?: boolean; skipped?: string[] },
): ThemeTokenName | null {
  const token = typeof key === "string" && key.length <= 64 ? normalizeThemeTokenName(key) : null;
  if (token) return token;
  if (options.skipUnknown) {
    options.skipped?.push(key.slice(0, 64));
    return null;
  }
  throw new Error(
    i18n.t(($) => $.core.theme.unsupportedToken, { token: key.slice(0, 64) }),
  );
}

export function validateThemeTokenOverrides(
  value: unknown,
  options: { skipUnknown?: boolean; skipped?: string[]; scope?: ThemeTokenScope } = {},
): ThemeTokenOverrides {
  const scope = options.scope ?? "tokens";
  if (!isRecord(value)) throw new Error(i18n.t(($) => $.core.theme[scope].notObject));
  const entries = Object.entries(value);
  if (entries.length > MAX_IMPORT_TOKEN_KEYS) {
    throw new Error(
      i18n.t(($) => $.core.theme[scope].tooManyEntries, { max: MAX_IMPORT_TOKEN_KEYS }),
    );
  }
  const output: ThemeTokenOverrides = {};
  for (const [key, rawValue] of entries) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const token = acceptedTokenName(key, options);
    if (!token) continue;
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    if (!validColorValue(rawValue)) {
      throw new Error(i18n.t(($) => $.core.theme.invalidColor, { token }));
    }
    output[token] = rawValue.trim();
  }
  return output;
}

export function validateRadius(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !radiusPattern.test(value.trim())) {
    throw new Error(i18n.t(($) => $.core.theme.invalidRadius));
  }
  return value.trim();
}

function acceptedDeclaration(row: string): string {
  const separator = row.indexOf(":");
  if (separator <= 0 || row.includes(":", separator + 1)) {
    throw new Error(i18n.t(($) => $.core.theme.cssNotSimple));
  }
  const property = row.slice(0, separator).trim().toLowerCase();
  const value = row.slice(separator + 1).trim();
  if ((!customPropertyPattern.test(property) && !scopedPropertyPattern.test(property)) || !value) {
    throw new Error(
      i18n.t(($) => $.core.theme.cssPropertyNotAllowed, {
        property: property || i18n.t(($) => $.core.theme.unknownProperty),
      }),
    );
  }
  if (value.length > 512 || forbiddenCssPattern.test(value)) {
    throw new Error(i18n.t(($) => $.core.theme.cssUnsafeValue));
  }
  return `${property}: ${value}`;
}

function declarations(css: string) {
  const trimmed = css.trim();
  if (!trimmed) return "";
  if (bytes(trimmed) > MAX_CUSTOM_CSS_BYTES) {
    throw new Error(i18n.t(($) => $.core.theme.cssTooLarge));
  }
  if (forbiddenCssPattern.test(trimmed)) {
    throw new Error(i18n.t(($) => $.core.theme.cssForbiddenSyntax));
  }
  const rows = trimmed.split(";").map((row) => row.trim()).filter(Boolean);
  if (rows.length > 64) throw new Error(i18n.t(($) => $.core.theme.cssTooManyDeclarations));
  const accepted: string[] = [];
  for (const row of rows) accepted.push(acceptedDeclaration(row));
  return accepted.join("; ");
}

export function validateCustomCss(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error(i18n.t(($) => $.core.theme.cssNotText));
  const normalized = declarations(value);
  return normalized || null;
}

export function validateThemeCustomization(value: unknown): ThemeCustomization {
  if (!isRecord(value)) throw new Error(i18n.t(($) => $.core.theme.customizationNotObject));
  const version = value.version;
  if (version !== undefined && version !== THEME_CUSTOMIZATION_VERSION) {
    throw new Error(i18n.t(($) => $.core.theme.unsupportedVersion));
  }
  return {
    version: THEME_CUSTOMIZATION_VERSION,
    light: validateThemeTokenOverrides(value.light ?? {}),
    dark: validateThemeTokenOverrides(value.dark ?? {}),
    radius: validateRadius(value.radius),
    customCss: validateCustomCss(value.customCss),
  };
}

export interface ThemeImportResult {
  customization: ThemeCustomization;
  skippedTokens: string[];
}

function importThemeTokens(cssVars: JsonRecord, mode: Theme, skipped: string[]) {
  const modeTokens = cssVars[mode];
  if (modeTokens === undefined || modeTokens === null) return {};
  return validateThemeTokenOverrides(modeTokens, {
    skipUnknown: true,
    skipped,
    scope: mode,
  });
}

export function parseThemeCustomizationImport(text: unknown): ThemeImportResult {
  if (typeof text !== "string") throw new Error(i18n.t(($) => $.core.theme.fileNotText));
  if (bytes(text) > MAX_THEME_IMPORT_BYTES) {
    throw new Error(i18n.t(($) => $.core.theme.fileTooLarge));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(i18n.t(($) => $.core.theme.fileNotJson));
  }
  if (!isRecord(parsed)) throw new Error(i18n.t(($) => $.core.theme.fileNotObject));
  if ("light" in parsed || "dark" in parsed || "version" in parsed) {
    return { customization: validateThemeCustomization(parsed), skippedTokens: [] };
  }
  const cssVars = isRecord(parsed.cssVars) ? parsed.cssVars : null;
  if (!cssVars) throw new Error(i18n.t(($) => $.core.theme.fileMissingCssVars));
  if (!("light" in cssVars) && !("dark" in cssVars)) {
    throw new Error(i18n.t(($) => $.core.theme.fileMissingModes));
  }
  const skippedTokens: string[] = [];
  const light = importThemeTokens(cssVars, "light", skippedTokens);
  const dark = importThemeTokens(cssVars, "dark", skippedTokens);
  const radius = validateRadius(parsed.radius ?? cssVars.radius ?? (isRecord(cssVars.theme) ? cssVars.theme.radius : null));
  const oleafly = isRecord(parsed.oleafly) ? parsed.oleafly : {};
  return {
    customization: {
      version: THEME_CUSTOMIZATION_VERSION,
      light,
      dark,
      radius,
      customCss: validateCustomCss(oleafly.customCss),
    },
    skippedTokens: [...new Set(skippedTokens)],
  };
}

export function parseThemeCustomizationJson(text: string): ThemeCustomization {
  return parseThemeCustomizationImport(text).customization;
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

const appliedProperties = new Set<string>();

function removeAppliedProperties(root: HTMLElement) {
  for (const property of appliedProperties) root.style.removeProperty(property);
  appliedProperties.clear();
}

export function themeTokenOverride(theme: Theme, token: ThemeTokenName): string | undefined {
  try {
    return validateThemeCustomization(readThemeCustomization())[theme][token];
  } catch {
    return undefined;
  }
}

export function applyThemeCustomization(
  theme: Theme,
  customization: ThemeCustomization = readThemeCustomization(),
): ThemeCustomization {
  const valid = validateThemeCustomization(customization);
  const root = document.documentElement;
  removeAppliedProperties(root);
  for (const [token, value] of Object.entries(valid[theme])) {
    const property = `--${token}`;
    root.style.setProperty(property, value);
    appliedProperties.add(property);
  }
  if (valid.radius) {
    root.style.setProperty("--radius", valid.radius);
    appliedProperties.add("--radius");
  }
  const style = styleElement();
  style.textContent = valid.customCss ? `#root { ${valid.customCss} }` : "";
  return valid;
}

export function clearThemeCustomization(): void {
  removeAppliedProperties(document.documentElement);
  document.querySelector("style[data-oleafly-custom-theme]")?.remove();
}
