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
  useQuickCaptureStore.setState({ enabled: true, background: false, status: null });
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

  it("keeps quick capture ready in the background only while quick capture is on", () => {
    render(<QuickCaptureSettings />);
    const ready = screen.getByRole("switch", { name: strings.background.label });
    expect(screen.getByText(strings.background.description)).toBeInTheDocument();
    expect(ready).toHaveAttribute("aria-checked", "false");
    fireEvent.click(ready);
    expect(useQuickCaptureStore.getState().background).toBe(true);
    expect(localStorage.getItem("oleafly.notes.quickCapture.background")).toBe("1");
    fireEvent.click(screen.getByRole("switch", { name: strings.label }));
    expect(screen.getByRole("switch", { name: strings.background.label })).toHaveAttribute("aria-disabled", "true");
  });

  it("asks to move the app before it can start at sign-in", () => {
    useQuickCaptureStore.setState({
      background: true,
      status: { supported: true, registered: true, command: null, failure: null, atLogin: { state: "move_app" } },
    });
    render(<QuickCaptureSettings />);
    expect(screen.getByTestId("settings-quick-capture-move-app")).toHaveTextContent(
      enSettings.research.background.atLogin.moveApp,
    );
  });

  it("says which keys open it once the shortcut is registered", () => {
    useQuickCaptureStore.setState({ status: { supported: true, registered: true, command: null, failure: null, atLogin: { state: "disabled" } } });
    render(<QuickCaptureSettings />);
    expect(screen.getByText(strings.ready.replace("{{shortcut}}", "Ctrl+Shift+Alt+Space"))).toBeInTheDocument();
  });

  it("names the shortcut another app holds", () => {
    useQuickCaptureStore.setState({ status: { supported: true, registered: false, command: null, failure: "taken", atLogin: { state: "disabled" } } });
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
      status: {
        supported: false,
        registered: false,
        command: "/usr/bin/oleafly --quick-capture",
        failure: null,
        atLogin: { state: "disabled" },
      },
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
