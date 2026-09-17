// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { EDITOR_KEY_DEFAULTS, useEditorKeymapStore } from "@/store/editor-keymap";
import { useShortcutStore } from "@/store/shortcuts";
import { ShortcutsSection } from "./ShortcutsSection";

const labels = enSettings.shortcuts.editorKeys.labels;

async function openEditorTab() {
  await userEvent.setup().click(screen.getByTestId("shortcuts-tab-editor"));
}

function rowFor(id: keyof typeof labels) {
  return screen.getByTestId(`editor-key-row-${id}`);
}

function startCapture(id: keyof typeof labels) {
  const row = rowFor(id);
  const trigger = within(row).getByRole("button", { name: /^Edit / });
  fireEvent.click(trigger);
  return within(row).getByRole("button", { name: /^Recording / });
}

describe("ShortcutsSection editor keys", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, "platform", { value: "", configurable: true });
    useShortcutStore.getState().resetAll();
    useEditorKeymapStore.getState().resetAll();
  });

  it("lists every remappable editor key with its current binding", async () => {
    render(<ShortcutsSection />);
    await openEditorTab();

    expect(rowFor("deleteLine")).toHaveTextContent(labels.deleteLine);
    expect(within(rowFor("deleteLine")).getByText("Ctrl")).toBeInTheDocument();
    expect(within(rowFor("deleteLine")).getByText("D")).toBeInTheDocument();
    expect(rowFor("titleCase")).toHaveTextContent(enSettings.shortcuts.editorKeys.unbound);
  });

  it("records a new chord and persists it", async () => {
    render(<ShortcutsSection />);
    await openEditorTab();
    const capture = startCapture("deleteLine");

    fireEvent.keyDown(capture, { key: "K", ctrlKey: true, shiftKey: true });

    expect(useEditorKeymapStore.getState().keys.deleteLine).toBe("Mod-Shift-k");
    expect(
      JSON.parse(localStorage.getItem("oleafly.editorKeymap") ?? "{}").deleteLine,
    ).toBe("Mod-Shift-k");
  });

  it("refuses a chord already taken by an application shortcut", async () => {
    render(<ShortcutsSection />);
    await openEditorTab();
    const capture = startCapture("titleCase");

    fireEvent.keyDown(capture, { key: "k", ctrlKey: true });

    expect(rowFor("titleCase")).toHaveTextContent(
      enSettings.shortcuts.error.conflict.replace(
        "{{action}}",
        enSettings.shortcuts.actions.commandPalette.label,
      ),
    );
    expect(useEditorKeymapStore.getState().keys.titleCase).toBe("");
  });

  it("refuses a chord already taken by another editor key", async () => {
    render(<ShortcutsSection />);
    await openEditorTab();
    const capture = startCapture("titleCase");

    fireEvent.keyDown(capture, { key: "d", ctrlKey: true });

    expect(rowFor("titleCase")).toHaveTextContent(
      enSettings.shortcuts.error.conflict.replace("{{action}}", labels.deleteLine),
    );
  });

  it("refuses a chord the operating system reserves", async () => {
    render(<ShortcutsSection />);
    await openEditorTab();
    const capture = startCapture("titleCase");

    fireEvent.keyDown(capture, { key: "s", ctrlKey: true });

    expect(rowFor("titleCase")).toHaveTextContent(
      enSettings.shortcuts.error.reserved.replace(
        "{{shortcut}}",
        enSettings.shortcuts.reserved.save,
      ),
    );
  });

  it("unbinds with Backspace, cancels with Escape, and resets one row", async () => {
    render(<ShortcutsSection />);
    await openEditorTab();

    fireEvent.keyDown(startCapture("deleteLine"), { key: "Backspace" });
    expect(useEditorKeymapStore.getState().keys.deleteLine).toBe("");

    fireEvent.keyDown(startCapture("duplicate"), { key: "Escape" });
    expect(useEditorKeymapStore.getState().keys.duplicate).toBe(
      EDITOR_KEY_DEFAULTS.duplicate,
    );

    fireEvent.click(
      within(rowFor("deleteLine")).getByRole("button", { name: /^Reset / }),
    );
    expect(useEditorKeymapStore.getState().keys.deleteLine).toBe(
      EDITOR_KEY_DEFAULTS.deleteLine,
    );
  });

  it("restores both application shortcuts and editor keys from the reset control", () => {
    useEditorKeymapStore.getState().setKey("deleteLine", "Mod-Shift-k");
    useShortcutStore.getState().setBinding("recompile", { key: "r", mod: true, shift: true });
    render(<ShortcutsSection />);

    fireEvent.click(screen.getByRole("button", { name: enSettings.reset.button }));
    const confirmation = screen.getByRole("alertdialog");
    fireEvent.click(
      within(confirmation).getByRole("button", { name: enSettings.reset.button }),
    );

    expect(useEditorKeymapStore.getState().keys).toEqual({ ...EDITOR_KEY_DEFAULTS });
    expect(useShortcutStore.getState().bindings.recompile).toEqual({
      key: "Enter",
      mod: true,
    });
  });
});
