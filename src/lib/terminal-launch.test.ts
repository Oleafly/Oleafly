import { beforeEach, describe, expect, it, vi } from "vitest";
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { TERMINAL_LIMIT, useTerminalsStore } from "@/store/terminals";
import {
  launchLine,
  openTerminalWith,
  type TerminalLaunch,
  TerminalLaunchError,
  terminalAvailable,
} from "./terminal-launch";

const lifecycle = vi.hoisted(() => ({
  requestTerminalPrompt: vi.fn(async (_prompt: unknown) => true),
  waitForTerminalPromptHost: vi.fn(async (_timeoutMs: number) => true),
}));

vi.mock("@/lib/terminal-lifecycle", () => lifecycle);

const launchText = enWorkspace.terminal.launch;

describe("terminal launches", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    lifecycle.requestTerminalPrompt.mockReset();
    lifecycle.requestTerminalPrompt.mockResolvedValue(true);
    lifecycle.waitForTerminalPromptHost.mockReset();
    lifecycle.waitForTerminalPromptHost.mockResolvedValue(true);
    useTerminalsStore.setState({ projectId: null, tabs: [], activeId: null, counters: {} });
    useFilesStore.setState({ projectId: null } as never);
    useSettingsStore.setState({ terminalOpen: false });
  });

  describe("the copyable line", () => {
    it("quotes a Windows program, arguments and environment for PowerShell", () => {
      expect(
        launchLine(
          {
            title: "x",
            command: "C:\\Program Files\\Claude\\claude.exe",
            args: ["login", "--x=it's"],
            env: { CLAUDE_CONFIG_DIR: "D:\\cfg" },
          },
          true,
        ),
      ).toBe("$env:CLAUDE_CONFIG_DIR='D:\\cfg'; & 'C:\\Program Files\\Claude\\claude.exe' 'login' '--x=it''s'");
    });

    it("quotes for POSIX shells", () => {
      expect(
        launchLine(
          {
            title: "x",
            command: "/usr/local/bin/claude",
            args: ["login"],
            env: { CLAUDE_CONFIG_DIR: "/c f" },
          },
          false,
        ),
      ).toBe("CLAUDE_CONFIG_DIR='/c f' '/usr/local/bin/claude' 'login'");
    });

    it("leaves the folder and the confirmation out of the line", () => {
      expect(
        launchLine({ title: "x", command: "/bin/a", cwd: "chapters", confirmText: "Runs a." }, false),
      ).toBe("'/bin/a'");
    });

    it("refuses PATH, bad names, folders outside the project and control characters", () => {
      const launches: TerminalLaunch[] = [
        { title: "x", command: "/bin/a", env: { PATH: "/x" } },
        { title: "x", command: "/bin/a", env: { path: "/x" } },
        { title: "x", command: "/bin/a", env: { "1BAD": "x" } },
        { title: "x", command: "/bin/a\nrm -rf /" },
        { title: "x", command: "/bin/a", cwd: "../chapters" },
      ];
      for (const launch of launches) {
        expect(() => launchLine(launch, false)).toThrow(TerminalLaunchError);
        expect(() => launchLine(launch, true)).toThrow(TerminalLaunchError);
      }
    });
  });

  it("explains a refusal in words the caller can show", () => {
    expect(new TerminalLaunchError("invalid").message).toBe(launchText.invalid);
    expect(new TerminalLaunchError("no-project").message).toBe(launchText.noProject);
    expect(new TerminalLaunchError("tab-limit").message).toBe(enWorkspace.terminal.limitReached);
    expect(new TerminalLaunchError("cancelled")).toMatchObject({ reason: "cancelled", name: "TerminalLaunchError" });
  });

  it("refuses without a project", async () => {
    expect(terminalAvailable()).toBe(false);
    await expect(openTerminalWith({ title: "x" })).rejects.toMatchObject({ reason: "no-project" });
    expect(useTerminalsStore.getState().tabs).toEqual([]);
  });

  it("adds a launched tab, opens the dock and returns its id", async () => {
    useTerminalsStore.getState().setProject("p");
    expect(terminalAvailable()).toBe(true);

    const { terminalId } = await openTerminalWith({
      title: "Sign in to Claude",
      command: "C:\\Program Files\\Claude\\claude.exe",
      args: ["login"],
      env: { CLAUDE_CONFIG_DIR: "D:\\cfg" },
    });

    const state = useTerminalsStore.getState();
    expect(state.tabs.find((tab) => tab.id === terminalId)).toMatchObject({
      title: "Sign in to Claude",
      autoStart: true,
      launch: { command: "C:\\Program Files\\Claude\\claude.exe", args: ["login"] },
      env: { CLAUDE_CONFIG_DIR: "D:\\cfg" },
    });
    expect(state.tabs.find((tab) => tab.id === terminalId)?.initialInput).toBeUndefined();
    expect(state.activeId).toBe(terminalId);
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
    expect(lifecycle.requestTerminalPrompt).not.toHaveBeenCalled();
  });

  it("opens a plain terminal in a folder of the project the files store has open", async () => {
    useFilesStore.setState({ projectId: "q" } as never);
    expect(terminalAvailable()).toBe(true);

    const { terminalId } = await openTerminalWith({ title: "chapters", cwd: "chapters" });

    const state = useTerminalsStore.getState();
    expect(state.projectId).toBe("q");
    const tab = state.tabs.find((candidate) => candidate.id === terminalId);
    expect(tab).toMatchObject({ title: "chapters", cwd: "chapters" });
    expect(tab?.launch).toBeUndefined();
  });

  it("asks first when confirmText is set and adds nothing when cancelled", async () => {
    useTerminalsStore.getState().setProject("p");
    lifecycle.requestTerminalPrompt.mockResolvedValue(false);

    await expect(
      openTerminalWith({
        title: "Install",
        command: "powershell",
        args: ["-Command", "irm https://example.org/i.ps1 | iex"],
        confirmText: "This runs the installer.",
      }),
    ).rejects.toMatchObject({ reason: "cancelled" });

    expect(lifecycle.waitForTerminalPromptHost).toHaveBeenCalledWith(2000);
    expect(lifecycle.requestTerminalPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "launch",
        title: "Install",
        description: "This runs the installer.",
        commandLine: expect.stringContaining("irm https://example.org/i.ps1 | iex"),
      }),
    );
    expect(useTerminalsStore.getState().tabs).toHaveLength(1);
    // The dock opened so the question could be asked.
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
  });

  it("runs a confirmed launch", async () => {
    useTerminalsStore.getState().setProject("p");

    const { terminalId } = await openTerminalWith({
      title: "Install",
      command: "/opt/tool/install.sh",
      args: ["--yes"],
      confirmText: "This runs the installer.",
    });

    expect(lifecycle.requestTerminalPrompt).toHaveBeenCalledTimes(1);
    expect(useTerminalsStore.getState().tabs.find((tab) => tab.id === terminalId)?.launch).toEqual({
      command: "/opt/tool/install.sh",
      args: ["--yes"],
    });
  });

  it("drops a confirmed launch when the project changed while asking", async () => {
    useTerminalsStore.getState().setProject("p");
    lifecycle.requestTerminalPrompt.mockImplementation(async () => {
      useTerminalsStore.getState().setProject("other");
      return true;
    });

    await expect(
      openTerminalWith({ title: "Install", command: "/opt/tool/install.sh", confirmText: "Runs it." }),
    ).rejects.toMatchObject({ reason: "cancelled" });
    expect(useTerminalsStore.getState().tabs).toHaveLength(1);
    expect(useTerminalsStore.getState().tabs[0].launch).toBeUndefined();
  });

  it("refuses folders outside the project, bad env keys and control characters", async () => {
    useTerminalsStore.getState().setProject("p");
    const tooMany = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`V${index}`, "x"]));
    const launches: TerminalLaunch[] = [
      { title: "t", cwd: "../x" },
      { title: "t", cwd: "chapters/../../x" },
      { title: "t", cwd: "/etc" },
      { title: "t", cwd: "C:\\x" },
      { title: "t", cwd: "C:/x" },
      { title: "t", cwd: "a\\b" },
      { title: "t", env: { PATH: "x" } },
      { title: "t", env: { Path: "x" } },
      { title: "t", env: { "A=B": "x" } },
      { title: "t", env: { A: "x\u0000y" } },
      // 4,097 characters but 8,194 bytes.
      { title: "t", env: { A: "é".repeat(4097) } },
      { title: "t", env: tooMany },
      { title: "t", command: "echo", args: ["a\nrm -rf ~"] },
      { title: "t", command: "echo\u001b[31m" },
    ];
    for (const launch of launches) {
      await expect(openTerminalWith(launch)).rejects.toMatchObject({ reason: "invalid" });
    }
    await expect(openTerminalWith({ title: "t", cwd: "../x" })).rejects.toThrow(launchText.invalid);
    expect(useTerminalsStore.getState().tabs).toHaveLength(1);
  });

  it("accepts the project root, nested folders and names that only start with dots", async () => {
    useTerminalsStore.getState().setProject("p");
    for (const cwd of ["", "chapters", "chapters/part one", "..notes", "a/.b"]) {
      await expect(openTerminalWith({ title: "t", cwd })).resolves.toEqual({ terminalId: expect.any(String) });
    }
  });

  it("refuses at the tab limit and says so", async () => {
    useTerminalsStore.getState().setProject("p");
    for (let count = 1; count < TERMINAL_LIMIT; count += 1) useTerminalsStore.getState().addTerminal();
    const info = vi.spyOn(toast, "infoUnique");

    await expect(openTerminalWith({ title: "x", command: "/bin/a", confirmText: "Runs a." })).rejects.toMatchObject({
      reason: "tab-limit",
    });

    expect(info).toHaveBeenCalledWith("terminal-limit", enWorkspace.terminal.limitReached);
    expect(lifecycle.requestTerminalPrompt).not.toHaveBeenCalled();
    expect(useTerminalsStore.getState().tabs).toHaveLength(TERMINAL_LIMIT);
  });
});
