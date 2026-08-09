import { describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));

import {
  mcpBeginRendererSession,
  mcpEndRendererSession,
  mcpSetActiveProject,
  setProjectShellEscapeCmd,
} from "@/lib/tauri";

describe("MCP renderer session commands", () => {
  it("never sends active-project state without the current renderer session", async () => {
    await expect(mcpSetActiveProject("before-begin")).rejects.toThrow("not ready");
    expect(invoke).not.toHaveBeenCalled();

    invoke.mockImplementation(async (command: string) => {
      if (command === "mcp_begin_renderer_session") return 41;
      return undefined;
    });

    await expect(mcpBeginRendererSession()).resolves.toBe(41);
    await mcpSetActiveProject("project-a");
    expect(invoke).toHaveBeenLastCalledWith("mcp_set_active_project", {
      projectId: "project-a",
      rendererSession: 41,
    });

    await mcpEndRendererSession(41);
    await expect(mcpSetActiveProject(null)).rejects.toThrow("not ready");
  });

  it("sends shell-escape consent through the dedicated trust command", async () => {
    invoke.mockResolvedValue({});
    await setProjectShellEscapeCmd("project-a", true);
    expect(invoke).toHaveBeenLastCalledWith("set_project_shell_escape", {
      projectId: "project-a",
      allowShellEscape: true,
    });
  });

  it("does not accept an invalid renderer session identifier", async () => {
    invoke.mockResolvedValue(0);
    await expect(mcpBeginRendererSession()).rejects.toThrow("invalid renderer session");
    await expect(mcpSetActiveProject("project-a")).rejects.toThrow("not ready");
  });
});
