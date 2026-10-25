import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { registerTerminalSession, terminalJobs, terminalSessionFor } from "./terminal-sessions";

describe("terminal sessions", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("asks Rust about the tabs' sessions and maps the answer back to tabs", async () => {
    const stop1 = registerTerminalSession("terminal-1", "p", "term-a");
    const stop2 = registerTerminalSession("terminal-2", "p", "term-b");
    invoke.mockResolvedValue([{ id: "term-b", process: "node" }]);

    expect(await terminalJobs("p")).toEqual([{ tabId: "terminal-2", process: "node" }]);
    expect(invoke).toHaveBeenCalledWith("term_foreground", { projectId: "p", ids: ["term-a", "term-b"] });
    expect(terminalSessionFor("terminal-1")).toEqual({ projectId: "p", sessionId: "term-a" });

    stop1();
    expect(terminalSessionFor("terminal-1")).toBeUndefined();
    invoke.mockRejectedValue(new Error("gone"));
    expect(await terminalJobs("p")).toEqual([]);
    invoke.mockClear();
    expect(await terminalJobs("p", ["terminal-9"])).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
    stop2();
  });

  it("asks only about the requested tabs of the requested project", async () => {
    const stops = [
      registerTerminalSession("terminal-1", "p", "term-a"),
      registerTerminalSession("terminal-2", "p", "term-b"),
      registerTerminalSession("terminal-3", "q", "term-c"),
    ];
    invoke.mockResolvedValue([{ id: "term-b", process: null }, { id: "term-unknown", process: "vim" }]);

    expect(await terminalJobs("p", ["terminal-2", "terminal-3"])).toEqual([{ tabId: "terminal-2", process: null }]);
    expect(invoke).toHaveBeenCalledWith("term_foreground", { projectId: "p", ids: ["term-b"] });
    for (const stop of stops) stop();
  });

  it("keeps a newer session when an older one forgets the tab", () => {
    const stopOld = registerTerminalSession("terminal-1", "p", "term-old");
    const stopNew = registerTerminalSession("terminal-1", "p", "term-new");
    stopOld();
    expect(terminalSessionFor("terminal-1")).toEqual({ projectId: "p", sessionId: "term-new" });
    stopNew();
    expect(terminalSessionFor("terminal-1")).toBeUndefined();
  });
});
