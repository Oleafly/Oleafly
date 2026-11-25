import { EDITOR_COLOR_IDS } from "@oleafly/editor/color-roles";
import { EDITOR_CURSOR_BLINKING } from "@oleafly/editor/cursor-blink";
import { EDITOR_CURSOR_HEIGHTS } from "@oleafly/editor/cursor-height";
import { SUPPORTED_LOCALES, type LocalePreference } from "@oleafly/i18n-contract";
import { APP_FONT_SIZES } from "@/lib/app-font-sizes";
import { COMMENT_COLORS } from "@/lib/comment-color";
import { canStoreWord, normalizeDictionaryWord } from "@/lib/dictionary";
import type { EditorColorSettings, EditorThemeId } from "@/lib/editor-themes";
import {
  NOTE_WIDTHS,
  NOTES_CALLOUT_STYLES,
  NOTES_CODE_THEMES,
  NOTES_FIELD_STYLES,
  NOTES_INFO_PLACES,
  NOTES_LINE_HEIGHT_OPTIONS,
  NOTES_TASK_BOXES,
  NOTES_TIKZ_PREAMBLE_MAX,
  NOTES_TITLE_SIZES,
  TEXT_REPLACEMENT_LIMITS,
  clampNotesFontSize,
  textReplacementPair,
} from "@/lib/notes-appearance";
import {
  CUSTOM_LINE_HEIGHT,
  HEADING_SIZES,
  HEADING_TYPEFACES,
  PARAGRAPH_SPACINGS,
  TEXT_FONT_SIZE_RANGE,
  TEXT_TYPEFACES,
  clampLineHeight,
} from "@/lib/text-appearance";
import {
  VISUAL_LINE_HEIGHT_OPTIONS,
  VISUAL_MATCH_EDITOR_SIZE,
  VISUAL_PARAGRAPH_INDENTS,
  VISUAL_TEXT_ALIGNS,
  VISUAL_TEXT_WIDTHS,
  clampVisualFontSize,
} from "@/lib/visual-appearance";
import {
  cleanTag,
  FORMAT_LIMIT,
  normalizePeriodic,
  type NotesPeriodic,
  PERIODIC_KINDS,
  type PeriodicKind,
  TAG_LIMIT,
  validPeriodFormat,
  WEEK_START_SETTINGS,
} from "@/lib/notes-periodic";
import { isLintRuleName } from "@/lib/proofreading/lint-profile";
import type { ThemePreference } from "@/lib/theme";
import { parseThemeCustomizationImport, type ThemeCustomization } from "@/lib/theme-customization";
import { themePresetIds } from "@/lib/theme-presets";
import type { AppConfig, } from "@/lib/tauri";
import type { CompileMode } from "@/store/compile";
import {
  EDITOR_KEY_DEFINITIONS,
  normalizeEditorKey,
  type EditorKeyBindings,
  type EditorKeyDefinition,
} from "@/store/editor-keymap";
import {
  APP_ICON_IDS,
  APP_ZOOM_LEVELS,
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
  PDF_DARK_MODES,
  TERMINAL_COLOR_THEMES,
  TERMINAL_OPEN_WITH_IDS,
  TERMINAL_SCROLLBACK_OPTIONS,
  TERMINAL_SHELL_IDS,
  TERMINAL_SHELL_PATH_MAX_LENGTH,
  TERMINAL_SHIFT_ENTER_OPTIONS,
  TYPST_FORMATTER_INDENT_SIZES,
  TYPST_FORMATTER_LINE_WIDTHS,
  clampEditorFontSize,
  clampEditorLetterSpacing,
  clampEditorLineHeight,
  readDictionaryLocale,
  type PdfDarkMode,
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
  followOpenFile: boolean;
}

export type ConfigPreferences = Pick<AppConfig, "checkpoints_enabled" | "checkpoint_notifications">;

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

function parseColorOverrides(key: string, overrides: unknown): Parsed<Record<string, string>> {
  if (!EDITOR_COLOR_KEYS.has(key)) return fail({ kind: "unknownKey" }, key);
  if (!isRecord(overrides)) return fail({ kind: "object" }, key);
  const colors: Record<string, string> = {};
  for (const [role, color] of Object.entries(overrides)) {
    if (!EDITOR_COLOR_ROLES.has(role)) return fail({ kind: "unknownKey" }, `${key}.${role}`);
    const parsed = hexColor.parse(color);
    if (!parsed.ok) return fail(parsed.issue, `${key}.${role}`);
    colors[role] = parsed.value;
  }
  return ok(colors);
}

const editorColors: ValueType<EditorColorSettings> = {
  parse(raw) {
    if (!isRecord(raw)) return fail({ kind: "object" });
    const settings: Record<string, Record<string, string>> = {};
    for (const [key, overrides] of Object.entries(raw)) {
      const colors = parseColorOverrides(key, overrides);
      if (!colors.ok) return colors;
      if (Object.keys(colors.value).length > 0) settings[key] = colors.value;
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

const textReplacements: ValueType<Record<string, string>> = {
  parse(raw) {
    if (!isRecord(raw)) return fail({ kind: "object" });
    const entries = Object.entries(raw);
    if (entries.length > TEXT_REPLACEMENT_LIMITS.count) return fail({ kind: "list", max: TEXT_REPLACEMENT_LIMITS.count });
    for (const [from, to] of entries) {
      if (!textReplacementPair(from, to)) return fail({ kind: "listItem" }, JSON.stringify(from));
    }
    return ok(Object.fromEntries(entries) as Record<string, string>);
  },
};
const terminalWeight = wholeNumber(100, 900, 100);

const periodFormat = text(FORMAT_LIMIT);
const periodTag = text(TAG_LIMIT);
const periodTemplate = text(256);
const weekStartSetting = oneOf(WEEK_START_SETTINGS);

const pdfDarkModeValue: ValueType<PdfDarkMode> = {
  parse(raw) {
    if (raw === "follow") return ok("follow");
    const legacy = bool.parse(raw);
    if (legacy.ok) return ok(legacy.value ? "on" : "off");
    return fail({ kind: "oneOf", values: PDF_DARK_MODES });
  },
};

const PERIODIC_PARTS: ReadonlySet<string> = new Set<string>([...PERIODIC_KINDS, "weekStart"]);
const periodFormatValue: ValueType<string> = {
  parse(raw) {
    const format = periodFormat.parse(raw);
    return format.ok && !validPeriodFormat(format.value) ? fail({ kind: "listItem" }) : format;
  },
};
const periodTagValue: ValueType<string> = {
  parse(raw) {
    const tag = periodTag.parse(raw);
    if (!tag.ok) return tag;
    const plain = tag.value.trim().replace(/^#+/u, "");
    return plain && !cleanTag(plain) ? fail({ kind: "listItem" }) : ok(cleanTag(plain));
  },
};
const PERIODIC_FIELDS: ReadonlyMap<string, ValueType<unknown>> = new Map<string, ValueType<unknown>>([
  ["enabled", bool],
  ["format", periodFormatValue],
  ["template", periodTemplate],
  ["tag", periodTagValue],
]);

function parsePeriodicKind(kind: PeriodicKind, raw: unknown): Parsed<Record<string, unknown>> {
  if (!isRecord(raw)) return fail({ kind: "object" }, kind);
  const parsed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const type = PERIODIC_FIELDS.get(key);
    if (!type) return fail({ kind: "unknownKey" }, `${kind}.${key}`);
    const result = type.parse(value);
    if (!result.ok) return fail(result.issue, `${kind}.${key}`);
    parsed[key] = result.value;
  }
  return ok(parsed);
}

const periodic: ValueType<NotesPeriodic> = {
  parse(raw) {
    if (!isRecord(raw)) return fail({ kind: "object" });
    const parsed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!PERIODIC_PARTS.has(key)) return fail({ kind: "unknownKey" }, key);
      const result = key === "weekStart" ? weekStartSetting.parse(value) : parsePeriodicKind(key as PeriodicKind, value);
      if (!result.ok) return result.at ? result : fail(result.issue, key);
      parsed[key] = result.value;
    }
    return ok(normalizePeriodic(parsed));
  },
};

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
  pref("appearance.app.lightTheme", "appThemeLight", oneOf(themePresetIds("light"))),
  pref("appearance.app.darkTheme", "appThemeDark", oneOf(themePresetIds("dark"))),
  pref("appearance.app.accentColor", "accentColor", hexColorOrEmpty),
  pref("appearance.app.commentColor", "commentColor", oneOf(COMMENT_COLORS)),
  pref("appearance.app.fontSize", "appFontSize", numberOf(APP_FONT_SIZES)),
  pref("appearance.app.zoom", "appZoom", numberOf(APP_ZOOM_LEVELS)),
  pref("appearance.app.fontFamily", "appFontFamily", fontFamily),
  pref("appearance.app.dockPlacement", "dockPlacement", oneOf(["left", "right", "bottom"] as const)),
  pref("appearance.app.backgroundPattern", "bgPattern", oneOf(["dots", "grid", "none"] as const)),
  pref("appearance.app.appIcon", "appIcon", oneOf(APP_ICON_IDS)),
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
  pref("appearance.editor.cjkFontFamily", "editorCjkFontFamily", fontFamily),
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
  pref("appearance.editor.keepVisualMode", "editorKeepVisualMode", bool),
  pref("appearance.editor.autocomplete", "editorAutocomplete", bool),
  pref("appearance.editor.ghostCompletion", "editorGhostCompletion", bool),
  pref("appearance.editor.autoCloseBrackets", "editorAutoCloseBrackets", bool),
  pref("appearance.editor.autoCloseMath", "editorAutoCloseMath", bool),
  pref("appearance.editor.groupScripts", "editorGroupScripts", bool),
  pref("appearance.editor.autoCloseEnvironments", "editorAutoCloseEnvironments", bool),
  pref("appearance.editor.updateReferencesOnMove", "fileMoveReferences", oneOf(FILE_MOVE_REFERENCE_OPTIONS)),
  pref("appearance.editor.typst.formatOnSave", "typstFormatOnSave", bool),
  pref("appearance.editor.typst.formatterLineWidth", "typstFormatterLineWidth", numberOf(TYPST_FORMATTER_LINE_WIDTHS)),
  pref("appearance.editor.typst.formatterIndent", "typstFormatterIndent", numberOf(TYPST_FORMATTER_INDENT_SIZES)),
  pref("appearance.editor.typst.inlayHints", "typstInlayHints", bool),
  pref("appearance.editor.typst.lint", "typstLint", bool),

  pref("appearance.visual.typeface", "visualTypeface", oneOf(TEXT_TYPEFACES)),
  pref("appearance.visual.fontFamily", "visualFontFamily", fontFamily),
  pref(
    "appearance.visual.fontSize",
    "visualFontSize",
    decimal(VISUAL_MATCH_EDITOR_SIZE, TEXT_FONT_SIZE_RANGE.max, clampVisualFontSize),
  ),
  pref("appearance.visual.lineHeight", "visualLineHeight", oneOf(VISUAL_LINE_HEIGHT_OPTIONS)),
  pref(
    "appearance.visual.customLineHeight",
    "visualCustomLineHeight",
    decimal(CUSTOM_LINE_HEIGHT.min, CUSTOM_LINE_HEIGHT.max, clampLineHeight),
  ),
  pref("appearance.visual.paragraphSpacing", "visualParagraphSpacing", oneOf(PARAGRAPH_SPACINGS)),
  pref("appearance.visual.paragraphIndent", "visualParagraphIndent", numberOf(VISUAL_PARAGRAPH_INDENTS)),
  pref("appearance.visual.textAlign", "visualTextAlign", oneOf(VISUAL_TEXT_ALIGNS)),
  pref("appearance.visual.textWidth", "visualTextWidth", oneOf(VISUAL_TEXT_WIDTHS)),
  pref("appearance.visual.headingTypeface", "visualHeadingTypeface", oneOf(HEADING_TYPEFACES)),
  pref("appearance.visual.headingFontFamily", "visualHeadingFontFamily", fontFamily),
  pref("appearance.visual.headingSize", "visualHeadingSize", oneOf(HEADING_SIZES)),
  pref("appearance.visual.headingColor", "visualHeadingColor", hexColorOrEmpty),
  pref("appearance.visual.markdown", "visualMarkdown", bool),

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
  pref("appearance.terminal.shell", "terminalShell", oneOf(TERMINAL_SHELL_IDS)),
  pref("appearance.terminal.shellPath", "terminalShellPath", text(TERMINAL_SHELL_PATH_MAX_LENGTH)),
  pref("appearance.terminal.openWith", "terminalOpenWith", oneOf(TERMINAL_OPEN_WITH_IDS)),
  pref("appearance.terminal.shiftEnter", "terminalShiftEnter", oneOf(TERMINAL_SHIFT_ENTER_OPTIONS)),
  pref("appearance.terminal.copyOnSelect", "terminalCopyOnSelect", bool),
  pref("appearance.terminal.optionIsMeta", "terminalOptionIsMeta", bool),
  pref("appearance.terminal.scrollback", "terminalScrollback", numberOf(TERMINAL_SCROLLBACK_OPTIONS)),
  pref("appearance.terminal.confirmClose", "terminalConfirmClose", bool),

  pref("appearance.pdf.darkMode", "pdfDarkMode", pdfDarkModeValue),
  pref("appearance.pdf.hoverPreview", "hoverPreview", bool),

  pref("appearance.files.projectLayout", "homeProjectLayout", oneOf(["grid", "list"] as const)),
  pref("appearance.files.defaultLayout", "defaultView", oneOf(LAYOUT_PRESETS)),
  pref("appearance.files.openFileTree", "openInTree", bool),
  pref("appearance.files.fileMarkers", "fileMarkers", oneOf(["icons", "badges"] as const)),
  pref("appearance.files.hiddenFiles", "hiddenFilePatterns", hiddenFiles),
  pref("appearance.files.zenMode.fullScreen", "zenFullScreen", bool),
  pref("appearance.files.zenMode.showPdfOnCompile", "zenShowPdfOnCompile", bool),

  pref("appearance.notes.typeface", "notesTypeface", oneOf(TEXT_TYPEFACES)),
  pref("appearance.notes.fontFamily", "notesFontFamily", fontFamily),
  pref(
    "appearance.notes.fontSize",
    "notesFontSize",
    decimal(TEXT_FONT_SIZE_RANGE.min, TEXT_FONT_SIZE_RANGE.max, clampNotesFontSize),
  ),
  pref("appearance.notes.lineHeight", "notesLineHeight", oneOf(NOTES_LINE_HEIGHT_OPTIONS)),
  pref(
    "appearance.notes.customLineHeight",
    "notesCustomLineHeight",
    decimal(CUSTOM_LINE_HEIGHT.min, CUSTOM_LINE_HEIGHT.max, clampLineHeight),
  ),
  pref("appearance.notes.paragraphSpacing", "notesParagraphSpacing", oneOf(PARAGRAPH_SPACINGS)),
  pref("appearance.notes.headingTypeface", "notesHeadingTypeface", oneOf(HEADING_TYPEFACES)),
  pref("appearance.notes.headingFontFamily", "notesHeadingFontFamily", fontFamily),
  pref("appearance.notes.headingSize", "notesHeadingSize", oneOf(HEADING_SIZES)),
  pref("appearance.notes.titleSize", "notesTitleSize", numberOf(NOTES_TITLE_SIZES)),
  pref("appearance.notes.width", "notesWidth", oneOf(NOTE_WIDTHS)),
  pref("appearance.notes.info", "notesInfo", oneOf(NOTES_INFO_PLACES)),
  pref("appearance.notes.wordCount", "notesShowWordCount", bool),
  pref("appearance.notes.spellcheck", "notesSpellcheck", bool),
  pref("appearance.notes.textReplace", "notesTextReplace", bool),
  pref("appearance.notes.textReplacements", "notesTextReplacements", textReplacements),
  pref("appearance.notes.keepUndo", "notesKeepUndo", bool),
  pref("appearance.notes.xPostsLive", "notesXPostsLive", bool),
  pref("appearance.notes.codeFontFamily", "notesCodeFontFamily", fontFamily),
  pref("appearance.notes.codeTheme", "notesCodeTheme", oneOf(NOTES_CODE_THEMES)),
  pref("appearance.notes.accentColor", "notesAccentColor", hexColorOrEmpty),
  pref("appearance.notes.calloutStyle", "notesCalloutStyle", oneOf(NOTES_CALLOUT_STYLES)),
  pref("appearance.notes.taskBox", "notesTaskBox", oneOf(NOTES_TASK_BOXES)),
  pref("appearance.notes.fieldStyle", "notesFieldStyle", oneOf(NOTES_FIELD_STYLES)),
  pref("appearance.notes.tikzPreamble", "notesTikzPreamble", text(NOTES_TIKZ_PREAMBLE_MAX, { multiline: true })),
  pref("appearance.notes.periodic", "notesPeriodic", periodic),

  field("dictionary.words", words, (snapshot) => [...snapshot.words], (value, plan) => {
    plan.words = value;
  }),
  pref("dictionary.disabledGrammarRules", "harperDisabledRules", lintRules),
  pref("dictionary.enabledGrammarRules", "harperEnabledRules", lintRules),

  config("data.checkpoints.afterCompile", "checkpoints_enabled", bool),
  config("data.checkpoints.notifyOnFailure", "checkpoint_notifications", bool),

  pref("engine.defaultLatexEngine", "defaultLatexEngine", oneOf(["tectonic", "latexmk"] as const)),
  compile("engine.compile.autoCompile", "autoCompile", bool),
  compile("engine.compile.mode", "compileMode", oneOf(["normal", "fast"] as const)),
  compile("engine.compile.checkSyntaxFirst", "checkSyntaxBeforeCompile", bool),
  compile("engine.compile.stopOnFirstError", "stopOnFirstError", bool),
  compile("engine.compile.followOpenFile", "followOpenFile", bool),

  ...SHORTCUT_DEFINITIONS.map(({ id }) => shortcutField(id)),
  ...EDITOR_KEY_DEFINITIONS.map(editorKeyField),

  pref("experimentation.latexTools", "latexTools", bool),
  pref("experimentation.notes", "notes", bool),
  pref("experimentation.overleafLive", "overleafLive", bool),
  pref("experimentation.pdfReview", "pdfReview", bool),
];
