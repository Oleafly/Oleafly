import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class<T> {
    onmessage: (message: T) => void = () => {};
  },
}));

import {
  installNotebookTool,
  notebookToolchainStatus,
  openCompiledHtml,
  removeNotebookTool,
  type NotebookInstallProgress,
} from "./notebook-commands";

type ProgressChannel = { onmessage: (progress: NotebookInstallProgress) => void };

const captured: { channel: ProgressChannel | null } = { channel: null };

function send(progress: NotebookInstallProgress): void {
  captured.channel?.onmessage(progress);
}

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
  captured.channel = null;
});

describe("notebook commands", () => {
  it("reads the toolchain status", async () => {
    const status = { quarto: {}, calepin: {}, runtimes: [] };
    invoke.mockResolvedValue(status);
    await expect(notebookToolchainStatus()).resolves.toBe(status);
    expect(invoke).toHaveBeenCalledWith("notebook_toolchain_status");
  });

  it("installs a tool with a progress channel and stops listening when it is done", async () => {
    const seen: NotebookInstallProgress[] = [];
    invoke.mockImplementation(async (_command: string, args: { onProgress: ProgressChannel }) => {
      captured.channel = args.onProgress;
      send({ tool: "quarto", phase: "downloading", receivedBytes: 1, totalBytes: 2 });
      return { installed: true };
    });
    await expect(installNotebookTool("quarto", (progress) => seen.push(progress))).resolves.toEqual({ installed: true });
    expect(invoke).toHaveBeenCalledWith("install_notebook_tool", { tool: "quarto", onProgress: expect.anything() });
    expect(seen).toEqual([{ tool: "quarto", phase: "downloading", receivedBytes: 1, totalBytes: 2 }]);
    send({ tool: "quarto", phase: "done", receivedBytes: 2, totalBytes: 2 });
    expect(seen).toHaveLength(1);
  });

  it("stops listening when the install fails", async () => {
    const seen: NotebookInstallProgress[] = [];
    invoke.mockImplementation(async (_command: string, args: { onProgress: ProgressChannel }) => {
      captured.channel = args.onProgress;
      throw new Error("offline");
    });
    await expect(installNotebookTool("calepin", (progress) => seen.push(progress))).rejects.toThrow("offline");
    send({ tool: "calepin", phase: "downloading", receivedBytes: 1, totalBytes: 2 });
    expect(seen).toEqual([]);
  });

  it.each([
    ["remove_notebook_tool", () => removeNotebookTool("calepin"), { tool: "calepin" }],
    ["open_compiled_html", () => openCompiledHtml("p1"), { projectId: "p1" }],
  ] as const)("sends %s with the expected arguments", async (command, call, args) => {
    await call();
    expect(invoke).toHaveBeenCalledWith(command, args);
  });
});
