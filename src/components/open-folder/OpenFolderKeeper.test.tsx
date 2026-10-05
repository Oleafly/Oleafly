// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderDetection } from "@/lib/folder-detection";
import type { ProjectTrust } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  projectTrustState: vi.fn(),
  projectFolderStatus: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  setShowTree: vi.fn(),
  setRailTab: vi.fn(),
  settings: { showTree: false, railTab: "outline" },
  refreshEngine: vi.fn(async () => {}),
  refreshGitStatus: vi.fn(async () => {}),
  writeFailureListeners: new Set<(projectId: string) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(name, handler);
    return () => mocks.listeners.delete(name);
  }),
}));
vi.mock("@/lib/tauri", () => ({
  projectTrustState: mocks.projectTrustState,
  projectFolderStatus: mocks.projectFolderStatus,
  onProjectWriteFailure: (listener: (projectId: string) => void) => {
    mocks.writeFailureListeners.add(listener);
    return () => mocks.writeFailureListeners.delete(listener);
  },
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create(() => ({
      projectId: null as string | null,
      loading: false,
      manifestHome: "library",
      mainDoc: "main.tex",
      tree: [] as { path: string; is_dir: boolean }[],
      projects: [] as { id: string; location?: { kind: string } }[],
      refreshEngine: mocks.refreshEngine,
    })),
  };
});
vi.mock("@/store/git-status", () => ({
  useGitStatusStore: { getState: () => ({ refresh: mocks.refreshGitStatus }) },
}));
vi.mock("@/store/settings", () => ({
  useSettingsStore: {
    getState: () => ({
      ...mocks.settings,
      setShowTree: mocks.setShowTree,
      setRailTab: mocks.setRailTab,
    }),
  },
}));

import { useFilesStore } from "@/store/files";
import { useFolderAccessStore } from "@/store/folder-access";
import { useOpenFolderStore } from "@/store/open-folder";
import { useProjectAvailabilityStore } from "@/store/project-availability";
import { OpenFolderKeeper } from "./OpenFolderKeeper";

const restricted: ProjectTrust = { trusted: false, source: null, parent: null, repository: null };
const trusted: ProjectTrust = { trusted: true, source: "folder", parent: null, repository: null };

function detection(decision: FolderDetection["decision"], main: string | null): FolderDetection {
  return {
    main,
    decision,
    source: "scan",
    candidates: [
      {
        path: "paper/main.tex",
        family: "latex",
        tier: "s",
        kind: "document",
        class: "article",
        title: null,
        depth: 1,
        reasons: [],
      },
      {
        path: "talk/slides.tex",
        family: "latex",
        tier: "s",
        kind: "presentation",
        class: "beamer",
        title: null,
        depth: 1,
        reasons: [],
      },
    ],
    truncated: false,
    compile_dir: null,
  };
}

async function openFolder(projectId: string, overrides: Record<string, unknown> = {}) {
  await act(async () => {
    useFilesStore.setState({
      projectId,
      loading: false,
      manifestHome: "device",
      mainDoc: "paper/main.tex",
      tree: [{ path: "paper/main.tex", is_dir: false }],
      ...overrides,
    } as never);
  });
}

beforeEach(() => {
  vi.useRealTimers();
  for (const fn of [
    mocks.projectTrustState,
    mocks.projectFolderStatus,
    mocks.setShowTree,
    mocks.setRailTab,
    mocks.refreshEngine,
    mocks.refreshGitStatus,
  ]) {
    fn.mockReset();
  }
  mocks.listeners.clear();
  mocks.settings = { showTree: false, railTab: "outline" };
  mocks.writeFailureListeners.clear();
  mocks.projectTrustState.mockResolvedValue(restricted);
  mocks.projectFolderStatus.mockResolvedValue({ read_only: false, synced_with: null });
  useFilesStore.setState({ projectId: null, loading: false, manifestHome: "library", projects: [] } as never);
  useOpenFolderStore.getState().dismiss();
  useFolderAccessStore.getState().reset(null);
  useProjectAvailabilityStore.getState().reset(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OpenFolderKeeper", () => {
  it("loads trust and folder status whenever a project opens", async () => {
    render(<OpenFolderKeeper />);
    await openFolder("linked-a");
    await vi.waitFor(() => expect(useFolderAccessStore.getState().loaded).toBe(true));
    expect(useFolderAccessStore.getState()).toMatchObject({ projectId: "linked-a", trust: restricted });
    await openFolder("linked-b");
    expect(useFolderAccessStore.getState().projectId).toBe("linked-b");
    expect(mocks.projectTrustState).toHaveBeenCalledWith("linked-b");
  });

  it("turns capabilities on when trust changes elsewhere, without reopening", async () => {
    render(<OpenFolderKeeper />);
    await openFolder("linked-a");
    await vi.waitFor(() => expect(mocks.listeners.has("project-trust-changed")).toBe(true));
    await vi.waitFor(() => expect(useFolderAccessStore.getState().loaded).toBe(true));
    mocks.projectTrustState.mockResolvedValue(trusted);
    await act(async () => {
      mocks.listeners.get("project-trust-changed")?.({ payload: "linked-a" });
    });
    await vi.waitFor(() => expect(useFolderAccessStore.getState().trust).toEqual(trusted));
  });

  it("turns the engine and Git back on once the open folder becomes trusted", async () => {
    const gitChanged = vi.fn();
    window.addEventListener("oleafly:git-changed", gitChanged);
    render(<OpenFolderKeeper />);
    await openFolder("linked-a");
    await vi.waitFor(() => expect(useFolderAccessStore.getState().loaded).toBe(true));
    expect(mocks.refreshEngine).not.toHaveBeenCalled();
    act(() => useFolderAccessStore.setState({ trust: trusted }));
    expect(mocks.refreshEngine).toHaveBeenCalledTimes(1);
    expect(mocks.refreshGitStatus).toHaveBeenCalledWith("linked-a");
    expect(gitChanged).toHaveBeenCalledTimes(1);
    act(() => useFolderAccessStore.setState({ trust: { ...trusted } }));
    expect(mocks.refreshEngine).toHaveBeenCalledTimes(1);
    window.removeEventListener("oleafly:git-changed", gitChanged);
  });

  it("reloads trust after a rebind reset the folder's grants", async () => {
    render(<OpenFolderKeeper />);
    await openFolder("linked-a");
    useProjectAvailabilityStore.getState().reset("linked-a");
    await vi.waitFor(() => expect(useFolderAccessStore.getState().loaded).toBe(true));
    mocks.projectTrustState.mockClear();
    act(() =>
      useProjectAvailabilityStore.getState().apply({
        projectId: "linked-a",
        availability: "ok",
        locationGeneration: 1,
        relocated: true,
        grantsReset: true,
      }),
    );
    await vi.waitFor(() => expect(mocks.projectTrustState).toHaveBeenCalledWith("linked-a"));
  });

  it("shows the file tree for a folder with no main", async () => {
    render(<OpenFolderKeeper />);
    await openFolder("linked-a", { mainDoc: "main.tex", tree: [] });
    act(() =>
      useOpenFolderStore.getState().present({
        project_id: "linked-a",
        detection: { ...detection("no_main", null), candidates: [] },
      }),
    );
    expect(mocks.setShowTree).toHaveBeenCalledWith(true);
    expect(mocks.setRailTab).toHaveBeenCalledWith("files");
    expect(useOpenFolderStore.getState().opened).toBeNull();
  });

  it("keeps an ambiguous folder presented for the picker and shows the tree behind it", async () => {
    render(<OpenFolderKeeper />);
    await openFolder("linked-a", { mainDoc: "main.tex", tree: [] });
    act(() =>
      useOpenFolderStore.getState().present({
        project_id: "linked-a",
        detection: detection("ask", null),
      }),
    );
    expect(useOpenFolderStore.getState().opened).not.toBeNull();
    expect(mocks.setShowTree).toHaveBeenCalledWith(true);
  });

  it("leaves the settings alone on later edits once the tree is already showing", async () => {
    render(<OpenFolderKeeper />);
    await openFolder("linked-a", { mainDoc: "main.tex", tree: [] });
    mocks.settings = { showTree: true, railTab: "files" };
    act(() =>
      useOpenFolderStore.getState().present({
        project_id: "linked-a",
        detection: detection("ask", null),
      }),
    );
    for (let edit = 0; edit < 5; edit++) {
      act(() =>
        useFilesStore.setState({ files: { "main.tex": { content: `x${edit}`, dirty: true, edits: edit } } } as never),
      );
    }
    expect(useOpenFolderStore.getState().opened).not.toBeNull();
    expect(mocks.setShowTree).not.toHaveBeenCalled();
    expect(mocks.setRailTab).not.toHaveBeenCalled();
  });

  it("takes a clear main without asking anything", async () => {
    render(<OpenFolderKeeper />);
    await openFolder("linked-a");
    act(() =>
      useOpenFolderStore.getState().present({
        project_id: "linked-a",
        detection: detection("auto", "paper/main.tex"),
      }),
    );
    expect(useOpenFolderStore.getState().opened).toBeNull();
    expect(mocks.setShowTree).not.toHaveBeenCalled();
  });

  it("waits for the editor to switch before taking a presented folder", async () => {
    render(<OpenFolderKeeper />);
    await openFolder("linked-a", { loading: true });
    act(() =>
      useOpenFolderStore.getState().present({
        project_id: "linked-b",
        detection: detection("auto", "paper/main.tex"),
      }),
    );
    expect(useOpenFolderStore.getState().opened).not.toBeNull();
    await openFolder("linked-b");
    expect(useOpenFolderStore.getState().opened).toBeNull();
  });

  it("forgets the folder's trust when the project closes", async () => {
    mocks.projectTrustState.mockResolvedValue(trusted);
    render(<OpenFolderKeeper />);
    await openFolder("linked-a");
    await vi.waitFor(() => expect(useFolderAccessStore.getState().projectId).toBe("linked-a"));

    await act(async () => {
      useFilesStore.setState({ projectId: null } as never);
    });

    expect(useFolderAccessStore.getState().projectId).toBeNull();
    expect(useFolderAccessStore.getState().trust).toBeNull();
  });

  it("drops an unanswered picker when the user leaves the project", async () => {
    render(<OpenFolderKeeper />);
    await openFolder("linked-a", { mainDoc: "main.tex", tree: [] });
    act(() =>
      useOpenFolderStore.getState().present({
        project_id: "linked-a",
        detection: detection("ask", null),
      }),
    );
    await openFolder("paper", { manifestHome: "library" });
    expect(useOpenFolderStore.getState().opened).toBeNull();
  });

  it("never scans an opened folder in the background", async () => {
    vi.useFakeTimers();
    render(<OpenFolderKeeper />);
    await openFolder("linked-a");
    act(() =>
      useOpenFolderStore.getState().present({
        project_id: "linked-a",
        detection: {
          ...detection("auto", "paper/main.tex"),
          source: "manifest",
          candidates: [],
        },
      }),
    );
    await openFolder("linked-b");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mocks.projectTrustState.mock.calls).toEqual([["linked-a"], ["linked-b"]]);
    expect(mocks.projectFolderStatus.mock.calls).toEqual([["linked-a"], ["linked-b"]]);
  });

  describe("folder permissions", () => {
    const readOnly = { read_only: true, synced_with: null };
    const writable = { read_only: false, synced_with: null };

    function refuseWrite(projectId: string) {
      for (const listener of mocks.writeFailureListeners) listener(projectId);
    }

    it("rechecks a linked folder once when the window regains focus and unlocks it", async () => {
      mocks.projectFolderStatus.mockResolvedValue(readOnly);
      render(<OpenFolderKeeper />);
      await openFolder("linked-a");
      await vi.waitFor(() => expect(useFolderAccessStore.getState().status).toEqual(readOnly));
      vi.useFakeTimers();
      mocks.projectFolderStatus.mockClear();
      mocks.projectFolderStatus.mockResolvedValue(writable);
      act(() => {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("focus"));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(mocks.projectFolderStatus.mock.calls).toEqual([["linked-a"]]);
      expect(useFolderAccessStore.getState().status).toEqual(writable);
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(mocks.projectFolderStatus).toHaveBeenCalledTimes(2);
    });

    it("rechecks a linked folder once each time the window becomes visible", async () => {
      mocks.projectFolderStatus.mockResolvedValue(readOnly);
      render(<OpenFolderKeeper />);
      await openFolder("linked-a");
      await vi.waitFor(() => expect(useFolderAccessStore.getState().status).toEqual(readOnly));
      vi.useFakeTimers();
      mocks.projectFolderStatus.mockClear();
      mocks.projectFolderStatus.mockResolvedValue(writable);
      let visibility: DocumentVisibilityState = "hidden";
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
      try {
        await act(async () => {
          document.dispatchEvent(new Event("visibilitychange"));
          await vi.advanceTimersByTimeAsync(1_000);
        });
        expect(mocks.projectFolderStatus).not.toHaveBeenCalled();
        visibility = "visible";
        await act(async () => {
          document.dispatchEvent(new Event("visibilitychange"));
          await vi.advanceTimersByTimeAsync(1_000);
        });
        expect(mocks.projectFolderStatus.mock.calls).toEqual([["linked-a"]]);
        expect(useFolderAccessStore.getState().status).toEqual(writable);
        mocks.projectFolderStatus.mockResolvedValue(readOnly);
        await act(async () => {
          document.dispatchEvent(new Event("visibilitychange"));
          window.dispatchEvent(new Event("focus"));
          await vi.advanceTimersByTimeAsync(1_000);
        });
      } finally {
        Reflect.deleteProperty(document, "visibilityState");
      }
      expect(mocks.projectFolderStatus).toHaveBeenCalledTimes(2);
      expect(useFolderAccessStore.getState().status).toEqual(readOnly);
    });

    it("leaves a library project alone when the window regains focus or a write fails", async () => {
      mocks.projectFolderStatus.mockResolvedValue(null);
      render(<OpenFolderKeeper />);
      await openFolder("paper", {
        manifestHome: "library",
        projects: [{ id: "paper", location: { kind: "library" } }],
      });
      await vi.waitFor(() => expect(useFolderAccessStore.getState().loaded).toBe(true));
      vi.useFakeTimers();
      mocks.projectFolderStatus.mockClear();
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(1_000);
        refuseWrite("paper");
      });
      expect(mocks.projectFolderStatus).not.toHaveBeenCalled();
    });

    it("rechecks the folder when the backend refuses a write in it", async () => {
      render(<OpenFolderKeeper />);
      await openFolder("linked-a");
      await vi.waitFor(() => expect(useFolderAccessStore.getState().status).toEqual(writable));
      mocks.projectFolderStatus.mockClear();
      mocks.projectFolderStatus.mockResolvedValue(readOnly);
      act(() => refuseWrite("linked-b"));
      expect(mocks.projectFolderStatus).not.toHaveBeenCalled();
      act(() => refuseWrite("linked-a"));
      await vi.waitFor(() => expect(useFolderAccessStore.getState().status).toEqual(readOnly));
      expect(mocks.projectFolderStatus.mock.calls).toEqual([["linked-a"]]);
    });
  });

  describe("checks it skips", () => {
    it("rechecks a linked folder whose status is not known yet when the window regains focus", async () => {
      mocks.projectFolderStatus.mockResolvedValue(null);
      render(<OpenFolderKeeper />);
      await openFolder("linked-a", {
        projects: [{ id: "linked-a", location: { kind: "linked", display_path: "~/papers/a" } }],
      });
      await vi.waitFor(() => expect(useFolderAccessStore.getState().loaded).toBe(true));
      vi.useFakeTimers();
      mocks.projectFolderStatus.mockClear();

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(1_000);
      });

      expect(mocks.projectFolderStatus.mock.calls).toEqual([["linked-a"]]);
    });

    it("checks nothing on focus while no project is open", async () => {
      render(<OpenFolderKeeper />);
      vi.useFakeTimers();

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(1_000);
      });

      expect(mocks.projectFolderStatus).not.toHaveBeenCalled();
    });

    it("drops a pending focus recheck when the keeper unmounts", async () => {
      const view = render(<OpenFolderKeeper />);
      await openFolder("linked-a");
      await vi.waitFor(() => expect(useFolderAccessStore.getState().loaded).toBe(true));
      vi.useFakeTimers();
      mocks.projectFolderStatus.mockClear();

      act(() => window.dispatchEvent(new Event("focus")));
      view.unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      expect(mocks.projectFolderStatus).not.toHaveBeenCalled();
    });

    it("keeps trust as it is when an availability update neither moved nor reset the folder", async () => {
      render(<OpenFolderKeeper />);
      await openFolder("linked-a");
      useProjectAvailabilityStore.getState().reset("linked-a");
      await vi.waitFor(() => expect(useFolderAccessStore.getState().loaded).toBe(true));
      mocks.projectTrustState.mockClear();

      act(() =>
        useProjectAvailabilityStore.getState().apply({
          projectId: "linked-a",
          availability: "missing",
          locationGeneration: 1,
          relocated: false,
          grantsReset: false,
        }),
      );

      expect(mocks.projectTrustState).not.toHaveBeenCalled();
    });

    it("ignores an availability update for a project other than the one whose trust is loaded", async () => {
      render(<OpenFolderKeeper />);
      await openFolder("linked-a");
      await vi.waitFor(() => expect(useFolderAccessStore.getState().loaded).toBe(true));
      useProjectAvailabilityStore.getState().reset("linked-b");
      mocks.projectTrustState.mockClear();

      act(() =>
        useProjectAvailabilityStore.getState().apply({
          projectId: "linked-b",
          availability: "ok",
          locationGeneration: 1,
          relocated: true,
          grantsReset: true,
        }),
      );

      expect(mocks.projectTrustState).not.toHaveBeenCalled();
    });
  });
});

