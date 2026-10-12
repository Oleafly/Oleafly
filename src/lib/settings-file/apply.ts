import { useDictionary } from "@/lib/dictionary";
import { forgetWordIgnoredHere } from "@/lib/proofreading/ignored";
import { useEditorKeymapStore, type EditorKeyBindings, type EditorKeyId } from "@/store/editor-keymap";
import {
  SECTION_SETTINGS,
  TERMINAL_COLOR_THEMES,
  storedDefault,
  useSettingsStore,
  type PreferenceValues,
  type TerminalColorThemeId,
} from "@/store/settings";
import {
  SHORTCUT_DEFINITIONS,
  sameShortcutBinding,
  useShortcutStore,
  type ShortcutBinding,
  type ShortcutId,
} from "@/store/shortcuts";

type SettingsState = ReturnType<typeof useSettingsStore.getState>;

const STORAGE_KEYS: Readonly<Record<string, string | null>> = Object.assign({}, ...Object.values(SECTION_SETTINGS));
const PREFERENCE_KEYS: readonly string[] = Object.keys(STORAGE_KEYS);

export function preferencesDiffer(state: object, previous: object): boolean {
  const next = state as Record<string, unknown>;
  const last = previous as Record<string, unknown>;
  return PREFERENCE_KEYS.some((key) => next[key] !== last[key]);
}

const PROOFREADING_PREFERENCES: readonly string[] = [
  "spellcheck",
  "harper",
  "grammarDialect",
  "dictionaryLocale",
  "showRegionalism",
  "showWordChoice",
  "harperEnabledRules",
];

const OWN_SETTERS: readonly string[] = ["uiLocalePreference", "harperDisabledRules"];

export function sameSetting(left: unknown, right: unknown): boolean {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}

export function writeStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function withDerivedValues(patch: Partial<PreferenceValues>, state: SettingsState): Record<string, unknown> {
  const requested: Record<string, unknown> = { ...patch };
  if (patch.terminalColorTheme && patch.terminalColorTheme !== state.terminalColorTheme) {
    const colors = TERMINAL_COLOR_THEMES[patch.terminalColorTheme as TerminalColorThemeId].colors;
    requested.terminalBackground ??= colors.background;
    requested.terminalForeground ??= colors.foreground;
    requested.terminalCursorColor ??= colors.cursor;
  }
  if (patch.editorKeymap) requested.vim = patch.editorKeymap === "vim";
  for (const key of OWN_SETTERS) delete requested[key];
  return requested;
}

function announceProofreadingChange(state: SettingsState): void {
  window.dispatchEvent(
    new CustomEvent("oleafly:proofreading-settings-changed", {
      detail: { setting: "import", spellcheck: state.spellcheck, harper: state.harper },
    }),
  );
}

export function applyPreferences(patch: Partial<PreferenceValues>): void {
  const settings = useSettingsStore.getState();
  const state = settings as unknown as Record<string, unknown>;
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(withDerivedValues(patch, settings))) {
    if (value === undefined || sameSetting(state[key], value)) continue;
    const storageKey = STORAGE_KEYS[key];
    if (storageKey) writeStorage(storageKey, storedDefault(value));
    changed[key] = Array.isArray(value) ? [...value] : value;
  }
  const disabledRules =
    patch.harperDisabledRules && !sameSetting(settings.harperDisabledRules, patch.harperDisabledRules)
      ? patch.harperDisabledRules
      : null;
  if (Object.keys(changed).length > 0) {
    if (changed.webBrowser === false) changed.browserOpen = false;
    useSettingsStore.setState(changed as Partial<SettingsState>);
    if (!disabledRules && PROOFREADING_PREFERENCES.some((key) => key in changed)) {
      announceProofreadingChange(useSettingsStore.getState());
    }
  }
  if (disabledRules) settings.setHarperDisabledRules(disabledRules);
  if (patch.uiLocalePreference && patch.uiLocalePreference !== settings.uiLocalePreference) {
    settings.setUiLocalePreference(patch.uiLocalePreference);
  }
}

export function defaultShortcutBinding(id: ShortcutId): ShortcutBinding {
  for (const definition of SHORTCUT_DEFINITIONS) {
    if (definition.id === id) return definition.defaultBinding;
  }
  throw new Error(`Unknown shortcut ${id}`);
}

export function applyShortcuts(changes: Partial<Record<ShortcutId, ShortcutBinding | null>>): void {
  const { bindings, setBinding, resetBinding } = useShortcutStore.getState();
  for (const [id, binding] of Object.entries(changes) as [ShortcutId, ShortcutBinding | null][]) {
    if (sameShortcutBinding(bindings[id], binding ?? defaultShortcutBinding(id))) continue;
    if (binding) setBinding(id, binding);
    else resetBinding(id);
  }
}

export function applyEditorKeys(changes: Partial<EditorKeyBindings>): void {
  const { keys, setKey } = useEditorKeymapStore.getState();
  for (const [id, key] of Object.entries(changes) as [EditorKeyId, string][]) {
    if (keys[id] !== key) setKey(id, key);
  }
}

function wordKey(word: string): string {
  return word.toLocaleLowerCase("en-US");
}

export function replaceGlobalWords(words: readonly string[]): void {
  const current = useDictionary.getState().global;
  if (sameSetting(current, words)) return;
  const kept = new Set(words.map(wordKey));
  for (const word of current) {
    if (!kept.has(wordKey(word))) forgetWordIgnoredHere(word);
  }
  useDictionary.setState((state) => ({ global: [...words], revision: state.revision + 1 }));
}
