// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderDetection } from "@/lib/folder-detection";
import type { ProjectTrust } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  projectTrustState: vi.fn(),
  projectFolderStatus: vi.fn(),
  projectDocumentCandidates: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  setShowTree: vi.fn(),
  setRailTab: vi.fn(),
  refreshEngine: vi.fn(async () => {}),
  refreshGitStatus: vi.fn(async () => {}),
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
  projectDocumentCandidates: mocks.projectDocumentCandidates,
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
      refreshEngine: mocks.refreshEngine,
    })),
  };
});
vi.mock("@/store/git-status", () => ({
  useGitStatusStore: { getState: () => ({ refresh: mocks.refreshGitStatus }) },
}));
vi.mock("@/store/settings", () => ({
  useSettingsStore: {
    getState: () => ({ setShowTree: mocks.setShowTree, setRailTab: mocks.setRailTab }),
  },
}));

import { useFilesStore } from "@/store/files";
import { useFolderAccessStore } from "@/store/folder-access";
import { useMainDocumentStore } from "@/store/main-document";
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
    mocks.projectDocumentCandidates,
    mocks.setShowTree,
    mocks.setRailTab,
    mocks.refreshEngine,
    mocks.refreshGitStatus,
  ]) {
    fn.mockReset();
  }
  mocks.listeners.clear();
  mocks.projectTrustState.mockResolvedValue(restricted);
  mocks.projectFolderStatus.mockResolvedValue({ read_only: false, synced_with: null });
  mocks.projectDocumentCandidates.mockResolvedValue(detection("auto", "paper/main.tex"));
  useFilesStore.setState({ projectId: null, loading: false, manifestHome: "library" } as never);
  useOpenFolderStore.getState().dismiss();
  useFolderAccessStore.getState().reset(null);
  useMainDocumentStore.getState().reset(null);
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
    expect(useMainDocumentStore.getState().projectId).toBe("linked-b");
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

  it("shows the file tree for a folder with no main and hands the detection over", async () => {
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
    expect(useMainDocumentStore.getState().status).toBe("idle");
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
    expect(useMainDocumentStore.getState().detection?.candidates).toHaveLength(2);
  });

  it("keeps the other documents of a clear main without asking anything", async () => {
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
    expect(useMainDocumentStore.getState().detection?.main).toBe("paper/main.tex");
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
    expect(useMainDocumentStore.getState().projectId).toBe("linked-b");
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

  it("looks for other documents in the background for a folder reopened later", async () => {
    vi.useFakeTimers();
    render(<OpenFolderKeeper />);
    await openFolder("linked-a");
    expect(mocks.projectDocumentCandidates).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mocks.projectDocumentCandidates).toHaveBeenCalledWith("linked-a");
  });

  it("lists the other documents of a folder whose main came from its own settings", async () => {
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
    expect(useOpenFolderStore.getState().opened).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mocks.projectDocumentCandidates).toHaveBeenCalledWith("linked-a");
    expect(useMainDocumentStore.getState().detection?.candidates.map((c) => c.path)).toEqual([
      "paper/main.tex",
      "talk/slides.tex",
    ]);
  });

  it("does not search while the folder has no main document", async () => {
    vi.useFakeTimers();
    render(<OpenFolderKeeper />);
    await openFolder("linked-a", { mainDoc: "main.tex", tree: [] });
    act(() =>
      useOpenFolderStore.getState().present({
        project_id: "linked-a",
        detection: { ...detection("no_main", null), candidates: [] },
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mocks.projectDocumentCandidates).not.toHaveBeenCalled();
  });

  it("never searches a library project", async () => {
    vi.useFakeTimers();
    render(<OpenFolderKeeper />);
    await openFolder("paper", { manifestHome: "library" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mocks.projectDocumentCandidates).not.toHaveBeenCalled();
  });
});
