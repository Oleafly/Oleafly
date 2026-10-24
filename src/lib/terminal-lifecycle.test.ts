// @vitest-environment jsdom
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const terminalJobs = vi.hoisted(() => vi.fn());
vi.mock("@/lib/terminal-sessions", () => ({ terminalJobs }));

import { useSettingsStore } from "@/store/settings";
import { useTerminalsStore } from "@/store/terminals";
import {
  closeTerminalTabs,
  confirmStopTerminals,
  forgetConfirmedLeave,
  registerTerminalPromptHost,
  requestCloseTerminals,
  requestTerminalPrompt,
  resetTerminalLifecycleForTest,
  useTerminalPromptStore,
  waitForTerminalPromptHost,
} from "./terminal-lifecycle";

let unhost: (() => void) | null = null;

function tabs() {
  return useTerminalsStore.getState().tabs;
}

function answerOpenPrompt(ok: boolean) {
  const { prompt, answer } = useTerminalPromptStore.getState();
  if (!prompt) throw new Error("no prompt is open");
  answer(prompt.id, ok);
}

describe("terminal lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    resetTerminalLifecycleForTest();
    terminalJobs.mockReset().mockResolvedValue([]);
    useSettingsStore.setState({ terminalConfirmClose: true, terminalOpen: true });
    useTerminalsStore.setState({ projectId: null, tabs: [], activeId: null, counters: {} });
    useTerminalsStore.getState().setProject("p");
    useTerminalsStore.getState().addTerminal();
  });

  afterEach(() => {
    unhost?.();
    unhost = null;
    vi.useRealTimers();
  });

  it("closes at once without IPC when asking is off", async () => {
    useSettingsStore.setState({ terminalConfirmClose: false });
    const close = vi.fn();
    const done = requestCloseTerminals([tabs()[0].id], close);
    expect(close).toHaveBeenCalledTimes(1);
    expect(await done).toBe(true);
    expect(terminalJobs).not.toHaveBeenCalled();
  });

  it("closes without asking when nothing is running", async () => {
    unhost = registerTerminalPromptHost();
    const close = vi.fn();
    expect(await requestCloseTerminals([tabs()[1].id], close)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(terminalJobs).toHaveBeenCalledWith("p", [tabs()[1].id]);
    expect(useTerminalPromptStore.getState().prompt).toBeNull();
  });

  it("asks once, names the program and closes only on confirm", async () => {
    const second = tabs()[1];
    terminalJobs.mockResolvedValue([{ tabId: second.id, process: "python" }]);
    unhost = registerTerminalPromptHost();
    const close = vi.fn();
    const done = requestCloseTerminals([second.id], close);
    await waitFor(() =>
      expect(useTerminalPromptStore.getState().prompt).toMatchObject({
        kind: "stop",
        reason: "close-tab",
        jobs: [{ title: "Terminal 2", process: "python" }],
      }),
    );
    answerOpenPrompt(false);
    expect(await done).toBe(false);
    expect(close).not.toHaveBeenCalled();

    const again = requestCloseTerminals([second.id], close);
    await waitFor(() => expect(useTerminalPromptStore.getState().prompt).not.toBeNull());
    answerOpenPrompt(true);
    expect(await again).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("a newer prompt cancels the older one", async () => {
    unhost = registerTerminalPromptHost();
    const older = requestTerminalPrompt({ kind: "launch", title: "a", description: "a", commandLine: "a" });
    const newer = requestTerminalPrompt({ kind: "launch", title: "b", description: "b", commandLine: "b" });
    expect(await older).toBe(false);
    expect(useTerminalPromptStore.getState().prompt).toMatchObject({ title: "b" });
    answerOpenPrompt(true);
    expect(await newer).toBe(true);
  });

  it("never blocks quitting when no prompt host is mounted", async () => {
    terminalJobs.mockResolvedValue([{ tabId: tabs()[0].id, process: "node" }]);
    expect(await confirmStopTerminals({ reason: "quit" })).toBe(true);
    expect(await requestTerminalPrompt({ kind: "launch", title: "x", description: "x", commandLine: "x" })).toBe(false);
  });

  it("remembers a confirmed leave for a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    terminalJobs.mockResolvedValue([{ tabId: tabs()[0].id, process: "node" }]);
    unhost = registerTerminalPromptHost();

    const first = confirmStopTerminals({ reason: "close-project", projectId: "p" });
    await waitFor(() => expect(useTerminalPromptStore.getState().prompt).not.toBeNull());
    answerOpenPrompt(true);
    expect(await first).toBe(true);

    expect(await confirmStopTerminals({ reason: "switch-project", projectId: "p" })).toBe(true);
    expect(terminalJobs).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 61_000);
    const later = confirmStopTerminals({ reason: "close-project", projectId: "p" });
    await waitFor(() => expect(useTerminalPromptStore.getState().prompt).not.toBeNull());
    answerOpenPrompt(false);
    expect(await later).toBe(false);
  });

  it("asks again once the confirmed leave is over", async () => {
    terminalJobs.mockResolvedValue([{ tabId: tabs()[0].id, process: "node" }]);
    unhost = registerTerminalPromptHost();

    const first = confirmStopTerminals({ reason: "switch-project", projectId: "p" });
    await waitFor(() => expect(useTerminalPromptStore.getState().prompt).not.toBeNull());
    answerOpenPrompt(true);
    expect(await first).toBe(true);

    forgetConfirmedLeave("p");
    const later = confirmStopTerminals({ reason: "switch-project", projectId: "p" });
    await waitFor(() => expect(useTerminalPromptStore.getState().prompt).not.toBeNull());
    answerOpenPrompt(false);
    expect(await later).toBe(false);
  });

  it("treats a failed busy check as nothing running", async () => {
    unhost = registerTerminalPromptHost();
    terminalJobs.mockRejectedValue(new Error("gone"));
    expect(await confirmStopTerminals({ reason: "close-tab", tabIds: [tabs()[0].id] })).toBe(true);
    expect(useTerminalPromptStore.getState().prompt).toBeNull();
  });

  it("hides the dock when the last tabs close", () => {
    const [first, second] = tabs();
    closeTerminalTabs([second.id]);
    expect(tabs().map((tab) => tab.id)).toEqual([first.id]);
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
    closeTerminalTabs([first.id]);
    expect(tabs()).toEqual([]);
    expect(useSettingsStore.getState().terminalOpen).toBe(false);
  });

  it("waits for a prompt host, or gives up", async () => {
    vi.useFakeTimers();
    const gaveUp = waitForTerminalPromptHost(2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await gaveUp).toBe(false);

    const found = waitForTerminalPromptHost(2000);
    unhost = registerTerminalPromptHost();
    expect(await found).toBe(true);
    expect(await waitForTerminalPromptHost(10)).toBe(true);
  });
});
