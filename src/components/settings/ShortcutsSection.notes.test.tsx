// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";
import { SHORTCUT_DEFINITIONS, sameShortcutBinding, useShortcutStore } from "@/store/shortcuts";
import { ShortcutsSection } from "./ShortcutsSection";

const actions = enSettings.shortcuts.actions;
const notesShortcuts = [
  actions.notesQuickSwitcher,
  actions.notesTodayNote,
  actions.notesGraph,
  actions.notesLocalGraph,
  actions.notesOutline,
  actions.notesAskAgent,
];

beforeEach(() => {
  useShortcutStore.getState().resetAll();
});

afterEach(() => {
  useSettingsStore.setState({ notes: false });
});

describe("Notes shortcuts in the application shortcuts", () => {
  it("lists them only while Notes is on", () => {
    useSettingsStore.setState({ notes: false });
    const { unmount } = render(<ShortcutsSection />);
    for (const shortcut of notesShortcuts) expect(screen.queryByText(shortcut.label)).not.toBeInTheDocument();
    unmount();
    useSettingsStore.setState({ notes: true });
    render(<ShortcutsSection />);
    for (const shortcut of notesShortcuts) {
      expect(screen.getByText(shortcut.label)).toBeInTheDocument();
      expect(screen.getByText(shortcut.description)).toBeInTheDocument();
    }
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
    ]);
    for (const shortcut of notes) {
      const clashes = SHORTCUT_DEFINITIONS.filter(
        (other) => other.id !== shortcut.id && sameShortcutBinding(other.defaultBinding, shortcut.defaultBinding),
      );
      expect(clashes).toEqual([]);
    }
  });
});
