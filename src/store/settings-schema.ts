import { LOCALE_INFO, SUPPORTED_LOCALES, type LocalePreference } from "@oleafly/i18n-contract";
import { currentLocale, i18n } from "@/i18n";
import { formatList } from "@/lib/intl";
import type { ThemePreference } from "@/lib/theme";
import { dictionaryLabel } from "@/lib/proofreading/dictionary-catalog";
import {
  ACCENTS,
  APP_FONTS,
  BROWSER_SEARCH_ENGINES,
  DEFAULT_HIDDEN_FILE_PATTERNS,
  EDITOR_FONTS,
  EDITOR_KEYMAP_MODES,
  EDITOR_LINE_HEIGHT_OPTIONS,
  EDITOR_THEMES,
  GRAMMAR_DIALECTS,
  PREF_DEFAULTS,
  TERMINAL_COLOR_THEMES,
  TERMINAL_FONTS,
  useSettingsStore,
  type LayoutPreset,
} from "@/store/settings";
import {
  SHORTCUT_DEFINITIONS,
  sameShortcutBinding,
  shortcutLabel,
  useShortcutStore,
  type ShortcutBinding,
  type ShortcutDefinition,
  type ShortcutId,
} from "@/store/shortcuts";
import {
  EDITOR_KEY_DEFAULTS,
  EDITOR_KEY_DEFINITIONS,
  editorKeyLabel,
  sameEditorKey,
  useEditorKeymapStore,
  type EditorKeyBindings,
  type EditorKeyDefinition,
  type EditorKeyId,
} from "@/store/editor-keymap";

// Every preference a person can change in Settings, declared once: where it
// is stored, which section shows it, its label, its default and the setter
// that writes it. Changed markers, section counts and the Changed settings
// view all read this list, so a new preference must be classified here (the
// schema test fails until it is).

type SettingsState = ReturnType<typeof useSettingsStore.getState>;

/**
 * Keys in PREF_DEFAULTS that are not settings: `vim` follows the keymap mode,
 * `offline` is never persisted, and the two dock flags are panel state.
 */
export const NOT_A_SETTING = ["vim", "offline", "terminalOpen", "browserOpen"] as const;

export type PreferenceKey = Exclude<keyof typeof PREF_DEFAULTS, (typeof NOT_A_SETTING)[number]>;
export type SettingId =
  | PreferenceKey
  | "theme"
  | `shortcut.${ShortcutId}`
  | `editorKey.${EditorKeyId}`;
export type SettingSectionId =
  | "general"
  | "appearance"
  | "dictionary"
  | "engine"
  | "shortcuts"
  | "experimentation";
export type SettingKind =
  | "toggle"
  | "choice"
  | "number"
  | "color"
  | "text"
  | "list"
  | "shortcut"
  | "editorKey";
export type SettingValues = Pick<SettingsState, PreferenceKey>;

export interface SettingsSnapshot {
  settings: SettingValues;
  shortcuts: Readonly<Record<ShortcutId, ShortcutBinding>>;
  editorKeys: Readonly<EditorKeyBindings>;
  themePreference: ThemePreference;
}

/** The theme preference lives in ThemeProvider, so its writer comes from React. */
export interface SettingWriteContext {
  setThemePreference(preference: ThemePreference): void;
}

export interface SettingOption<T> {
  value: T;
  label: string;
}

export interface SettingDefinition<T = unknown> {
  readonly id: SettingId;
  readonly storageKey: string;
  readonly section: SettingSectionId;
  /** The Appearance, Shortcuts or Engines tab that shows the control. */
  readonly tab?: string;
  readonly kind: SettingKind;
  label(): string;
  read(snapshot: SettingsSnapshot): T;
  /** A function so terminal colors can follow the chosen palette. */
  defaultValue(snapshot: SettingsSnapshot): T;
  equals?(left: T, right: T): boolean;
  /** Always goes through the existing setter, so its side effects still run. */
  write(value: T, ctx: SettingWriteContext): void;
  options?(): readonly SettingOption<T>[];
  format?(value: T): string;
  /** The toggle that hides this row while off; Show reveals it instead. */
  readonly revealVia?: SettingId;
}

const PREFERENCE_KEYS = (Object.keys(PREF_DEFAULTS) as (keyof typeof PREF_DEFAULTS)[]).filter(
  (key): key is PreferenceKey => !(NOT_A_SETTING as readonly string[]).includes(key),
);

/** The schema's store values, for a shallow-compared store selector. */
export function pickSettingValues(state: SettingsState): SettingValues {
  return Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, state[key]])) as SettingValues;
}

export function readSettingsSnapshot(themePreference: ThemePreference): SettingsSnapshot {
  return {
    settings: useSettingsStore.getState(),
    shortcuts: useShortcutStore.getState().bindings,
    editorKeys: useEditorKeymapStore.getState().keys,
    themePreference,
  };
}

const settings = () => useSettingsStore.getState();

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const expected = new Set(right);
  const actual = new Set(left);
  return actual.size === expected.size && [...actual].every((item) => expected.has(item));
}

// "" means unbound, which is its own value; sameEditorKey treats it as no match.
// Otherwise compare what the keys do on this platform: a Ctrl chord recorded
// on Windows or Linux is stored as Mod, which is the same key as Ctrl there.
function sameEditorKeyBinding(left: string, right: string): boolean {
  if (!left || !right) return left === right;
  return sameEditorKey(left, right);
}

const fontSizeLabel = (size: number) => i18n.t(($) => $.settings.appearance.fontSizeOption, { size });
const fontOptions = (fonts: readonly { name: string; value: string }[]) => () =>
  fonts.map(({ name, value }) => ({ value, label: name }));

const LISTED_ITEMS = 3;

/** A list setting's value as what was added to and removed from its default. */
const listChanges = (defaults: readonly string[]) => (value: readonly string[]) => {
  // A long side names a few items and counts the rest; the full list is in its section.
  const items = (list: readonly string[]) =>
    formatList(
      list.length > LISTED_ITEMS + 1
        ? [
            ...list.slice(0, LISTED_ITEMS),
            i18n.t(($) => $.settings.changed.values.more, { count: list.length - LISTED_ITEMS }),
          ]
        : list,
      { type: "unit", style: "short" },
    );
  const added = value.filter((item) => !defaults.includes(item));
  const removed = defaults.filter((item) => !value.includes(item));
  if (added.length > 0 && removed.length > 0) {
    return i18n.t(($) => $.settings.changed.values.addedAndRemoved, {
      added: items(added),
      removed: items(removed),
    });
  }
  if (removed.length > 0) {
    return i18n.t(($) => $.settings.changed.values.removed, { items: items(removed) });
  }
  return i18n.t(($) => $.settings.changed.values.added, { items: items(added) });
};

const LAYOUT_LABELS: Record<LayoutPreset, () => string> = {
  "editor-preview-ai": () => i18n.t(($) => $.shell.toolbar.layouts.editorPreviewAi),
  "editor-preview": () => i18n.t(($) => $.shell.toolbar.layouts.editorPreview),
  "editor-ai": () => i18n.t(($) => $.shell.toolbar.layouts.editorAi),
  "preview-ai": () => i18n.t(($) => $.shell.toolbar.layouts.previewAi),
  "editor-only": () => i18n.t(($) => $.shell.toolbar.layouts.editorOnly),
  "preview-only": () => i18n.t(($) => $.shell.toolbar.layouts.previewOnly),
  "ai-only": () => i18n.t(($) => $.shell.toolbar.layouts.aiOnly),
};

type StoreSettingSpec<K extends PreferenceKey> = Pick<
  SettingDefinition<SettingValues[K]>,
  | "storageKey"
  | "section"
  | "tab"
  | "kind"
  | "label"
  | "equals"
  | "options"
  | "format"
  | "revealVia"
> & {
  write(value: SettingValues[K]): void;
  defaultValue?(snapshot: SettingsSnapshot): SettingValues[K];
};

function storeSetting<K extends PreferenceKey>(
  id: K,
  { write, defaultValue, ...spec }: StoreSettingSpec<K>,
): SettingDefinition<SettingValues[K]> {
  return {
    id,
    ...spec,
    read: (snapshot) => snapshot.settings[id],
    // The rule lists are readonly defaults; every setter copies what it stores.
    defaultValue: defaultValue ?? (() => PREF_DEFAULTS[id] as unknown as SettingValues[K]),
    write: (value) => write(value),
  };
}

function shortcutSetting({ id, defaultBinding }: ShortcutDefinition): SettingDefinition<ShortcutBinding> {
  return {
    id: `shortcut.${id}`,
    storageKey: "oleafly.shortcuts",
    section: "shortcuts",
    tab: "application",
    kind: "shortcut",
    label: () => i18n.t(($) => $.settings.shortcuts.actions[id].label),
    read: (snapshot) => snapshot.shortcuts[id],
    defaultValue: () => defaultBinding,
    equals: sameShortcutBinding,
    write: (value) => useShortcutStore.getState().setBinding(id, value),
  };
}

function editorKeySetting({ id, defaultKey }: EditorKeyDefinition): SettingDefinition<string> {
  return {
    id: `editorKey.${id}`,
    storageKey: "oleafly.editorKeymap",
    section: "shortcuts",
    tab: "editor",
    kind: "editorKey",
    label: () => i18n.t(($) => $.settings.shortcuts.editorKeys.labels[id]),
    read: (snapshot) => snapshot.editorKeys[id],
    defaultValue: () => defaultKey,
    equals: sameEditorKeyBinding,
    write: (value) => useEditorKeymapStore.getState().setKey(id, value),
  };
}

const themeSetting: SettingDefinition<ThemePreference> = {
  id: "theme",
  storageKey: "oleafly.theme",
  section: "appearance",
  tab: "app",
  kind: "choice",
  label: () => i18n.t(($) => $.settings.appearance.app.theme.label),
  read: (snapshot) => snapshot.themePreference,
  defaultValue: () => "system",
  write: (value, ctx) => ctx.setThemePreference(value),
  options: () => [
    { value: "system", label: i18n.t(($) => $.shell.theme.system) },
    { value: "light", label: i18n.t(($) => $.shell.theme.light) },
    { value: "dark", label: i18n.t(($) => $.shell.theme.dark) },
  ],
};

const GENERAL = { section: "general" } as const;
const DICTIONARY = { section: "dictionary" } as const;
const APP = { section: "appearance", tab: "app" } as const;
const EDITOR = { section: "appearance", tab: "editor" } as const;
const TERMINAL = { section: "appearance", tab: "terminal" } as const;
const PDF = { section: "appearance", tab: "pdf" } as const;
const BROWSER = { section: "appearance", tab: "browser" } as const;
const FILES = { section: "appearance", tab: "files" } as const;
const ENGINE = { section: "engine", tab: "latex" } as const;
const EXPERIMENTATION = { section: "experimentation" } as const;

// Ordered like the settings navigation and the rows inside each section.
export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  storeSetting("uiLocalePreference", {
    ...GENERAL,
    kind: "choice",
    storageKey: "oleafly.locale",
    label: () => i18n.t(($) => $.settings.language.label),
    write: (value) => settings().setUiLocalePreference(value),
    options: () => [
      { value: "system" as LocalePreference, label: i18n.t(($) => $.settings.language.system) },
      ...SUPPORTED_LOCALES.map((locale) => ({ value: locale, label: LOCALE_INFO[locale].nativeName })),
    ],
  }),
  storeSetting("spellcheck", {
    ...GENERAL,
    kind: "toggle",
    storageKey: "oleafly.spellcheck",
    label: () => i18n.t(($) => $.shell.settings.general.spellcheck.label),
    // Spell check only has a toggle action.
    write: (value) => {
      if (settings().spellcheck !== value) settings().toggleSpellcheck();
    },
  }),
  storeSetting("harper", {
    ...GENERAL,
    kind: "toggle",
    storageKey: "oleafly.harper",
    label: () => i18n.t(($) => $.shell.settings.general.harper.label),
    write: (value) => settings().setHarper(value),
  }),
  storeSetting("grammarDialect", {
    ...GENERAL,
    kind: "choice",
    storageKey: "oleafly.harper.dialect",
    revealVia: "harper",
    label: () => i18n.t(($) => $.shell.settings.general.dialect.label),
    write: (value) => settings().setGrammarDialect(value),
    options: () => GRAMMAR_DIALECTS.map(({ id, name }) => ({ value: id, label: name })),
  }),
  storeSetting("showRegionalism", {
    ...GENERAL,
    kind: "toggle",
    storageKey: "oleafly.harper.regionalism",
    revealVia: "harper",
    label: () => i18n.t(($) => $.shell.settings.general.regionalism.label),
    write: (value) => settings().setShowRegionalism(value),
  }),
  storeSetting("showWordChoice", {
    ...GENERAL,
    kind: "toggle",
    storageKey: "oleafly.harper.wordchoice",
    revealVia: "harper",
    label: () => i18n.t(($) => $.shell.settings.general.wordChoice.label),
    write: (value) => settings().setShowWordChoice(value),
  }),
  storeSetting("dictionaryLocale", {
    ...GENERAL,
    kind: "choice",
    storageKey: "oleafly.dictionary.locale",
    revealVia: "spellcheck",
    label: () => i18n.t(($) => $.shell.settings.general.dictionary.label),
    write: (value) => settings().setDictionaryLocale(value),
    format: (value) => dictionaryLabel({ id: value, language: value, region: null }, currentLocale()),
  }),

  storeSetting("dockPlacement", {
    ...APP,
    kind: "choice",
    storageKey: "oleafly.dockPlacement",
    label: () => i18n.t(($) => $.settings.appearance.app.dock.label),
    write: (value) => settings().setDockPlacement(value),
    options: () => [
      { value: "left", label: i18n.t(($) => $.settings.appearance.app.dock.left) },
      { value: "bottom", label: i18n.t(($) => $.settings.appearance.app.dock.bottom) },
      { value: "right", label: i18n.t(($) => $.settings.appearance.app.dock.right) },
    ],
  }),
  storeSetting("bgPattern", {
    ...APP,
    kind: "choice",
    storageKey: "oleafly.bgPattern",
    label: () => i18n.t(($) => $.settings.appearance.app.bgPattern.label),
    write: (value) => settings().setBgPattern(value),
    options: () => [
      { value: "dots", label: i18n.t(($) => $.settings.appearance.app.bgPattern.dots) },
      { value: "grid", label: i18n.t(($) => $.settings.appearance.app.bgPattern.grid) },
      { value: "none", label: i18n.t(($) => $.common.state.none) },
    ],
  }),
  storeSetting("accentColor", {
    ...APP,
    kind: "color",
    storageKey: "oleafly.accent",
    label: () => i18n.t(($) => $.settings.appearance.app.accent.label),
    write: (value) => settings().setAccentColor(value),
    format: (value) => ACCENTS.find(({ color }) => color === value)?.name ?? value,
  }),
  themeSetting,
  storeSetting("appFontSize", {
    ...APP,
    kind: "number",
    storageKey: "oleafly.appFontSize",
    label: () => i18n.t(($) => $.settings.appearance.app.fontSize.label),
    write: (value) => settings().setAppFontSize(value),
    format: fontSizeLabel,
  }),
  storeSetting("appFontFamily", {
    ...APP,
    kind: "choice",
    storageKey: "oleafly.appFont",
    label: () => i18n.t(($) => $.settings.appearance.app.font.label),
    write: (value) => settings().setAppFontFamily(value),
    options: fontOptions(APP_FONTS),
  }),

  storeSetting("editorFontSize", {
    ...EDITOR,
    kind: "number",
    storageKey: "oleafly.fontSize",
    label: () => i18n.t(($) => $.settings.appearance.editor.fontSize.label),
    write: (value) => settings().setEditorFontSize(value),
    format: fontSizeLabel,
  }),
  storeSetting("editorFontFamily", {
    ...EDITOR,
    kind: "choice",
    storageKey: "oleafly.editorFont",
    label: () => i18n.t(($) => $.settings.appearance.editor.font.label),
    write: (value) => settings().setEditorFontFamily(value),
    options: fontOptions(EDITOR_FONTS),
  }),
  storeSetting("editorTheme", {
    ...EDITOR,
    kind: "choice",
    storageKey: "oleafly.editorTheme",
    label: () => i18n.t(($) => $.settings.appearance.editor.theme.label),
    write: (value) => settings().setEditorTheme(value),
    options: () => EDITOR_THEMES.map(({ id, name }) => ({ value: id, label: name })),
  }),
  storeSetting("editorKeymap", {
    ...EDITOR,
    kind: "choice",
    storageKey: "oleafly.editor.keymap",
    label: () => i18n.t(($) => $.settings.appearance.editor.keymap.label),
    write: (value) => settings().setEditorKeymap(value),
    options: () =>
      EDITOR_KEYMAP_MODES.map((mode) => ({
        value: mode,
        label: i18n.t(($) => $.settings.appearance.editor.keymap.options[mode]),
      })),
  }),
  storeSetting("editorTabSize", {
    ...EDITOR,
    kind: "number",
    storageKey: "oleafly.editor.tabSize",
    label: () => i18n.t(($) => $.settings.appearance.editor.tabSize.label),
    write: (value) => settings().setEditorTabSize(value),
  }),
  storeSetting("editorLineHeight", {
    ...EDITOR,
    kind: "choice",
    storageKey: "oleafly.editor.lineHeight",
    label: () => i18n.t(($) => $.settings.appearance.editor.lineHeight.label),
    write: (value) => settings().setEditorLineHeight(value),
    options: () =>
      EDITOR_LINE_HEIGHT_OPTIONS.map((option) => ({
        value: option,
        label: i18n.t(($) => $.settings.appearance.editor.lineHeight.options[option]),
      })),
  }),
  storeSetting("editorLineWrap", {
    ...EDITOR,
    kind: "toggle",
    storageKey: "oleafly.editor.lineWrap",
    label: () => i18n.t(($) => $.settings.appearance.editor.lineWrap.label),
    write: (value) => settings().setEditorLineWrap(value),
  }),
  storeSetting("editorAutocomplete", {
    ...EDITOR,
    kind: "toggle",
    storageKey: "oleafly.editor.autocomplete",
    label: () => i18n.t(($) => $.settings.appearance.editor.autocomplete.label),
    write: (value) => settings().setEditorAutocomplete(value),
  }),
  storeSetting("editorAutoCloseBrackets", {
    ...EDITOR,
    kind: "toggle",
    storageKey: "oleafly.editor.closeBrackets",
    label: () => i18n.t(($) => $.settings.appearance.editor.autoCloseBrackets.label),
    write: (value) => settings().setEditorAutoCloseBrackets(value),
  }),
  storeSetting("editorAutoCloseMath", {
    ...EDITOR,
    kind: "toggle",
    storageKey: "oleafly.editor.closeMath",
    label: () => i18n.t(($) => $.settings.appearance.editor.autoCloseMath.label),
    write: (value) => settings().setEditorAutoCloseMath(value),
  }),
  storeSetting("editorAutoCloseEnvironments", {
    ...EDITOR,
    kind: "toggle",
    storageKey: "oleafly.editor.closeEnvironments",
    label: () => i18n.t(($) => $.settings.appearance.editor.autoCloseEnvironments.label),
    write: (value) => settings().setEditorAutoCloseEnvironments(value),
  }),
  storeSetting("editorGhostCompletion", {
    ...EDITOR,
    kind: "toggle",
    storageKey: "oleafly.editor.ghostCompletion",
    label: () => i18n.t(($) => $.settings.appearance.editor.ghostCompletion.label),
    write: (value) => settings().setEditorGhostCompletion(value),
  }),
  storeSetting("editorNonBlinkingCursor", {
    ...EDITOR,
    kind: "toggle",
    storageKey: "oleafly.editor.solidCursor",
    label: () => i18n.t(($) => $.settings.appearance.editor.nonBlinkingCursor.label),
    write: (value) => settings().setEditorNonBlinkingCursor(value),
  }),
  storeSetting("editorStickyScroll", {
    ...EDITOR,
    kind: "toggle",
    storageKey: "oleafly.editor.stickyScroll",
    label: () => i18n.t(($) => $.settings.appearance.editor.stickyScroll.label),
    write: (value) => settings().setEditorStickyScroll(value),
  }),
  storeSetting("editorMathPreview", {
    ...EDITOR,
    kind: "toggle",
    storageKey: "oleafly.editor.mathPreview",
    label: () => i18n.t(($) => $.settings.appearance.editor.mathPreview.label),
    write: (value) => settings().setEditorMathPreview(value),
  }),

  storeSetting("terminalFontSize", {
    ...TERMINAL,
    kind: "number",
    storageKey: "oleafly.terminal.fontSize",
    label: () => i18n.t(($) => $.settings.appearance.terminal.fontSize.label),
    write: (value) => settings().setTerminalFontSize(value),
    format: fontSizeLabel,
  }),
  storeSetting("terminalFontFamily", {
    ...TERMINAL,
    kind: "choice",
    storageKey: "oleafly.terminal.fontFamily",
    label: () => i18n.t(($) => $.settings.appearance.terminal.font.label),
    write: (value) => settings().setTerminalFontFamily(value),
    options: fontOptions(TERMINAL_FONTS),
  }),
  storeSetting("terminalFontWeight", {
    ...TERMINAL,
    kind: "number",
    storageKey: "oleafly.terminal.fontWeight",
    label: () => i18n.t(($) => $.settings.appearance.terminal.fontWeight.label),
    write: (value) => settings().setTerminalFontWeight(value),
  }),
  storeSetting("terminalFontWeightBold", {
    ...TERMINAL,
    kind: "number",
    storageKey: "oleafly.terminal.fontWeightBold",
    label: () => i18n.t(($) => $.settings.appearance.terminal.fontWeightBold.label),
    write: (value) => settings().setTerminalFontWeightBold(value),
  }),
  storeSetting("terminalCursorStyle", {
    ...TERMINAL,
    kind: "choice",
    storageKey: "oleafly.terminal.cursorStyle",
    label: () => i18n.t(($) => $.settings.appearance.terminal.cursorStyle.label),
    write: (value) => settings().setTerminalCursorStyle(value),
    options: () => [
      { value: "block", label: i18n.t(($) => $.settings.appearance.terminal.cursorStyle.block) },
      { value: "underline", label: i18n.t(($) => $.settings.appearance.terminal.cursorStyle.underline) },
      { value: "bar", label: i18n.t(($) => $.settings.appearance.terminal.cursorStyle.bar) },
    ],
  }),
  storeSetting("terminalCursorBlink", {
    ...TERMINAL,
    kind: "toggle",
    storageKey: "oleafly.terminal.cursorBlink",
    label: () => i18n.t(($) => $.settings.appearance.terminal.cursorBlink.label),
    write: (value) => settings().setTerminalCursorBlink(value),
  }),
  storeSetting("terminalStartWithProject", {
    ...TERMINAL,
    kind: "toggle",
    storageKey: "oleafly.terminal.startWithProject",
    label: () => i18n.t(($) => $.settings.appearance.terminal.startWithProject.label),
    write: (value) => settings().setTerminalStartWithProject(value),
  }),
  storeSetting("terminalColorTheme", {
    ...TERMINAL,
    kind: "choice",
    storageKey: "oleafly.terminal.colorTheme",
    label: () => i18n.t(($) => $.settings.appearance.terminal.colorTheme.label),
    write: (value) => settings().setTerminalColorTheme(value),
    options: () => Object.values(TERMINAL_COLOR_THEMES).map(({ id, name }) => ({ value: id, label: name })),
  }),
  // Picking a palette rewrites all three colors, so each color is measured
  // against the chosen palette: a palette pick counts as one change, not four.
  storeSetting("terminalBackground", {
    ...TERMINAL,
    kind: "color",
    storageKey: "oleafly.terminal.background",
    label: () => i18n.t(($) => $.settings.appearance.terminal.colors.backgroundAriaLabel),
    write: (value) => settings().setTerminalBackground(value),
    defaultValue: ({ settings: values }) =>
      TERMINAL_COLOR_THEMES[values.terminalColorTheme].colors.background,
  }),
  storeSetting("terminalForeground", {
    ...TERMINAL,
    kind: "color",
    storageKey: "oleafly.terminal.foreground",
    label: () => i18n.t(($) => $.settings.appearance.terminal.colors.foregroundAriaLabel),
    write: (value) => settings().setTerminalForeground(value),
    defaultValue: ({ settings: values }) =>
      TERMINAL_COLOR_THEMES[values.terminalColorTheme].colors.foreground,
  }),
  storeSetting("terminalCursorColor", {
    ...TERMINAL,
    kind: "color",
    storageKey: "oleafly.terminal.cursorColor",
    label: () => i18n.t(($) => $.settings.appearance.terminal.colors.cursorAriaLabel),
    write: (value) => settings().setTerminalCursorColor(value),
    defaultValue: ({ settings: values }) =>
      TERMINAL_COLOR_THEMES[values.terminalColorTheme].colors.cursor,
  }),

  storeSetting("pdfDarkMode", {
    ...PDF,
    kind: "toggle",
    storageKey: "oleafly.pdf.darkMode",
    label: () => i18n.t(($) => $.settings.appearance.preview.darkMode.label),
    write: (value) => settings().setPdfDarkMode(value),
  }),
  storeSetting("pdfZoomShortcuts", {
    ...PDF,
    kind: "toggle",
    storageKey: "oleafly.pdf.zoomShortcuts",
    label: () => i18n.t(($) => $.settings.appearance.preview.zoomShortcuts.label),
    write: (value) => settings().setPdfZoomShortcuts(value),
  }),
  storeSetting("hoverPreview", {
    ...PDF,
    kind: "toggle",
    storageKey: "oleafly.hoverPreview",
    label: () => i18n.t(($) => $.settings.appearance.preview.hoverPreview.label),
    write: (value) => settings().setHoverPreview(value),
  }),

  storeSetting("browserSearchEngine", {
    ...BROWSER,
    kind: "choice",
    storageKey: "oleafly.browser.searchEngine",
    label: () => i18n.t(($) => $.settings.appearance.browser.searchEngine.label),
    write: (value) => settings().setBrowserSearchEngine(value),
    options: () => BROWSER_SEARCH_ENGINES.map(({ id, name }) => ({ value: id, label: name })),
  }),
  storeSetting("browserHomePage", {
    ...BROWSER,
    kind: "text",
    storageKey: "oleafly.browser.homePage",
    label: () => i18n.t(($) => $.settings.appearance.browser.homePage.label),
    write: (value) => settings().setBrowserHomePage(value),
  }),

  storeSetting("homeProjectLayout", {
    ...FILES,
    kind: "choice",
    storageKey: "oleafly.library.projectLayout",
    label: () => i18n.t(($) => $.settings.appearance.files.homeView.label),
    write: (value) => settings().setHomeProjectLayout(value),
    options: () => [
      { value: "grid", label: i18n.t(($) => $.settings.appearance.files.homeView.grid) },
      { value: "list", label: i18n.t(($) => $.settings.appearance.files.homeView.list) },
    ],
  }),
  storeSetting("defaultView", {
    ...FILES,
    kind: "choice",
    storageKey: "oleafly.defaultView",
    label: () => i18n.t(($) => $.settings.appearance.files.openIn.label),
    write: (value) => settings().setDefaultView(value),
    options: () =>
      (Object.keys(LAYOUT_LABELS) as LayoutPreset[]).map((preset) => ({
        value: preset,
        label: LAYOUT_LABELS[preset](),
      })),
  }),
  storeSetting("openInTree", {
    ...FILES,
    kind: "toggle",
    storageKey: "oleafly.openInTree",
    label: () => i18n.t(($) => $.settings.appearance.files.showTree.label),
    write: (value) => settings().setOpenInTree(value),
  }),
  storeSetting("hiddenFilePatterns", {
    ...FILES,
    kind: "list",
    storageKey: "oleafly.fileTree.hiddenPatterns",
    label: () => i18n.t(($) => $.settings.appearance.files.hidden.title),
    write: (value) => settings().setHiddenFilePatterns(value),
    equals: sameSet,
    format: listChanges(DEFAULT_HIDDEN_FILE_PATTERNS),
  }),

  // Reset through the setters so rules turned back on also forget the
  // findings dismissed under them.
  storeSetting("harperDisabledRules", {
    ...DICTIONARY,
    kind: "list",
    storageKey: "oleafly.harper.disabledRules",
    label: () => i18n.t(($) => $.settings.proofreading.turnedOff.listAriaLabel),
    write: (value) => settings().setHarperDisabledRules(value),
    equals: sameSet,
    format: listChanges(PREF_DEFAULTS.harperDisabledRules),
  }),
  storeSetting("harperEnabledRules", {
    ...DICTIONARY,
    kind: "list",
    storageKey: "oleafly.harper.enabledRules",
    label: () => i18n.t(($) => $.settings.proofreading.profileRules.title),
    write: (value) => settings().setHarperEnabledRules(value),
    equals: sameSet,
    format: listChanges(PREF_DEFAULTS.harperEnabledRules),
  }),

  storeSetting("defaultLatexEngine", {
    ...ENGINE,
    kind: "choice",
    storageKey: "oleafly.defaultLatexEngine",
    label: () => i18n.t(($) => $.settings.engine.defaultEngine.heading),
    write: (value) => settings().setDefaultLatexEngine(value),
    options: () => [
      { value: "tectonic", label: i18n.t(($) => $.settings.engine.choices.tectonic.name) },
      { value: "latexmk", label: i18n.t(($) => $.settings.engine.choices.latexmk.name) },
    ],
  }),

  ...SHORTCUT_DEFINITIONS.map(shortcutSetting),
  ...EDITOR_KEY_DEFINITIONS.map(editorKeySetting),

  storeSetting("latexTools", {
    ...EXPERIMENTATION,
    kind: "toggle",
    storageKey: "oleafly.latexTools",
    label: () => i18n.t(($) => $.shell.settings.experimentation.latexTools.label),
    write: (value) => settings().setLatexTools(value),
  }),
  storeSetting("webBrowser", {
    ...EXPERIMENTATION,
    kind: "toggle",
    storageKey: "oleafly.webBrowser",
    label: () => i18n.t(($) => $.shell.settings.experimentation.webBrowser.label),
    write: (value) => settings().setWebBrowser(value),
  }),
];

const DEFINITIONS_BY_ID = new Map<string, SettingDefinition>(
  SETTING_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function settingById(id: string): SettingDefinition | undefined {
  return DEFINITIONS_BY_ID.get(id);
}

export function isSettingChanged(definition: SettingDefinition, snapshot: SettingsSnapshot): boolean {
  const equals = definition.equals ?? Object.is;
  return !equals(definition.read(snapshot), definition.defaultValue(snapshot));
}

/** Changed settings in schema order. */
export function changedSettings(snapshot: SettingsSnapshot): SettingDefinition[] {
  return SETTING_DEFINITIONS.filter((definition) => isSettingChanged(definition, snapshot));
}

/** Sections with at least one changed setting; unchanged sections are left out. */
export function changedCountsBySection(
  snapshot: SettingsSnapshot,
): Partial<Record<SettingSectionId, number>> {
  const counts: Partial<Record<SettingSectionId, number>> = {};
  for (const { section } of changedSettings(snapshot)) {
    counts[section] = (counts[section] ?? 0) + 1;
  }
  return counts;
}

export function resetSetting(
  definition: SettingDefinition,
  snapshot: SettingsSnapshot,
  ctx: SettingWriteContext,
): void {
  definition.write(definition.defaultValue(snapshot), ctx);
}

export function formatSettingValue(definition: SettingDefinition, value: unknown): string {
  if (definition.format) return definition.format(value);
  if (definition.options) {
    const equals = definition.equals ?? Object.is;
    return (
      definition.options().find((option) => equals(option.value, value))?.label ??
      i18n.t(($) => $.settings.changed.values.custom)
    );
  }
  switch (definition.kind) {
    case "toggle":
      return value ? i18n.t(($) => $.common.state.on) : i18n.t(($) => $.common.state.off);
    case "shortcut":
      return shortcutLabel(value as ShortcutBinding);
    case "editorKey":
      return (
        editorKeyLabel(value as string) || i18n.t(($) => $.settings.shortcuts.editorKeys.unbound)
      );
    default:
      return String(value);
  }
}

const SHORTCUT_DEFAULTS = new Map(
  SHORTCUT_DEFINITIONS.map(({ id, defaultBinding }) => [id, defaultBinding]),
);

/** For the Shortcuts section, which also renders outside the Settings dialog. */
export function shortcutBindingChanged(id: ShortcutId, binding: ShortcutBinding): boolean {
  const fallback = SHORTCUT_DEFAULTS.get(id);
  return fallback ? !sameShortcutBinding(binding, fallback) : false;
}

export function editorKeyChanged(id: EditorKeyId, key: string): boolean {
  return !sameEditorKeyBinding(key, EDITOR_KEY_DEFAULTS[id]);
}
