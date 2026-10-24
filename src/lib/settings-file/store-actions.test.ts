// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/desktop", () => ({ changeLocalePreference: vi.fn(async () => undefined) }));
import { useDictionary } from "@/lib/dictionary";
import { EDITOR_KEY_DEFAULTS, useEditorKeymapStore } from "@/store/editor-keymap";
import { useSettingsStore } from "@/store/settings";
import { useShortcutStore } from "@/store/shortcuts";
import {
  applyEditorKeys,
  applyPreferences,
  applyShortcuts,
  defaultShortcutBinding,
  replaceGlobalWords,
} from "./apply";

const initial = {
  settings: useSettingsStore.getState(),
  shortcuts: useShortcutStore.getState(),
  editorKeys: useEditorKeymapStore.getState(),
};

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState(initial.settings, true);
  useShortcutStore.setState(initial.shortcuts, true);
  useEditorKeymapStore.setState(initial.editorKeys, true);
  useDictionary.setState({ ignored: {}, global: [], suppressed: {}, revision: 0 });
});

describe("shortcut batch", () => {
  it("leaves the store alone when nothing differs", () => {
    const listener = vi.fn();
    const stop = useShortcutStore.subscribe(listener);
    applyShortcuts({ recompile: null, zoomIn: defaultShortcutBinding("zoomIn") });
    stop();
    expect(listener).not.toHaveBeenCalled();
    expect(localStorage.getItem("oleafly.shortcuts")).toBeNull();
  });

  it("sets and resets only the bindings that differ", () => {
    useShortcutStore.getState().setBinding("zoomOut", { key: "m", mod: true });
    const listener = vi.fn();
    const stop = useShortcutStore.subscribe(listener);
    applyShortcuts({
      zoomOut: null,
      zoomIn: defaultShortcutBinding("zoomIn"),
      commandPalette: { key: "p", mod: true, shift: true },
    });
    stop();
    expect(listener).toHaveBeenCalledTimes(2);
    const { bindings } = useShortcutStore.getState();
    expect(bindings.zoomOut).toEqual(defaultShortcutBinding("zoomOut"));
    expect(bindings.commandPalette).toEqual({ key: "p", mod: true, shift: true });
    expect(JSON.parse(localStorage.getItem("oleafly.shortcuts") ?? "{}").commandPalette).toEqual({
      key: "p",
      mod: true,
      shift: true,
    });
  });
});

describe("editor key batch", () => {
  it("skips keys it can't parse and keys that already match", () => {
    const listener = vi.fn();
    const stop = useEditorKeymapStore.subscribe(listener);
    applyEditorKeys({ deleteLine: EDITOR_KEY_DEFAULTS.deleteLine, uppercase: "Hyper-u" });
    stop();
    expect(listener).not.toHaveBeenCalled();
  });

  it("normalizes, unbinds and saves the keys that differ", () => {
    const listener = vi.fn();
    const stop = useEditorKeymapStore.subscribe(listener);
    applyEditorKeys({ titleCase: "shift-mod-t", uppercase: "", deleteLine: EDITOR_KEY_DEFAULTS.deleteLine });
    stop();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(useEditorKeymapStore.getState().keys).toMatchObject({ titleCase: "Mod-Shift-t", uppercase: "" });
  });
});

describe("dictionary replacement", () => {
  it("keeps the revision when the list is unchanged", () => {
    replaceGlobalWords([]);
    expect(useDictionary.getState().revision).toBe(0);
  });

  it("replaces the global words in one update", () => {
    useDictionary.getState().ignoreGlobal("Tectonic");
    replaceGlobalWords(["Oleafly", "Typst"]);
    expect(useDictionary.getState().global).toEqual(["Oleafly", "Typst"]);
    expect(useDictionary.getState().revision).toBe(2);
  });
});

describe("preference batch", () => {
  it("does nothing for an empty or matching patch", () => {
    const listener = vi.fn();
    const stop = useSettingsStore.subscribe(listener);
    applyPreferences({});
    applyPreferences({ editorFontSize: useSettingsStore.getState().editorFontSize });
    stop();
    expect(listener).not.toHaveBeenCalled();
  });

  it("persists an experiment switch from a settings file", () => {
    useSettingsStore.setState({ latexTools: false });
    applyPreferences({ latexTools: true });
    expect(useSettingsStore.getState().latexTools).toBe(true);
    expect(localStorage.getItem("oleafly.latexTools")).toBe("1");
  });

  it("stops ignoring rules that are no longer disabled", () => {
    useSettingsStore.getState().setHarperDisabledRules(["SpellCheck", "LongSentences"]);
    applyPreferences({ harperDisabledRules: ["LongSentences"] });
    expect(useSettingsStore.getState().harperDisabledRules).toEqual(["LongSentences"]);
    expect(localStorage.getItem("oleafly.harper.disabledRules")).toBe('["LongSentences"]');
  });
});
