// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useShortcutStore } from "@/store/shortcuts";
import { ShortcutsSection } from "./ShortcutsSection";

const action = enSettings.shortcuts.actions.toggleZenMode;
const conflict = (name: string) => enSettings.shortcuts.error.conflict.replace("{{action}}", name);

beforeEach(() => {
  useShortcutStore.getState().resetAll();
});

describe("the Zen mode row in the application shortcuts", () => {
  it("lists the shortcut with its description and the default keys", () => {
    render(<ShortcutsSection />);
    expect(screen.getByText(action.label)).toBeInTheDocument();
    expect(screen.getByText(action.description)).toBeInTheDocument();
    const edit = screen.getByRole("button", { name: new RegExp(`^Edit ${action.label}`) });
    expect(edit).toHaveTextContent("Shift");
    expect(edit).toHaveTextContent("F11");
  });

  it("records a function key on its own as the new shortcut", () => {
    render(<ShortcutsSection />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Edit ${action.label}`) }));
    const capture = screen.getByRole("button", { name: new RegExp(`^Recording ${action.label}`) });
    fireEvent.keyDown(capture, { key: "F9" });
    expect(useShortcutStore.getState().bindings.toggleZenMode).toEqual({
      key: "F9",
      shift: false,
      alt: false,
    });
  });

  it("refuses a chord another action already has and says which one", () => {
    render(<ShortcutsSection />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Edit ${action.label}`) }));
    const capture = screen.getByRole("button", { name: new RegExp(`^Recording ${action.label}`) });
    fireEvent.keyDown(capture, { key: "F", ctrlKey: true, shiftKey: true });
    expect(screen.getByText(conflict(enSettings.shortcuts.actions.searchDocuments.label))).toBeInTheDocument();
    expect(useShortcutStore.getState().bindings.toggleZenMode).toEqual({ key: "F11", shift: true });
  });

  it("refuses a chord the editor already uses", () => {
    render(<ShortcutsSection />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Edit ${action.label}`) }));
    const capture = screen.getByRole("button", { name: new RegExp(`^Recording ${action.label}`) });
    fireEvent.keyDown(capture, { key: "i", ctrlKey: true });
    expect(screen.getByText(conflict(enSettings.shortcuts.builtIn.labels.italic))).toBeInTheDocument();
  });

  it("goes back to the default with its reset button", () => {
    useShortcutStore.getState().setBinding("toggleZenMode", { key: "z", mod: true, alt: true });
    render(<ShortcutsSection />);
    fireEvent.click(
      screen.getByRole("button", {
        name: enSettings.shortcuts.application.resetAriaLabel.replace("{{action}}", action.label),
      }),
    );
    expect(useShortcutStore.getState().bindings.toggleZenMode).toEqual({ key: "F11", shift: true });
  });
});
