import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemePreference } from "@/lib/theme";
import { DEFAULT_HIDDEN_FILE_PATTERNS, PREF_DEFAULTS, useSettingsStore } from "./settings";
import {
  SHORTCUT_DEFINITIONS,
  shortcutLabel,
  useShortcutStore,
} from "./shortcuts";
import {
  EDITOR_KEY_DEFINITIONS,
  editorKeyFromEvent,
  useEditorKeymapStore,
  type EditorKeyId,
} from "./editor-keymap";
import {
  changedCountsBySection,
  changedSettings,
  editorKeyChanged,
  formatSettingValue,
  isSettingChanged,
  NOT_A_SETTING,
  readSettingsSnapshot,
  resetSetting,
  SETTING_DEFINITIONS,
  settingById,
  type SettingDefinition,
  type SettingWriteContext,
} from "./settings-schema";
import { ALTERNATE_SHORTCUT, SETTING_ALTERNATES } from "./settings-schema-fixture";

// Switching the interface language would swap every label under test.
vi.mock("@/i18n/desktop", () => ({ changeLocalePreference: vi.fn() }));

const lsValues = new Map<string, string>();
let themePreference: ThemePreference = "system";
const ctx: SettingWriteContext = {
  setThemePreference: (preference) => {
    themePreference = preference;
  },
};
const snapshot = () => readSettingsSnapshot(themePreference);
const changedIds = () => changedSettings(snapshot()).map((definition) => definition.id);

function definition(id: string): SettingDefinition {
  const found = settingById(id);
  if (!found) throw new Error(`no setting ${id}`);
  return found;
}

function storedDefault(value: unknown): string {
  if (typeof value === "boolean") return value ? "1" : "0";
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

describe("settings schema", () => {
  beforeAll(() => {
    vi.stubGlobal("localStorage", {
      clear: () => lsValues.clear(),
      getItem: (key: string) => lsValues.get(key) ?? null,
      setItem: (key: string, value: string) => lsValues.set(key, value),
      removeItem: (key: string) => lsValues.delete(key),
    });
  });

  beforeEach(() => {
    lsValues.clear();
    themePreference = "system";
    useSettingsStore.getState().resetToDefaults();
    useShortcutStore.getState().resetAll();
    useEditorKeymapStore.getState().resetAll();
  });

  it("declares each setting once with a storage key, a known section and a label", () => {
    const ids = SETTING_DEFINITIONS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of SETTING_DEFINITIONS) {
      expect(entry.storageKey, entry.id).toMatch(/^oleafly\./u);
      expect([
        "general",
        "appearance",
        "dictionary",
        "engine",
        "shortcuts",
        "experimentation",
      ]).toContain(entry.section);
      const label = entry.label();
      expect(label, entry.id).toBeTruthy();
      expect(label, entry.id).not.toMatch(/^(settings|shell)\./u);
    }
  });

  it("covers every stored preference that is not transient state", () => {
    const declared = new Set<string>(SETTING_DEFINITIONS.map(({ id }) => id));
    const preferences = Object.keys(PREF_DEFAULTS);
    for (const key of NOT_A_SETTING) expect(preferences).toContain(key);
    for (const key of preferences) {
      expect(declared.has(key), key).toBe(!(NOT_A_SETTING as readonly string[]).includes(key));
    }
    for (const { id } of SHORTCUT_DEFINITIONS) expect(declared.has(`shortcut.${id}`), id).toBe(true);
    for (const { id } of EDITOR_KEY_DEFINITIONS) expect(declared.has(`editorKey.${id}`), id).toBe(true);
    expect(declared.has("theme")).toBe(true);
    expect(Object.keys(SETTING_ALTERNATES).sort()).toEqual([...declared].sort());
  });

  it("reports nothing changed at the defaults", () => {
    expect(changedIds()).toEqual([]);
    expect(changedCountsBySection(snapshot())).toEqual({});
  });

  it("lists changed settings in schema order and counts them per section", () => {
    useSettingsStore.getState().setEditorMathPreview(false);
    useShortcutStore.getState().setBinding("recompile", ALTERNATE_SHORTCUT);
    useEditorKeymapStore.getState().setKey("deleteLine", "Alt-F9");
    themePreference = "dark";

    expect(changedIds()).toEqual([
      "theme",
      "editorMathPreview",
      "shortcut.recompile",
      "editorKey.deleteLine",
    ]);
    expect(changedCountsBySection(snapshot())).toEqual({ appearance: 2, shortcuts: 2 });
  });

  it("measures terminal colors against the chosen palette", () => {
    useSettingsStore.getState().setTerminalColorTheme("dracula");
    expect(changedIds()).toEqual(["terminalColorTheme"]);

    useSettingsStore.getState().setTerminalBackground("#000000");
    expect(changedIds()).toEqual(["terminalColorTheme", "terminalBackground"]);
  });

  it("compares hidden file patterns as a set", () => {
    useSettingsStore.getState().removeHiddenFilePattern("*.aux");
    expect(changedIds()).toEqual(["hiddenFilePatterns"]);

    useSettingsStore.getState().addHiddenFilePattern("*.aux");
    expect(changedIds()).toEqual([]);
  });

  it("treats a re-recorded default shortcut as unchanged and a cleared editor key as changed", () => {
    useShortcutStore
      .getState()
      .setBinding("recompile", { key: "Enter", mod: true, shift: false, alt: false });
    expect(changedIds()).toEqual([]);

    useEditorKeymapStore.getState().setKey("deleteLine", "");
    expect(changedIds()).toEqual(["editorKey.deleteLine"]);
  });

  it.each([
    ["uppercase", { key: "u", ctrlKey: true }],
    ["lowercase", { key: "U", ctrlKey: true, shiftKey: true }],
    ["addCursorAbove", { key: "ArrowUp", ctrlKey: true, altKey: true }],
    ["addCursorBelow", { key: "ArrowDown", ctrlKey: true, altKey: true }],
  ] as const)("treats %s re-recorded with Ctrl on Windows as its default", (id, chord) => {
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    try {
      const recorded = editorKeyFromEvent({
        metaKey: false,
        altKey: false,
        shiftKey: false,
        ...chord,
      } as KeyboardEvent);
      expect(recorded).toMatch(/^Mod-/u);
      useEditorKeymapStore.getState().setKey(id as EditorKeyId, recorded ?? "");

      expect(editorKeyChanged(id as EditorKeyId, recorded ?? "")).toBe(false);
      expect(changedIds()).toEqual([]);
    } finally {
      Reflect.deleteProperty(navigator, "platform");
    }
  });

  it("points each hidden row at a toggle in its own section", () => {
    const gated = SETTING_DEFINITIONS.filter((entry) => entry.revealVia);
    expect(gated.map(({ id, revealVia }) => [id, revealVia])).toEqual([
      ["grammarDialect", "harper"],
      ["showRegionalism", "harper"],
      ["showWordChoice", "harper"],
      ["dictionaryLocale", "spellcheck"],
    ]);
    for (const entry of gated) {
      const gate = definition(entry.revealVia ?? "");
      expect(gate.kind).toBe("toggle");
      expect(gate.section).toBe(entry.section);
    }
  });

  it.each(SETTING_DEFINITIONS.map((entry) => [entry.id, entry] as const))(
    "changes and resets %s through its setter",
    (_id, entry) => {
      entry.write(SETTING_ALTERNATES[entry.id], ctx);
      expect(isSettingChanged(entry, snapshot())).toBe(true);

      resetSetting(entry, snapshot(), ctx);
      expect(isSettingChanged(entry, snapshot())).toBe(false);
      if (entry.id in PREF_DEFAULTS) {
        expect(localStorage.getItem(entry.storageKey)).toBe(
          storedDefault(PREF_DEFAULTS[entry.id as keyof typeof PREF_DEFAULTS]),
        );
      }
    },
  );

  it("clears every section count after the section resets", () => {
    for (const entry of SETTING_DEFINITIONS) entry.write(SETTING_ALTERNATES[entry.id], ctx);
    expect(changedIds().length).toBeGreaterThan(0);

    const settings = useSettingsStore.getState();
    settings.resetGeneralPreferences();
    settings.resetAppearancePreferences();
    ctx.setThemePreference("system");
    settings.resetEnginePreferences();
    settings.resetExperimentationPreferences();
    settings.setHarperDisabledRules([]);
    settings.setHarperEnabledRules([]);
    useShortcutStore.getState().resetAll();
    useEditorKeymapStore.getState().resetAll();

    expect(changedCountsBySection(snapshot())).toEqual({});
  });

  it("formats values for the changed settings list", () => {
    expect(formatSettingValue(definition("editorMathPreview"), false)).toBe("Off");
    expect(formatSettingValue(definition("shortcut.recompile"), ALTERNATE_SHORTCUT)).toBe(
      shortcutLabel(ALTERNATE_SHORTCUT),
    );
    expect(formatSettingValue(definition("editorKey.deleteLine"), "")).toBe("Not set");
    expect(formatSettingValue(definition("harperDisabledRules"), ["AnA", "Hedging", "Dashes"])).toBe(
      "Added AnA, Hedging, Dashes",
    );
    expect(formatSettingValue(definition("editorTheme"), "dracula")).toBe("Dracula");
    expect(formatSettingValue(definition("editorFontFamily"), "Comic Sans")).toBe("Custom");
    expect(formatSettingValue(definition("theme"), "dark")).toBe("Dark");
    expect(formatSettingValue(definition("editorFontSize"), 15)).toBe("15px");
    expect(formatSettingValue(definition("defaultView"), "editor-preview")).toBe(
      "Editor + Preview",
    );
  });

  it("shows what changed in a list rather than how long it is", () => {
    const patterns = definition("hiddenFilePatterns");
    const swapped = [...DEFAULT_HIDDEN_FILE_PATTERNS.filter((item) => item !== "*.aux"), "*.pdf"];

    expect(formatSettingValue(patterns, swapped)).toBe("Added *.pdf; removed *.aux");
    expect(formatSettingValue(patterns, [...DEFAULT_HIDDEN_FILE_PATTERNS, "*.pdf", "*.png"])).toBe(
      "Added *.pdf, *.png",
    );
    expect(
      formatSettingValue(
        patterns,
        DEFAULT_HIDDEN_FILE_PATTERNS.filter((item) => item !== "*.aux" && item !== "*.log"),
      ),
    ).toBe("Removed *.aux, *.log");
    expect(formatSettingValue(definition("harperEnabledRules"), ["LongSentences"])).toBe(
      "Added LongSentences",
    );
    // A long side names the first three items and counts the rest.
    expect(formatSettingValue(patterns, ["*.log"])).toBe(
      `Removed *.aux, *.toc, *.out, ${DEFAULT_HIDDEN_FILE_PATTERNS.length - 4} more`,
    );
  });
});
