// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const theme = vi.hoisted(() => ({
  mode: "light" as "light" | "dark",
  listeners: new Set<() => void>(),
}));

vi.mock("@/lib/theme", () => ({
  currentTheme: () => theme.mode,
  subscribeTheme: (listener: () => void) => {
    theme.listeners.add(listener);
    return () => theme.listeners.delete(listener);
  },
}));

import { NOTES_APPEARANCE_DEFAULTS, type NotesAppearance } from "@/lib/notes-appearance";
import { useSettingsStore } from "@/store/settings";
import {
  attachNotesAppearance,
  resetCodePalettesForTest,
  notesAppearanceStyle,
  readCodePalette,
  useNotesAppearanceRef,
  writeNotesAppearance,
} from "./use-notes-appearance";

const PALETTES: Record<string, Record<string, string>> = {
  dracula: { "--cm-editor-bg": "#282a36", "--cm-editor-fg": "#f8f8f2", "--cm-keyword": "#ff79c6" },
  paper: { "--cm-editor-bg": "#faf6ec", "--cm-keyword": "#9a3e36" },
};

function stubComputedStyle() {
  return vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const palette = PALETTES[(element as HTMLElement).dataset.editorTheme ?? ""] ?? {};
    return { getPropertyValue: (name: string) => ` ${palette[name] ?? ""} ` } as CSSStyleDeclaration;
  });
}

const appearance = (changes: Partial<NotesAppearance> = {}): NotesAppearance => ({
  ...NOTES_APPEARANCE_DEFAULTS,
  ...changes,
});

const EDITOR = { light: "system", dark: "system" } as const;

beforeEach(() => {
  theme.mode = "light";
  theme.listeners.clear();
  resetCodePalettesForTest();
  useSettingsStore.getState().resetAppearancePreferences();
  useSettingsStore.setState({ editorThemeLight: "system", editorThemeDark: "system" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("code palettes", () => {
  it("reads a theme's colors once and leaves no probe behind", () => {
    const computed = stubComputedStyle();
    expect(readCodePalette("dracula")).toEqual({
      "--notes-code-bg": "#282a36",
      "--notes-code-fg": "#f8f8f2",
      "--notes-code-keyword": "#ff79c6",
    });
    expect(readCodePalette("dracula")).toEqual(readCodePalette("dracula"));
    expect(computed).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-editor-theme]")).toBeNull();
  });

  it("tries again later when the theme's styles were not there yet", () => {
    const computed = stubComputedStyle();
    expect(readCodePalette("nord")).toEqual({});
    expect(readCodePalette("nord")).toEqual({});
    expect(computed).toHaveBeenCalledTimes(2);
  });
});

describe("Notes appearance style", () => {
  it("leaves code blocks to the app colors by default", () => {
    const style = notesAppearanceStyle(appearance(), "light", EDITOR);
    expect(style.attributes["data-notes-code-theme"]).toBeNull();
    expect(style.variables["--notes-code-bg"]).toBeUndefined();
  });

  it("paints code blocks with a chosen theme or the editor's theme for the mode", () => {
    stubComputedStyle();
    const chosen = notesAppearanceStyle(appearance({ notesCodeTheme: "dracula" }), "light", EDITOR);
    expect(chosen.attributes["data-notes-code-theme"]).toBe("dracula");
    expect(chosen.variables["--notes-code-keyword"]).toBe("#ff79c6");
    const editor = { light: "paper", dark: "dracula" } as const;
    expect(notesAppearanceStyle(appearance({ notesCodeTheme: "editor" }), "light", editor).attributes).toMatchObject({
      "data-notes-code-theme": "paper",
    });
    expect(notesAppearanceStyle(appearance({ notesCodeTheme: "editor" }), "dark", editor).attributes).toMatchObject({
      "data-notes-code-theme": "dracula",
    });
    expect(notesAppearanceStyle(appearance({ notesCodeTheme: "editor" }), "dark", EDITOR).attributes).toMatchObject({
      "data-notes-code-theme": null,
    });
  });

  it("keeps the app colors when a theme's palette cannot be read", () => {
    stubComputedStyle();
    const style = notesAppearanceStyle(appearance({ notesCodeTheme: "nord" }), "dark", EDITOR);
    expect(style.attributes["data-notes-code-theme"]).toBeNull();
  });
});

describe("writing the style", () => {
  it("sets, changes and clears only what differs", () => {
    const element = document.createElement("div");
    const setProperty = vi.spyOn(element.style, "setProperty");
    const first = writeNotesAppearance(element, {
      variables: { "--a": "1", "--b": "2" },
      attributes: { "data-x": "on", "data-y": null, spellcheck: "false" },
    });
    expect(element.style.getPropertyValue("--a")).toBe("1");
    expect(element.getAttribute("data-x")).toBe("on");
    expect(element.hasAttribute("data-y")).toBe(false);
    expect(setProperty).toHaveBeenCalledTimes(2);
    writeNotesAppearance(element, { variables: { "--a": "1", "--c": "3" }, attributes: { "data-x": null } }, first);
    expect(setProperty).toHaveBeenCalledTimes(3);
    expect(element.style.getPropertyValue("--b")).toBe("");
    expect(element.style.getPropertyValue("--c")).toBe("3");
    expect(element.hasAttribute("data-x")).toBe(false);
    expect(element.hasAttribute("spellcheck")).toBe(false);
  });
});

describe("attaching to a Notes root", () => {
  it("follows the settings and the app theme until it is detached", () => {
    stubComputedStyle();
    const element = document.createElement("div");
    const detach = attachNotesAppearance(element);
    expect(element.style.getPropertyValue("--notes-text-size")).toBe("0.9375rem");

    act(() => useSettingsStore.getState().setNotesAppearance("notesFontSize", 20));
    expect(element.style.getPropertyValue("--notes-text-size")).toBe("1.25rem");
    act(() => useSettingsStore.getState().setNotesAppearance("notesSpellcheck", false));
    expect(element.getAttribute("spellcheck")).toBe("false");
    expect(element.hasAttribute("data-notes-task-box")).toBe(false);
    act(() => useSettingsStore.getState().setNotesAppearance("notesTaskBox", "square"));
    expect(element.getAttribute("data-notes-task-box")).toBe("square");
    expect(element.hasAttribute("data-notes-field-style")).toBe(false);
    act(() => useSettingsStore.getState().setNotesAppearance("notesFieldStyle", "outline"));
    expect(element.getAttribute("data-notes-field-style")).toBe("outline");

    useSettingsStore.setState({ editorThemeLight: "paper", editorThemeDark: "dracula" });
    act(() => useSettingsStore.getState().setNotesAppearance("notesCodeTheme", "editor"));
    expect(element.getAttribute("data-notes-code-theme")).toBe("paper");
    theme.mode = "dark";
    for (const listener of theme.listeners) listener();
    expect(element.getAttribute("data-notes-code-theme")).toBe("dracula");
    expect(element.style.getPropertyValue("--notes-code-bg")).toBe("#282a36");

    detach();
    expect(theme.listeners.size).toBe(0);
    expect(element.style.getPropertyValue("--notes-text-size")).toBe("");
    expect(element.hasAttribute("spellcheck")).toBe(false);
    expect(element.hasAttribute("data-notes-task-box")).toBe(false);
    expect(element.hasAttribute("data-notes-field-style")).toBe(false);
    expect(element.hasAttribute("data-notes-code-theme")).toBe(false);
    act(() => useSettingsStore.getState().setNotesAppearance("notesFontSize", 12));
    expect(element.style.getPropertyValue("--notes-text-size")).toBe("");
  });

  it("leaves the Notes root alone when an unrelated setting changes", () => {
    const element = document.createElement("div");
    const detach = attachNotesAppearance(element);
    const setProperty = vi.spyOn(element.style, "setProperty");
    const computed = vi.spyOn(window, "getComputedStyle");
    act(() => useSettingsStore.setState({ settingsOpen: !useSettingsStore.getState().settingsOpen }));
    expect(setProperty).not.toHaveBeenCalled();
    expect(computed).not.toHaveBeenCalled();
    act(() => useSettingsStore.getState().setNotesAppearance("notesFontSize", 21));
    expect(element.style.getPropertyValue("--notes-text-size")).toBe("1.3125rem");
    detach();
  });

  it("attaches through a ref while the element is mounted", () => {
    function Root({ shown }: Readonly<{ shown: boolean }>) {
      const ref = useNotesAppearanceRef<HTMLDivElement>();
      return shown ? <div ref={ref} data-testid="root" /> : null;
    }
    const view = render(<Root shown />);
    const root = view.getByTestId("root");
    expect(root.style.getPropertyValue("--notes-line-height")).toBe("1.7");
    act(() => useSettingsStore.getState().setNotesAppearance("notesLineHeight", "wide"));
    expect(root.style.getPropertyValue("--notes-line-height")).toBe("2");
    view.rerender(<Root shown={false} />);
    expect(root.style.getPropertyValue("--notes-line-height")).toBe("");
    expect(theme.listeners.size).toBe(0);
  });

  it("does nothing for a ref that has no element", () => {
    const holder: { attach?: (element: HTMLDivElement | null) => (() => void) | undefined } = {};
    function Probe() {
      holder.attach = useNotesAppearanceRef<HTMLDivElement>();
      return null;
    }
    render(<Probe />);
    expect(holder.attach?.(null)).toBeUndefined();
    expect(theme.listeners.size).toBe(0);
  });
});
