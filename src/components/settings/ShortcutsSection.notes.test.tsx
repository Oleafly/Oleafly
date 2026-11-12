// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { escapeRegExp } from "@/lib/regexp";
import { useSettingsStore } from "@/store/settings";
import { SHORTCUT_DEFINITIONS, sameShortcutBinding, type ShortcutBinding, useShortcutStore } from "@/store/shortcuts";
import { ShortcutsSection } from "./ShortcutsSection";

const actions = enSettings.shortcuts.actions;
const commandPalette = actions.commandPalette.label;
const notesShortcuts = [
  actions.notesQuickSwitcher,
  actions.notesTodayNote,
  actions.notesGraph,
  actions.notesLocalGraph,
  actions.notesOutline,
  actions.notesAskAgent,
  actions.notesNewNote,
  actions.notesSearch,
  actions.notesBookmark,
  actions.notesCopyLink,
  actions.notesProperties,
  actions.notesQuickCapture,
  actions.notesBack,
  actions.notesForward,
];
const builtIn = enSettings.shortcuts.builtIn.labels;

function setPlatform(value: string) {
  Object.defineProperty(navigator, "platform", { value, configurable: true });
  useShortcutStore.getState().resetAll();
}

function chord(binding: ShortcutBinding, apple: boolean): KeyboardEventInit {
  return {
    key: binding.key,
    code: `Key${binding.key.toUpperCase()}`,
    metaKey: apple && Boolean(binding.mod),
    ctrlKey: Boolean(binding.ctrl) || (!apple && Boolean(binding.mod)),
    shiftKey: Boolean(binding.shift),
    altKey: Boolean(binding.alt),
  };
}

async function openNotesTab() {
  useSettingsStore.setState({ notes: true });
  render(<ShortcutsSection />);
  await userEvent.setup().click(screen.getByTestId("shortcuts-tab-notes"));
  return screen.getByRole("tabpanel");
}

function record(panel: HTMLElement, label: string, keys: KeyboardEventInit) {
  fireEvent.click(within(panel).getByRole("button", { name: new RegExp(`^Edit ${escapeRegExp(label)},`) }));
  fireEvent.keyDown(within(panel).getByRole("button", { name: new RegExp(`^Recording ${escapeRegExp(label)}\\.`) }), keys);
}

beforeEach(() => {
  setPlatform("Win32");
});

afterEach(() => {
  useSettingsStore.setState({ notes: false });
});

describe("Notes shortcuts", () => {
  it("get their own Notes tab only while Notes is on, with the editor's own keys under them", async () => {
    useSettingsStore.setState({ notes: false });
    const { unmount } = render(<ShortcutsSection />);
    expect(screen.queryByTestId("shortcuts-tab-notes")).not.toBeInTheDocument();
    for (const shortcut of notesShortcuts) expect(screen.queryByText(shortcut.label)).not.toBeInTheDocument();
    unmount();
    useSettingsStore.setState({ notes: true });
    render(<ShortcutsSection />);
    for (const shortcut of notesShortcuts) expect(screen.queryByText(shortcut.label)).not.toBeInTheDocument();
    expect(screen.getByText(commandPalette)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByTestId("shortcuts-tab-notes"));
    const panel = screen.getByRole("tabpanel");
    for (const shortcut of notesShortcuts) {
      expect(within(panel).getByText(shortcut.label)).toBeInTheDocument();
      expect(within(panel).getByText(shortcut.description)).toBeInTheDocument();
    }
    for (const label of [builtIn.noteHighlight, builtIn.noteHeadings, builtIn.noteToggleTask, builtIn.noteLinkMenu]) {
      expect(within(panel).getByText(label)).toBeInTheDocument();
    }
    expect(within(panel).queryByText(commandPalette)).not.toBeInTheDocument();
  });

  it("gives each one a default that clashes with no other action", () => {
    const notes = SHORTCUT_DEFINITIONS.filter((definition) => definition.scope === "notes");
    expect(notes.map(({ id }) => id)).toEqual([
      "notesQuickSwitcher",
      "notesTodayNote",
      "notesGraph",
      "notesLocalGraph",
      "notesOutline",
      "notesAskAgent",
      "notesNewNote",
      "notesSearch",
      "notesBookmark",
      "notesCopyLink",
      "notesProperties",
      "notesQuickCapture",
      "notesCopyBlockLink",
      "notesBack",
      "notesForward",
    ]);
    for (const shortcut of notes) {
      const clashes = SHORTCUT_DEFINITIONS.filter(
        (other) => other.id !== shortcut.id && sameShortcutBinding(other.defaultBinding, shortcut.defaultBinding),
      );
      expect(clashes).toEqual([]);
    }
  });

  it.each([
    [false, { key: "o", mod: true, shift: false, alt: false }],
    [true, { key: "k", mod: true }],
  ])("blocks an action from taking a Notes shortcut only while Notes is on (Notes %s)", (notes, binding) => {
    useSettingsStore.setState({ notes });
    render(<ShortcutsSection />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Edit ${commandPalette}`) }));
    const capture = screen.getByRole("button", { name: new RegExp(`^Recording ${commandPalette}`) });
    fireEvent.keyDown(capture, { key: "o", code: "KeyO", ctrlKey: true });
    expect(useShortcutStore.getState().bindings.commandPalette).toEqual(binding);
  });

  it.each(["Win32", "Linux x86_64", "MacIntel"])("takes each Notes shortcut's own default without an error on %s", async (platform) => {
    setPlatform(platform);
    const panel = await openNotesTab();
    for (const { id, defaultBinding } of SHORTCUT_DEFINITIONS.filter(({ scope }) => scope === "notes")) {
      record(panel, actions[id].label, chord(defaultBinding, platform === "MacIntel"));
      expect(within(panel).queryByText(/^Already assigned to|is reserved by/u), id).not.toBeInTheDocument();
      expect(within(panel).queryByRole("button", { name: /^Recording / }), id).not.toBeInTheDocument();
      expect(sameShortcutBinding(useShortcutStore.getState().bindings[id], defaultBinding), id).toBe(true);
    }
  });

  it("shows Option as ⌥ on the built-in Notes keys on macOS", async () => {
    setPlatform("MacIntel");
    const panel = await openNotesTab();
    expect(within(panel).getByText(builtIn.noteHeadings)).toBeInTheDocument();
    expect(within(panel).getAllByText("⌥").length).toBeGreaterThan(0);
    expect(within(panel).queryByText("Alt")).not.toBeInTheDocument();
  });

  it.each([
    ["MacIntel", { key: "3", code: "Digit3", metaKey: true, altKey: true }],
    ["Win32", { key: "3", code: "Digit3", ctrlKey: true, altKey: true }],
  ])("warns that Mod+Alt+3 already sets a heading on %s", async (platform, keys) => {
    setPlatform(platform);
    const panel = await openNotesTab();
    const before = useShortcutStore.getState().bindings.notesNewNote;
    record(panel, actions.notesNewNote.label, keys);
    expect(within(panel).getByText(enSettings.shortcuts.error.conflict.replace("{{action}}", builtIn.noteHeadings))).toBeInTheDocument();
    expect(useShortcutStore.getState().bindings.notesNewNote).toEqual(before);
  });
});

