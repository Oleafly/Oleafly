import { EDITOR_COLOR_IDS } from "@oleafly/editor/color-roles";
import { EDITOR_CURSOR_BLINKING } from "@oleafly/editor/cursor-blink";
import { EDITOR_CURSOR_HEIGHTS } from "@oleafly/editor/cursor-height";
import { SUPPORTED_LOCALES, type LocalePreference } from "@oleafly/i18n-contract";
import { APP_FONT_SIZES } from "@/lib/app-font-sizes";
import { canStoreWord, normalizeDictionaryWord } from "@/lib/dictionary";
import type { EditorColorSettings, EditorThemeId } from "@/lib/editor-themes";
import { PERSONA_COLORS } from "@/lib/persona-colors";
import { isLintRuleName } from "@/lib/proofreading/lint-profile";
import type { ThemePreference } from "@/lib/theme";
import { parseThemeCustomizationImport, type ThemeCustomization } from "@/lib/theme-customization";
import type { AppConfig, Persona } from "@/lib/tauri";
import type { CompileMode } from "@/store/compile";
import {
  EDITOR_KEY_DEFINITIONS,
  normalizeEditorKey,
  type EditorKeyBindings,
  type EditorKeyDefinition,
} from "@/store/editor-keymap";
import {
  APP_ZOOM_LEVELS,
  BROWSER_SEARCH_ENGINES,
  EDITOR_CURSOR_WIDTHS,
  EDITOR_CUSTOM_LETTER_SPACING,
  EDITOR_CUSTOM_LINE_HEIGHT,
  EDITOR_FONT_SIZE_RANGE,
  EDITOR_KEYMAP_MODES,
  EDITOR_LETTER_SPACING_OPTIONS,
  EDITOR_LINE_HEIGHT_OPTIONS,
  EDITOR_TAB_SIZES,
  EDITOR_THEMES,
  FILE_MOVE_REFERENCE_OPTIONS,
  GRAMMAR_DIALECTS,
  LAYOUT_PRESETS,
  TERMINAL_COLOR_THEMES,
  TYPST_FORMATTER_INDENT_SIZES,
  TYPST_FORMATTER_LINE_WIDTHS,
  clampEditorFontSize,
  clampEditorLetterSpacing,
  clampEditorLineHeight,
  readDictionaryLocale,
  type PreferenceKey,
  type PreferenceValues,
  type TerminalColorThemeId,
} from "@/store/settings";
import {
  SHORTCUT_DEFINITIONS,
  isValidBinding,
  reservedShortcutAction,
  sameShortcutBinding,
  type ShortcutBinding,
  type ShortcutId,
} from "@/store/shortcuts";
import {
  bool,
  decimal,
  fail,
  hexColor,
  hexColorOrEmpty,
  isRecord,
  numberOf,
  ok,
  oneOf,
  text,
  textList,
  webAddress,
  wholeNumber,
  type Parsed,
  type ValueType,
} from "./values";
import { defaultShortcutBinding } from "./apply";

export interface CompilePreferences {
  autoCompile: boolean;
  compileMode: CompileMode;
  checkSyntaxBeforeCompile: boolean;
  stopOnFirstError: boolean;
}

export type ConfigPreferences = Pick<
  AppConfig,
  "ai_system_prompt" | "ai_pdf_capture" | "ai_personas" | "checkpoints_enabled" | "checkpoint_notifications"
>;

export interface SettingsSnapshot {
  preferences: PreferenceValues;
  theme: ThemePreference;
  customTheme: ThemeCustomization;
  shortcuts: Readonly<Record<ShortcutId, ShortcutBinding>>;
  editorKeys: Readonly<EditorKeyBindings>;
  words: readonly string[];
  compile: CompilePreferences;
  config: ConfigPreferences | null;
}

export interface SettingsPlan {
  preferences: Partial<PreferenceValues>;
  theme?: ThemePreference;
  customTheme?: ThemeCustomization;
  shortcuts: Partial<Record<ShortcutId, ShortcutBinding | null>>;
  editorKeys: Partial<EditorKeyBindings>;
  words?: string[];
  compile: Partial<CompilePreferences>;
  config: Partial<ConfigPreferences>;
}

export interface SettingField {
  path: string;
  parse(raw: unknown): Parsed<unknown>;
  read(snapshot: SettingsSnapshot): unknown;
  write(value: unknown, plan: SettingsPlan): void;
}

function field<T>(
  path: string,
  type: ValueType<T>,
  read: (snapshot: SettingsSnapshot) => unknown,
  write: (value: T, plan: SettingsPlan) => void,
): SettingField {
  return { path, parse: (raw) => type.parse(raw), read, write: (value, plan) => write(value as T, plan) };
}

function pref<K extends PreferenceKey>(path: string, key: K, type: ValueType<PreferenceValues[K]>): SettingField {
  return field(path, type, (snapshot) => snapshot.preferences[key], (value, plan) => {
    plan.preferences[key] = value;
  });
}

function compile<K extends keyof CompilePreferences>(
  path: string,
  key: K,
  type: ValueType<CompilePreferences[K]>,
): SettingField {
  return field(path, type, (snapshot) => snapshot.compile[key], (value, plan) => {
    plan.compile[key] = value;
  });
}

function config<K extends keyof ConfigPreferences>(
  path: string,
  key: K,
  type: ValueType<ConfigPreferences[K]>,
): SettingField {
  return field(path, type, (snapshot) => snapshot.config?.[key], (value, plan) => {
    plan.config[key] = value;
  });
}

const MODIFIERS = ["Mod", "Ctrl", "Alt", "Shift"] as const;
const MODIFIER_NAMES: ReadonlyMap<string, (typeof MODIFIERS)[number]> = new Map([
  ["mod", "Mod"],
  ["ctrl", "Ctrl"],
  ["alt", "Alt"],
  ["shift", "Shift"],
]);
const FIELD_FLAGS = { Mod: "mod", Ctrl: "ctrl", Alt: "alt", Shift: "shift" } as const;
const DEFAULT_BINDING = "default";
const SPACE_KEY = "Space";
const KEY_SEPARATOR = /-(?!$)/u;
const APPLE_PLATFORM = /Mac|iPhone|iPad/u;

function shortcutKeyText(key: string): string {
  if (key === " ") return SPACE_KEY;
  return key.length === 1 ? key.toLowerCase() : key;
}

function shortcutKey(text: string): string {
  if (text.toLowerCase() === SPACE_KEY.toLowerCase()) return " ";
  return text.length === 1 ? text.toLowerCase() : text;
}

export function formatShortcut(binding: ShortcutBinding): string {
  const modifiers = MODIFIERS.filter((modifier) => binding[FIELD_FLAGS[modifier]]);
  return [...modifiers, shortcutKeyText(binding.key)].join("-");
}

export function parseShortcut(value: string): ShortcutBinding | null {
  const parts = value.trim().split(KEY_SEPARATOR);
  const binding: ShortcutBinding = { key: shortcutKey(parts.pop() ?? "") };
  for (const part of parts) {
    const modifier = MODIFIER_NAMES.get(part.toLowerCase());
    if (!modifier || binding[FIELD_FLAGS[modifier]]) return null;
    binding[FIELD_FLAGS[modifier]] = true;
  }
  return isValidBinding(binding) ? binding : null;
}

function onApplePlatform(): boolean {
  return typeof navigator !== "undefined" && APPLE_PLATFORM.test(navigator.platform);
}

function editorKeyBinding(key: string): ShortcutBinding {
  const parts = key.split(KEY_SEPARATOR);
  const name = parts.pop() ?? "";
  return {
    key: name === SPACE_KEY ? " " : name,
    mod: parts.includes("Mod") || (onApplePlatform() && parts.includes("Cmd")),
    ctrl: parts.includes("Ctrl"),
    shift: parts.includes("Shift"),
    alt: parts.includes("Alt"),
  };
}

const shortcut: ValueType<ShortcutBinding | null> = {
  parse(raw) {
    if (raw === DEFAULT_BINDING) return ok(null);
    const binding = typeof raw === "string" && raw.length <= 64 ? parseShortcut(raw) : null;
    if (!binding) return fail({ kind: "shortcut" });
    const reserved = reservedShortcutAction(binding);
    return reserved ? fail({ kind: "reservedShortcut", action: reserved }) : ok(binding);
  },
};

const editorKey: ValueType<string | null> = {
  parse(raw) {
    if (raw === DEFAULT_BINDING) return ok(null);
    if (raw === "") return ok("");
    const key = typeof raw === "string" && raw.length <= 64 ? normalizeEditorKey(raw) : "";
    if (!key) return fail({ kind: "editorKey" });
    const reserved = reservedShortcutAction(editorKeyBinding(key));
    return reserved ? fail({ kind: "reservedShortcut", action: reserved }) : ok(key);
  },
};

const EDITOR_THEME_IDS: readonly EditorThemeId[] = EDITOR_THEMES.map((theme) => theme.id);

const EDITOR_COLOR_KEYS: ReadonlySet<string> = new Set([
  ...EDITOR_THEME_IDS.filter((id) => id !== "system"),
  "system-light",
  "system-dark",
]);
const EDITOR_COLOR_ROLES: ReadonlySet<string> = new Set(EDITOR_COLOR_IDS);

const editorColors: ValueType<EditorColorSettings> = {
  parse(raw) {
    if (!isRecord(raw)) return fail({ kind: "object" });
    const settings: Record<string, Record<string, string>> = {};
    for (const [key, overrides] of Object.entries(raw)) {
      if (!EDITOR_COLOR_KEYS.has(key)) return fail({ kind: "unknownKey" }, key);
      if (!isRecord(overrides)) return fail({ kind: "object" }, key);
      const colors: Record<string, string> = {};
      for (const [role, color] of Object.entries(overrides)) {
        if (!EDITOR_COLOR_ROLES.has(role)) return fail({ kind: "unknownKey" }, `${key}.${role}`);
        const parsed = hexColor.parse(color);
        if (!parsed.ok) return fail(parsed.issue, `${key}.${role}`);
        colors[role] = parsed.value;
      }
      if (Object.keys(colors).length > 0) settings[key] = colors;
    }
    return ok(settings as EditorColorSettings);
  },
};

const customTheme: ValueType<ThemeCustomization> = {
  parse(raw) {
    if (!isRecord(raw)) return fail({ kind: "object" });
    try {
      return ok(parseThemeCustomizationImport(JSON.stringify({ version: 1, ...raw })).customization);
    } catch (error) {
      return fail({ kind: "detail", message: error instanceof Error ? error.message : String(error) });
    }
  },
};

const dictionaryLocale: ValueType<string> = {
  parse(raw) {
    return typeof raw === "string" && raw.length <= 16 && readDictionaryLocale(raw) === raw
      ? ok(raw)
      : fail({ kind: "dictionaryLocale" });
  },
};

const words: ValueType<string[]> = {
  parse(raw) {
    const list = textList(5_000, 128).parse(raw);
    if (!list.ok) return list;
    const stored: string[] = [];
    const seen = new Set<string>();
    for (const [index, word] of list.value.entries()) {
      const normalized = normalizeDictionaryWord(word);
      if (!canStoreWord(normalized)) return fail({ kind: "listItem" }, `[${index}]`);
      const key = normalized.toLocaleLowerCase("en-US");
      if (seen.has(key)) return fail({ kind: "duplicate" }, `[${index}]`);
      seen.add(key);
      stored.push(normalized);
    }
    return ok(stored);
  },
};

const PERSONA_KEYS: ReadonlySet<string> = new Set(["id", "name", "color", "prompt"]);
const PERSONA_COLOR_KEYS = PERSONA_COLORS.map((color) => color.key);
const personaId = text(200, { required: true });
const personaName = text(200, { required: true });
const personaColor = oneOf(PERSONA_COLOR_KEYS);
const personaPrompt = text(200_000, { multiline: true, required: true });

function parsePersona(raw: unknown, index: number, ids: Set<string>): Parsed<Persona> {
  if (!isRecord(raw)) return fail({ kind: "object" }, `[${index}]`);
  for (const key of Object.keys(raw)) {
    if (!PERSONA_KEYS.has(key)) return fail({ kind: "unknownKey" }, `[${index}].${key}`);
  }
  const id = raw.id === undefined ? ok(`persona-${crypto.randomUUID()}`) : personaId.parse(raw.id);
  if (!id.ok) return fail(id.issue, `[${index}].id`);
  if (ids.has(id.value)) return fail({ kind: "duplicate" }, `[${index}].id`);
  ids.add(id.value);
  const name = personaName.parse(raw.name);
  if (!name.ok) return fail(name.issue, `[${index}].name`);
  const color = personaColor.parse(raw.color);
  if (!color.ok) return fail(color.issue, `[${index}].color`);
  const prompt = personaPrompt.parse(raw.prompt);
  if (!prompt.ok) return fail(prompt.issue, `[${index}].prompt`);
  return ok({ id: id.value, name: name.value.trim(), color: color.value, prompt: prompt.value });
}

const personas: ValueType<Persona[]> = {
  parse(raw) {
    if (!Array.isArray(raw) || raw.length > 50) return fail({ kind: "list", max: 50 });
    const ids = new Set<string>();
    const output: Persona[] = [];
    for (const [index, item] of raw.entries()) {
      const persona = parsePersona(item, index, ids);
      if (!persona.ok) return persona;
      output.push(persona.value);
    }
    return ok(output);
  },
};

const hiddenFiles = textList(200, 256, (pattern) => pattern === pattern.trim());
const lintRuleList = textList(2_000, 128, isLintRuleName);
const lintRules: ValueType<string[]> = {
  parse(raw) {
    const list = lintRuleList.parse(raw);
    if (!list.ok) return list;
    return ok([...list.value].sort((left, right) => Number(left > right) - Number(left < right)));
  },
};
const fontFamily = text(200);
const terminalWeight = wholeNumber(100, 900, 100);

function shortcutField(id: ShortcutId): SettingField {
  return field(
    `shortcuts.app.${id}`,
    shortcut,
    (snapshot) => {
      const binding = snapshot.shortcuts[id];
      return sameShortcutBinding(binding, defaultShortcutBinding(id)) ? DEFAULT_BINDING : formatShortcut(binding);
    },
    (value, plan) => {
      plan.shortcuts[id] = value;
    },
  );
}

function editorKeyField({ id, defaultKey }: EditorKeyDefinition): SettingField {
  return field(
    `shortcuts.editor.${id}`,
    editorKey,
    (snapshot) => {
      const key = snapshot.editorKeys[id];
      return key === defaultKey ? DEFAULT_BINDING : key;
    },
    (value, plan) => {
      plan.editorKeys[id] = value ?? defaultKey;
    },
  );
}

const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];
const LANGUAGES: readonly LocalePreference[] = ["system", ...SUPPORTED_LOCALES];

export const SETTINGS_FIELDS: readonly SettingField[] = [
  pref("general.language", "uiLocalePreference", oneOf(LANGUAGES)),
  pref("general.spellcheck", "spellcheck", bool),
  pref("general.spellingDictionary", "dictionaryLocale", dictionaryLocale),
  pref("general.grammar", "harper", bool),
  pref("general.grammarDialect", "grammarDialect", oneOf(GRAMMAR_DIALECTS.map((dialect) => dialect.id))),
  pref("general.regionalWording", "showRegionalism", bool),
  pref("general.wordChoice", "showWordChoice", bool),

  field("appearance.app.theme", oneOf(THEME_PREFERENCES), (snapshot) => snapshot.theme, (value, plan) => {
    plan.theme = value;
  }),
  pref("appearance.app.accentColor", "accentColor", hexColor),
  pref("appearance.app.fontSize", "appFontSize", numberOf(APP_FONT_SIZES)),
  pref("appearance.app.zoom", "appZoom", numberOf(APP_ZOOM_LEVELS)),
  pref("appearance.app.fontFamily", "appFontFamily", fontFamily),
  pref("appearance.app.dockPlacement", "dockPlacement", oneOf(["left", "right", "bottom"] as const)),
  pref("appearance.app.backgroundPattern", "bgPattern", oneOf(["dots", "grid", "none"] as const)),
  field(
    "appearance.app.customTheme",
    customTheme,
    ({ customTheme: { light, dark, radius, customCss } }) => ({ light, dark, radius, customCss }),
    (value, plan) => {
      plan.customTheme = value;
    },
  ),

  pref("appearance.editor.theme.light", "editorThemeLight", oneOf(EDITOR_THEME_IDS)),
  pref("appearance.editor.theme.dark", "editorThemeDark", oneOf(EDITOR_THEME_IDS)),
  pref("appearance.editor.colors", "editorColors", editorColors),
  pref(
    "appearance.editor.fontSize",
    "editorFontSize",
    decimal(EDITOR_FONT_SIZE_RANGE.min, EDITOR_FONT_SIZE_RANGE.max, clampEditorFontSize),
  ),
  pref("appearance.editor.fontFamily", "editorFontFamily", fontFamily),
  pref("appearance.editor.useAppFont", "editorUsesAppFont", bool),
  pref("appearance.editor.keymap", "editorKeymap", oneOf(EDITOR_KEYMAP_MODES)),
  pref("appearance.editor.tabSize", "editorTabSize", numberOf(EDITOR_TAB_SIZES)),
  pref("appearance.editor.lineWrap", "editorLineWrap", bool),
  pref("appearance.editor.lineHeight", "editorLineHeight", oneOf(EDITOR_LINE_HEIGHT_OPTIONS)),
  pref(
    "appearance.editor.customLineHeight",
    "editorCustomLineHeight",
    decimal(EDITOR_CUSTOM_LINE_HEIGHT.min, EDITOR_CUSTOM_LINE_HEIGHT.max, clampEditorLineHeight),
  ),
  pref("appearance.editor.letterSpacing", "editorLetterSpacing", oneOf(EDITOR_LETTER_SPACING_OPTIONS)),
  pref(
    "appearance.editor.customLetterSpacing",
    "editorCustomLetterSpacing",
    decimal(EDITOR_CUSTOM_LETTER_SPACING.min, EDITOR_CUSTOM_LETTER_SPACING.max, clampEditorLetterSpacing),
  ),
  pref("appearance.editor.cursorWidth", "editorCursorWidth", numberOf(EDITOR_CURSOR_WIDTHS)),
  pref("appearance.editor.cursorHeight", "editorCursorHeight", oneOf(EDITOR_CURSOR_HEIGHTS)),
  pref("appearance.editor.cursorBlinking", "editorCursorBlinking", oneOf(EDITOR_CURSOR_BLINKING)),
  pref("appearance.editor.cursorColor.light", "editorCursorColorLight", hexColorOrEmpty),
  pref("appearance.editor.cursorColor.dark", "editorCursorColorDark", hexColorOrEmpty),
  pref("appearance.editor.highlightCurrentLine", "editorHighlightCurrentLine", bool),
  pref("appearance.editor.stickyScroll", "editorStickyScroll", bool),
  pref("appearance.editor.mathPreview", "editorMathPreview", bool),
  pref("appearance.editor.autocomplete", "editorAutocomplete", bool),
  pref("appearance.editor.ghostCompletion", "editorGhostCompletion", bool),
  pref("appearance.editor.autoCloseBrackets", "editorAutoCloseBrackets", bool),
  pref("appearance.editor.autoCloseMath", "editorAutoCloseMath", bool),
  pref("appearance.editor.autoCloseEnvironments", "editorAutoCloseEnvironments", bool),
  pref("appearance.editor.updateReferencesOnMove", "fileMoveReferences", oneOf(FILE_MOVE_REFERENCE_OPTIONS)),
  pref("appearance.editor.typst.formatOnSave", "typstFormatOnSave", bool),
  pref("appearance.editor.typst.formatterLineWidth", "typstFormatterLineWidth", numberOf(TYPST_FORMATTER_LINE_WIDTHS)),
  pref("appearance.editor.typst.formatterIndent", "typstFormatterIndent", numberOf(TYPST_FORMATTER_INDENT_SIZES)),
  pref("appearance.editor.typst.inlayHints", "typstInlayHints", bool),
  pref("appearance.editor.typst.lint", "typstLint", bool),

  pref("appearance.terminal.fontSize", "terminalFontSize", wholeNumber(8, 32)),
  pref("appearance.terminal.fontFamily", "terminalFontFamily", text(300, { required: true })),
  pref("appearance.terminal.fontWeight", "terminalFontWeight", terminalWeight),
  pref("appearance.terminal.boldFontWeight", "terminalFontWeightBold", terminalWeight),
  pref("appearance.terminal.cursorStyle", "terminalCursorStyle", oneOf(["block", "underline", "bar"] as const)),
  pref("appearance.terminal.cursorBlink", "terminalCursorBlink", bool),
  pref("appearance.terminal.startWithProject", "terminalStartWithProject", bool),
  pref(
    "appearance.terminal.colorTheme",
    "terminalColorTheme",
    oneOf(Object.keys(TERMINAL_COLOR_THEMES) as TerminalColorThemeId[]),
  ),
  pref("appearance.terminal.background", "terminalBackground", hexColor),
  pref("appearance.terminal.foreground", "terminalForeground", hexColor),
  pref("appearance.terminal.cursorColor", "terminalCursorColor", hexColor),

  pref("appearance.pdf.darkMode", "pdfDarkMode", bool),
  pref("appearance.pdf.hoverPreview", "hoverPreview", bool),

  pref("appearance.browser.searchEngine", "browserSearchEngine", oneOf(BROWSER_SEARCH_ENGINES.map((engine) => engine.id))),
  pref("appearance.browser.homePage", "browserHomePage", webAddress),

  pref("appearance.files.projectLayout", "homeProjectLayout", oneOf(["grid", "list"] as const)),
  pref("appearance.files.defaultLayout", "defaultView", oneOf(LAYOUT_PRESETS)),
  pref("appearance.files.openFileTree", "openInTree", bool),
  pref("appearance.files.hiddenFiles", "hiddenFilePatterns", hiddenFiles),
  pref("appearance.files.zenMode.fullScreen", "zenFullScreen", bool),
  pref("appearance.files.zenMode.showPdfOnCompile", "zenShowPdfOnCompile", bool),

  field("dictionary.words", words, (snapshot) => [...snapshot.words], (value, plan) => {
    plan.words = value;
  }),
  pref("dictionary.disabledGrammarRules", "harperDisabledRules", lintRules),
  pref("dictionary.enabledGrammarRules", "harperEnabledRules", lintRules),

  config("data.checkpoints.afterCompile", "checkpoints_enabled", bool),
  config("data.checkpoints.notifyOnFailure", "checkpoint_notifications", bool),

  config("ai.customInstructions", "ai_system_prompt", text(200_000, { multiline: true })),
  config("ai.includePdfPreview", "ai_pdf_capture", bool),
  config("ai.personas", "ai_personas", personas),

  pref("engine.defaultLatexEngine", "defaultLatexEngine", oneOf(["tectonic", "latexmk"] as const)),
  compile("engine.compile.autoCompile", "autoCompile", bool),
  compile("engine.compile.mode", "compileMode", oneOf(["normal", "fast"] as const)),
  compile("engine.compile.checkSyntaxFirst", "checkSyntaxBeforeCompile", bool),
  compile("engine.compile.stopOnFirstError", "stopOnFirstError", bool),

  ...SHORTCUT_DEFINITIONS.map(({ id }) => shortcutField(id)),
  ...EDITOR_KEY_DEFINITIONS.map(editorKeyField),

  pref("experimentation.latexTools", "latexTools", bool),
  pref("experimentation.webBrowser", "webBrowser", bool),
];
