import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  logError: vi.fn(),
  openProject: vi.fn(),
  openFile: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({ toast: { info: mocks.toastInfo } }));
vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create(() => ({
      projectId: null as string | null,
      activePath: null as string | null,
      openTabs: [] as string[],
      openProject: mocks.openProject,
      openFile: mocks.openFile,
    })),
  };
});

import { i18n } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { startStuckWindowRestore } from "./stuck-window-restore";

type Location = { projectId: string; path: string | null; openTabs?: string[] } | null;
type Restore = { reason: "unresponsive" | "unresponsive_again"; location: Location } | null;

function answerTake(location: Location, reason: "unresponsive" | "unresponsive_again" = "unresponsive") {
  answerRestore({ reason, location: location ? { openTabs: [], ...location } : null });
}

function answerRestore(restore: Restore) {
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "web_process_take_restore" ? restore : undefined,
  );
}

function notes() {
  return mocks.invoke.mock.calls
    .filter(([command]) => command === "web_process_note_location")
    .map(([, args]) => (args as { location: Location }).location);
}

const reloaded = () => i18n.t(($) => $.shell.stuckWindow.reloaded);
const reloadedAgain = () => i18n.t(($) => $.shell.stuckWindow.reloadedAgain);

describe("reopening the work after a stuck window reload", () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.logError.mockReset().mockResolvedValue(undefined);
    mocks.toastInfo.mockReset();
    mocks.openProject.mockReset().mockImplementation(async (id: string) => {
      useFilesStore.setState({ projectId: id, activePath: "main.tex", openTabs: ["main.tex"] });
    });
    mocks.openFile.mockReset().mockImplementation(async (path: string) => {
      const { openTabs } = useFilesStore.getState();
      useFilesStore.setState({
        activePath: path,
        openTabs: openTabs.includes(path) ? openTabs : [...openTabs, path],
      });
    });
    useFilesStore.setState({ projectId: null, activePath: null, openTabs: [] });
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
    expect(notes().at(-1)).toEqual({
      projectId: "p1",
      path: "chapters/intro.tex",
      openTabs: ["main.tex", "chapters/intro.tex"],
    });
  });

  it("explains the reload once and reopens every tab that was open", async () => {
    answerTake({ projectId: "p1", path: "refs.bib", openTabs: ["main.tex", "notes.md", "refs.bib"] });

    stop = await startStuckWindowRestore();

    expect(mocks.toastInfo).toHaveBeenCalledTimes(1);
    expect(mocks.toastInfo).toHaveBeenCalledWith(reloaded(), undefined, true);
    expect(reloaded()).toContain("stopped responding for 30 seconds");
    expect(mocks.openFile.mock.calls.map(([path]) => path)).toEqual(["notes.md", "refs.bib"]);
    expect(useFilesStore.getState()).toMatchObject({
      activePath: "refs.bib",
      openTabs: ["main.tex", "notes.md", "refs.bib"],
    });
  });

  it("keeps reopening the other tabs when one of them is gone", async () => {
    answerTake({ projectId: "p1", path: "main.tex", openTabs: ["deleted.tex", "notes.md"] });
    mocks.openFile.mockRejectedValueOnce(new Error("file not found"));

    stop = await startStuckWindowRestore();

    expect(mocks.logError).toHaveBeenCalledWith("reopen a tab after the window was reloaded", expect.any(Error));
    expect(mocks.openFile).toHaveBeenCalledWith("notes.md");
    expect(useFilesStore.getState().activePath).toBe("main.tex");
  });

  it("stops reopening tabs when another project took over the window", async () => {
    answerTake({ projectId: "p1", path: "b.tex", openTabs: ["a.tex", "b.tex"] });
    mocks.openFile.mockImplementationOnce(async () => {
      useFilesStore.setState({ projectId: "other", activePath: null, openTabs: [] });
    });

    stop = await startStuckWindowRestore();

    expect(mocks.openFile.mock.calls.map(([path]) => path)).toEqual(["a.tex"]);
  });

  it("reloads into the library and says why when the window hung again", async () => {
    answerRestore({ reason: "unresponsive_again", location: null });

    stop = await startStuckWindowRestore();

    expect(mocks.toastInfo).toHaveBeenCalledWith(reloadedAgain(), undefined, true);
    expect(reloadedAgain()).toContain("didn't reopen your project");
    expect(mocks.openProject).not.toHaveBeenCalled();
    expect(notes()).toEqual([null]);
  });

  it("leaves a normal start on the library", async () => {
    answerRestore(null);

    stop = await startStuckWindowRestore();

    expect(mocks.openProject).not.toHaveBeenCalled();
    expect(mocks.openFile).not.toHaveBeenCalled();
    expect(mocks.toastInfo).not.toHaveBeenCalled();
    expect(notes()).toEqual([null]);
  });

  it("does not reopen a file when the project came back without one", async () => {
    answerTake({ projectId: "p1", path: null });

    stop = await startStuckWindowRestore();

    expect(mocks.openProject).toHaveBeenCalledWith("p1");
    expect(mocks.openFile).not.toHaveBeenCalled();
  });

  it("tells Rust where the window is each time the project, file or tabs change", async () => {
    answerRestore(null);
    stop = await startStuckWindowRestore();

    useFilesStore.setState({ projectId: "p2", activePath: "main.tex", openTabs: ["main.tex"] });
    useFilesStore.setState({ projectId: "p2", activePath: "main.tex", openTabs: ["main.tex"] });
    useFilesStore.setState({ activePath: "refs.bib", openTabs: ["main.tex", "refs.bib"] });
    useFilesStore.setState({ openTabs: ["refs.bib", "main.tex"] });
    useFilesStore.setState({ projectId: null, activePath: null, openTabs: [] });
    useFilesStore.setState({ projectId: null, activePath: null, openTabs: [] });

    expect(notes()).toEqual([
      null,
      { projectId: "p2", path: "main.tex", openTabs: ["main.tex"] },
      { projectId: "p2", path: "refs.bib", openTabs: ["main.tex", "refs.bib"] },
      { projectId: "p2", path: "refs.bib", openTabs: ["refs.bib", "main.tex"] },
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
    useFilesStore.setState({ projectId: "p3", activePath: null, openTabs: [] });
    expect(notes().at(-1)).toEqual({ projectId: "p3", path: null, openTabs: [] });
  });
});
