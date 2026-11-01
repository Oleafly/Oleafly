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
    await user.click(path);
    await user.paste("  C:\\msys64\\usr\\bin\\zsh.exe ");
    fireEvent.blur(path);
    expect(useSettingsStore.getState().terminalShellPath).toBe("C:\\msys64\\usr\\bin\\zsh.exe");
  });

  it("warns while the custom shell has no path yet", async () => {
    invoke.mockResolvedValue(WINDOWS_SHELLS);
    useSettingsStore.setState({ terminalShell: "custom", terminalShellPath: "" });
    render(<TerminalBehaviorRows />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("term_shells"));
    expect(screen.getByTestId("terminal-shell-path-note")).toHaveTextContent(labels.shell.path.missing);

    const path = screen.getByLabelText(labels.shell.path.ariaLabel);
    fireEvent.change(path, { target: { value: "/usr/local/bin/fish" } });
    fireEvent.blur(path);
    await waitFor(() => expect(screen.queryByTestId("terminal-shell-path-note")).toBeNull());
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

  it("marks a saved shell that is not installed and says new terminals can't start", async () => {
    useSettingsStore.setState({ terminalShell: "gitBash" });
    invoke.mockResolvedValue(WINDOWS_SHELLS);
    render(<TerminalBehaviorRows />);
    const trigger = screen.getByLabelText(labels.shell.ariaLabel);
    await waitFor(() => expect(trigger).toHaveTextContent("Git Bash (not found)"));
    expect(screen.getByTestId("terminal-shell-note")).toHaveTextContent(
      "Git Bash isn't available on this computer, so new terminals can't start. Pick another shell.",
    );
  });

  it("marks nothing while the shell list loads, when it can't load, or for an installed shell", async () => {
    useSettingsStore.setState({ terminalShell: "gitBash" });
    invoke.mockReturnValue(new Promise(() => {}));
    const pending = render(<TerminalBehaviorRows />);
    expect(screen.getByLabelText(labels.shell.ariaLabel)).toHaveTextContent(/^Git Bash$/);
    expect(screen.queryByTestId("terminal-shell-note")).toBeNull();
    pending.unmount();

    invoke.mockReset().mockRejectedValue(new Error("no backend"));
    const failed = render(<TerminalBehaviorRows />);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.getByLabelText(labels.shell.ariaLabel)).toHaveTextContent(/^Git Bash$/);
    expect(screen.queryByTestId("terminal-shell-note")).toBeNull();
    failed.unmount();

    useSettingsStore.setState({ terminalShell: "pwsh" });
    invoke.mockReset().mockResolvedValue(WINDOWS_SHELLS);
    render(<TerminalBehaviorRows />);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.getByLabelText(labels.shell.ariaLabel)).toHaveTextContent(/^PowerShell 7$/);
    expect(screen.queryByTestId("terminal-shell-note")).toBeNull();
  });

  it("marks a Windows shell carried in by an import and names what starts instead", async () => {
    platform = "MacIntel";
    useSettingsStore.setState({ terminalShell: "gitBash" });
    invoke.mockResolvedValue([
      { id: "auto", resolved: "auto", name: "zsh", path: "/bin/zsh", available: true },
      { id: "custom", resolved: "custom", name: null, path: null, available: true },
    ]);
    render(<TerminalBehaviorRows />);
    expect(screen.getByLabelText(labels.shell.ariaLabel)).toHaveTextContent("Git Bash (Windows only)");
    await waitFor(() =>
      expect(screen.getByTestId("terminal-shell-note")).toHaveTextContent(
        "Git Bash only runs on Windows. New terminals here start zsh instead.",
      ),
    );
  });

  it("falls back to the default shell in the note when the login shell has no name", async () => {
    platform = "Linux x86_64";
    useSettingsStore.setState({ terminalShell: "wsl" });
    invoke.mockResolvedValue([
      { id: "auto", resolved: "auto", name: null, path: null, available: true },
      { id: "custom", resolved: "custom", name: null, path: null, available: true },
    ]);
    render(<TerminalBehaviorRows />);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(screen.getByLabelText(labels.shell.ariaLabel)).toHaveTextContent("WSL (Windows only)");
    expect(screen.getByTestId("terminal-shell-note")).toHaveTextContent(
      "WSL only runs on Windows. New terminals here start the default shell instead.",
    );
  });

  it("says what each Shift+Enter choice sends", async () => {
    invoke.mockResolvedValue(WINDOWS_SHELLS);
    const user = userEvent.setup();
    render(<TerminalBehaviorRows />);
    expect(screen.getByText(labels.shiftEnter.description)).toHaveTextContent("A new line lets chat-style tools");
    await user.click(screen.getByLabelText(labels.shiftEnter.ariaLabel));
    expect(await screen.findByRole("option", { name: "Insert a new line" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Send Enter" })).toBeInTheDocument();
  });
});
