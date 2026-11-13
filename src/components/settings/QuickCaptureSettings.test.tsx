// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useQuickCaptureStore } from "@/store/quick-capture";
import { useShortcutStore } from "@/store/shortcuts";
import { QuickCaptureSettings } from "./QuickCaptureSettings";

const strings = enSettings.shortcuts.quickCapture;

beforeEach(() => {
  Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
  useShortcutStore.getState().resetAll();
  useQuickCaptureStore.setState({ enabled: true, status: null });
});

afterEach(() => localStorage.clear());

describe("QuickCaptureSettings", () => {
  it("turns quick capture off and on and remembers it", () => {
    render(<QuickCaptureSettings />);
    const row = screen.getByRole("switch", { name: strings.label });
    expect(row).toHaveAttribute("aria-checked", "true");
    fireEvent.click(row);
    expect(useQuickCaptureStore.getState().enabled).toBe(false);
    expect(localStorage.getItem("oleafly.notes.quickCapture")).toBe("0");
  });

  it("says which keys open it once the shortcut is registered", () => {
    useQuickCaptureStore.setState({ status: { supported: true, registered: true, command: null, failure: null } });
    render(<QuickCaptureSettings />);
    expect(screen.getByText(strings.ready.replace("{{shortcut}}", "Ctrl+Shift+Alt+Space"))).toBeInTheDocument();
  });

  it("names the shortcut another app holds", () => {
    useQuickCaptureStore.setState({ status: { supported: true, registered: false, command: null, failure: "taken" } });
    render(<QuickCaptureSettings />);
    expect(screen.getByRole("alert")).toHaveTextContent(strings.taken.replace("{{shortcut}}", "Ctrl+Shift+Alt+Space"));
  });

  it("says when the chosen keys can't work outside Oleafly", () => {
    useShortcutStore.getState().setBinding("notesQuickCapture", { key: "é", mod: true, shift: true });
    render(<QuickCaptureSettings />);
    expect(screen.getByRole("alert")).toHaveTextContent(strings.invalid.replace("{{shortcut}}", "Ctrl+Shift+É"));
  });

  it("explains Wayland and offers the command to bind instead", () => {
    useQuickCaptureStore.setState({
      status: { supported: false, registered: false, command: "/usr/bin/oleafly --quick-capture", failure: null },
    });
    render(<QuickCaptureSettings />);
    const row = screen.getByRole("switch", { name: strings.label });
    expect(row).toHaveAttribute("aria-checked", "false");
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("settings-quick-capture-wayland")).toHaveTextContent(strings.wayland);
    expect(screen.getByText("/usr/bin/oleafly --quick-capture")).toBeInTheDocument();
    fireEvent.click(row);
    expect(useQuickCaptureStore.getState().enabled).toBe(true);
  });
});
