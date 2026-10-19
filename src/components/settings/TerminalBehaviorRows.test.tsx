// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/settings.json" with { type: "json" };

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { useSettingsStore } from "@/store/settings";
import { TerminalBehaviorRows } from "./TerminalBehaviorRows";

const labels = en.appearance.terminal;

const WINDOWS_SHELLS = [
  { id: "auto", resolved: "pwsh", name: "pwsh", path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", available: true },
  { id: "pwsh", resolved: "pwsh", name: "pwsh", path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", available: true },
  { id: "gitBash", resolved: "gitBash", name: "bash", path: "D:\\Tools\\Git\\bin\\bash.exe", available: false },
  { id: "custom", resolved: "custom", name: null, path: null, available: true },
];

let platform = "Win32";

beforeAll(() => {
  Object.defineProperty(window.navigator, "platform", { configurable: true, get: () => platform });
});

afterAll(() => {
  delete (window.navigator as unknown as Record<string, unknown>).platform;
});

describe("terminal behavior settings", () => {
  beforeEach(() => {
    platform = "Win32";
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    invoke.mockReset();
    useSettingsStore.setState({
      terminalShell: "auto",
      terminalShellPath: "",
      terminalShiftEnter: "newline",
      terminalCopyOnSelect: false,
      terminalOptionIsMeta: false,
      terminalScrollback: 5000,
      terminalConfirmClose: true,
    });
  });

  it("lists only installed shells and shows the path field for a custom shell", async () => {
    invoke.mockResolvedValue(WINDOWS_SHELLS);
    const user = userEvent.setup();
    render(<TerminalBehaviorRows />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("term_shells"));

    await user.click(screen.getByLabelText(labels.shell.ariaLabel));
    expect(await screen.findByRole("option", { name: "Default (PowerShell 7)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: labels.shell.options.pwsh })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: labels.shell.options.gitBash })).toBeNull();
    expect(screen.queryByLabelText(labels.shell.path.ariaLabel)).toBeNull();

    await user.click(screen.getByRole("option", { name: labels.shell.options.custom }));
    expect(useSettingsStore.getState().terminalShell).toBe("custom");
    const path = screen.getByLabelText(labels.shell.path.ariaLabel);
    await user.type(path, "  C:\\msys64\\usr\\bin\\zsh.exe ");
    fireEvent.blur(path);
    expect(useSettingsStore.getState().terminalShellPath).toBe("C:\\msys64\\usr\\bin\\zsh.exe");
  });

  it("names the login shell as the default on macOS and Linux", async () => {
    invoke.mockResolvedValue([
      { id: "auto", resolved: "auto", name: "zsh", path: "/bin/zsh", available: true },
      { id: "custom", resolved: "custom", name: null, path: null, available: true },
    ]);
    const user = userEvent.setup();
    render(<TerminalBehaviorRows />);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    await user.click(screen.getByLabelText(labels.shell.ariaLabel));
    expect(await screen.findByRole("option", { name: "Default (zsh)" })).toBeInTheDocument();
  });

  it("saves Shift+Enter, copy on select, scrollback and asking before close", async () => {
    invoke.mockResolvedValue(WINDOWS_SHELLS);
    const user = userEvent.setup();
    render(<TerminalBehaviorRows />);

    await user.click(screen.getByLabelText(labels.shiftEnter.ariaLabel));
    await user.click(await screen.findByRole("option", { name: labels.shiftEnter.enter }));
    expect(useSettingsStore.getState().terminalShiftEnter).toBe("enter");

    await user.click(screen.getByRole("switch", { name: labels.copyOnSelect.label }));
    expect(useSettingsStore.getState().terminalCopyOnSelect).toBe(true);

    await user.click(screen.getByLabelText(labels.scrollback.ariaLabel));
    await user.click(await screen.findByRole("option", { name: "25,000 lines" }));
    expect(useSettingsStore.getState().terminalScrollback).toBe(25000);

    await user.click(screen.getByRole("switch", { name: labels.confirmClose.label }));
    expect(useSettingsStore.getState().terminalConfirmClose).toBe(false);
  });

  it("shows Option as Meta on macOS only", async () => {
    invoke.mockResolvedValue([]);
    const view = render(<TerminalBehaviorRows />);
    expect(screen.queryByRole("switch", { name: labels.optionIsMeta.label })).toBeNull();
    view.unmount();

    platform = "MacIntel";
    const user = userEvent.setup();
    render(<TerminalBehaviorRows />);
    await user.click(screen.getByRole("switch", { name: labels.optionIsMeta.label }));
    expect(useSettingsStore.getState().terminalOptionIsMeta).toBe(true);
  });

  it("still offers the default and a custom path when the shell list can't load", async () => {
    invoke.mockRejectedValue(new Error("no backend"));
    const user = userEvent.setup();
    render(<TerminalBehaviorRows />);
    await waitFor(() => expect(invoke).toHaveBeenCalled());

    await user.click(screen.getByLabelText(labels.shell.ariaLabel));
    expect(await screen.findByRole("option", { name: labels.shell.options.defaultShell })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: labels.shell.options.custom })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("keeps a saved shell in the list after it was uninstalled", async () => {
    useSettingsStore.setState({ terminalShell: "gitBash" });
    invoke.mockResolvedValue(WINDOWS_SHELLS);
    render(<TerminalBehaviorRows />);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(screen.getByLabelText(labels.shell.ariaLabel)).toHaveTextContent(labels.shell.options.gitBash);
  });
});
