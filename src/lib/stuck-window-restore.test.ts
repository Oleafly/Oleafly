import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  logError: vi.fn(),
  openProject: vi.fn(),
  openFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create(() => ({
      projectId: null as string | null,
      activePath: null as string | null,
      openProject: mocks.openProject,
      openFile: mocks.openFile,
    })),
  };
});

import { useFilesStore } from "@/store/files";
import { startStuckWindowRestore } from "./stuck-window-restore";

type Restore = { projectId: string; path: string | null } | null;

function answerTake(restore: Restore) {
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "web_process_take_restore" ? restore : undefined,
  );
}

function notes() {
  return mocks.invoke.mock.calls
    .filter(([command]) => command === "web_process_note_location")
    .map(([, args]) => (args as { location: Restore }).location);
}

describe("reopening the work after a stuck window reload", () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.logError.mockReset().mockResolvedValue(undefined);
    mocks.openProject.mockReset().mockImplementation(async (id: string) => {
      useFilesStore.setState({ projectId: id, activePath: "main.tex" });
    });
    mocks.openFile.mockReset().mockImplementation(async (path: string) => {
      useFilesStore.setState({ activePath: path });
    });
    useFilesStore.setState({ projectId: null, activePath: null });
  });

  afterEach(() => {
    stop?.();
    stop = null;
  });

  it("reopens the project and file that were open when the watchdog reloaded the window", async () => {
    answerTake({ projectId: "p1", path: "chapters/intro.tex" });

    stop = await startStuckWindowRestore();

    expect(mocks.openProject).toHaveBeenCalledWith("p1");
    expect(mocks.openFile).toHaveBeenCalledWith("chapters/intro.tex");
    expect(notes().at(-1)).toEqual({ projectId: "p1", path: "chapters/intro.tex" });
  });

  it("leaves a normal start on the library", async () => {
    answerTake(null);

    stop = await startStuckWindowRestore();

    expect(mocks.openProject).not.toHaveBeenCalled();
    expect(mocks.openFile).not.toHaveBeenCalled();
    expect(notes()).toEqual([null]);
  });

  it("does not reopen a file when the project came back without one", async () => {
    answerTake({ projectId: "p1", path: null });

    stop = await startStuckWindowRestore();

    expect(mocks.openProject).toHaveBeenCalledWith("p1");
    expect(mocks.openFile).not.toHaveBeenCalled();
  });

  it("tells Rust where the window is each time the project or file changes", async () => {
    answerTake(null);
    stop = await startStuckWindowRestore();

    useFilesStore.setState({ projectId: "p2", activePath: "main.tex" });
    useFilesStore.setState({ projectId: "p2", activePath: "main.tex" });
    useFilesStore.setState({ activePath: "refs.bib" });
    useFilesStore.setState({ projectId: null, activePath: null });

    expect(notes()).toEqual([
      null,
      { projectId: "p2", path: "main.tex" },
      { projectId: "p2", path: "refs.bib" },
      null,
    ]);
  });

  it("still tracks the window when reopening fails", async () => {
    answerTake({ projectId: "gone", path: null });
    mocks.openProject.mockRejectedValueOnce(new Error("project not found"));

    stop = await startStuckWindowRestore();

    expect(mocks.logError).toHaveBeenCalledWith(
      "reopen the project after the window was reloaded",
      expect.any(Error),
    );
    useFilesStore.setState({ projectId: "p3", activePath: null });
    expect(notes().at(-1)).toEqual({ projectId: "p3", path: null });
  });
});
