// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import en from "@/i18n/locales/en/workspace.json" with { type: "json" };
import {
  requestTerminalPrompt,
  resetTerminalLifecycleForTest,
  type TerminalPrompt,
  type TerminalStopReason,
} from "@/lib/terminal-lifecycle";
import { useSettingsStore } from "@/store/settings";
import { TerminalPrompts } from "./TerminalPrompts";

const stop = en.terminal.stop;

function cancelButton(): HTMLElement {
  return within(screen.getByRole("alertdialog")).getByRole("button", { name: /^Cancel/ });
}

function ask(prompt: TerminalPrompt): Promise<boolean> {
  let answer: Promise<boolean> = Promise.resolve(false);
  act(() => {
    answer = requestTerminalPrompt(prompt);
  });
  return answer;
}

describe("terminal prompts", () => {
  beforeEach(() => {
    resetTerminalLifecycleForTest();
    useSettingsStore.setState({ terminalConfirmClose: true });
  });

  it("shows the stop dialog with the right confirm label per reason and remembers Don't ask again", async () => {
    render(<TerminalPrompts />);
    const cases: Array<[TerminalStopReason, number, string]> = [
      ["close-tab", 1, stop.closeOne],
      ["close-tab", 2, stop.closeMany],
      ["close-project", 1, stop.closeProject],
      ["switch-project", 1, stop.switchProject],
      ["quit", 2, stop.quit],
      ["restart", 1, stop.restart],
    ];
    for (const [reason, count, label] of cases) {
      const jobs = Array.from({ length: count }, (_, index) => ({ title: `Terminal ${index + 1}`, process: "node" }));
      const answer = ask({ kind: "stop", reason, jobs });
      const dialog = screen.getByRole("alertdialog");
      expect(dialog).toHaveTextContent(count === 1 ? stop.titleOne : stop.titleMany);
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(await answer).toBe(true);
    }
    expect(useSettingsStore.getState().terminalConfirmClose).toBe(true);

    const named = ask({ kind: "stop", reason: "close-tab", jobs: [{ title: "Terminal 2", process: "python" }] });
    expect(screen.getByRole("alertdialog")).toHaveTextContent("python is still running in Terminal 2.");
    expect(screen.getByText(stop.dontAskHint)).toHaveTextContent("Settings, Appearance, Terminal");
    fireEvent.click(screen.getByRole("checkbox", { name: stop.dontAsk }));
    fireEvent.click(screen.getByRole("button", { name: stop.closeOne }));
    expect(await named).toBe(true);
    expect(useSettingsStore.getState().terminalConfirmClose).toBe(false);
  });

  it("names an unknown program and counts several terminals", async () => {
    render(<TerminalPrompts />);
    const unnamed = ask({ kind: "stop", reason: "close-tab", jobs: [{ title: "Build", process: null }] });
    expect(screen.getByRole("alertdialog")).toHaveTextContent("A program is still running in Build.");
    fireEvent.click(cancelButton());
    expect(await unnamed).toBe(false);

    const several = ask({
      kind: "stop",
      reason: "quit",
      jobs: [
        { title: "Terminal 1", process: "node" },
        { title: "Terminal 2", process: "vim" },
        { title: "Terminal 3", process: null },
      ],
    });
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Programs are still running in 3 terminals.");
    fireEvent.click(screen.getByRole("checkbox", { name: stop.dontAsk }));
    fireEvent.click(cancelButton());
    expect(await several).toBe(false);
    expect(useSettingsStore.getState().terminalConfirmClose).toBe(true);
  });

  it("shows a launch command in a code block and runs only on confirm", async () => {
    render(<TerminalPrompts />);
    const cancelled = ask({
      kind: "launch",
      title: "Install",
      description: "This runs the installer.",
      commandLine: "& 'C:\\Tools\\setup.exe' /S",
    });
    expect(screen.getByText(en.terminal.launch.title)).toBeInTheDocument();
    expect(screen.getByText("This runs the installer.")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-launch-command")).toHaveTextContent("& 'C:\\Tools\\setup.exe' /S");
    fireEvent.click(cancelButton());
    expect(await cancelled).toBe(false);

    const confirmed = ask({ kind: "launch", title: "Install", description: "Again.", commandLine: "x" });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${en.terminal.launch.run}`) }));
    expect(await confirmed).toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("never runs a launch command on a bare Enter, and Cancel has the focus", async () => {
    render(<TerminalPrompts />);
    const answer = ask({ kind: "launch", title: "Install", description: "x", commandLine: "x" });
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(en.terminal.launch.title);
    expect(within(dialog).getByRole("button", { name: new RegExp(`^${en.terminal.launch.run}`) })).not.toHaveTextContent(
      "↵",
    );

    fireEvent.keyDown(document.body, { key: "Enter" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await waitFor(() => expect(cancelButton()).toHaveFocus());

    fireEvent.click(cancelButton());
    expect(await answer).toBe(false);
  });

  it("answers an open prompt when the host goes away", async () => {
    const view = render(<TerminalPrompts />);
    const launch = ask({ kind: "launch", title: "Install", description: "x", commandLine: "x" });
    view.unmount();
    expect(await launch).toBe(false);
    expect(await requestTerminalPrompt({ kind: "stop", reason: "quit", jobs: [] })).toBe(true);
  });
});
