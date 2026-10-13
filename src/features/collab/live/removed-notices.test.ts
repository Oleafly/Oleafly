import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabLiveRemoved, CollabLiveRemovedFile } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  collabTrashRestore: vi.fn(),
  collabLiveFlush: vi.fn(),
  collabLiveRemovedList: vi.fn(),
  collabLiveRemovedDismiss: vi.fn(),
  removedHandler: null as null | ((payload: CollabLiveRemoved) => void),
  applyExternalDelete: vi.fn(),
  refreshTree: vi.fn(),
  openFile: vi.fn(),
  refreshProjects: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  collabTrashRestore: mocks.collabTrashRestore,
  collabLiveFlush: mocks.collabLiveFlush,
  collabLiveRemovedList: mocks.collabLiveRemovedList,
  collabLiveRemovedDismiss: mocks.collabLiveRemovedDismiss,
  isCollabCommandError: (error: unknown) =>
    typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string",
  onCollabLiveRemoved: vi.fn(async (handler: (payload: CollabLiveRemoved) => void) => {
    mocks.removedHandler = handler;
    return () => {
      mocks.removedHandler = null;
    };
  }),
  collabShareInfo: vi.fn(),
  collabLiveStart: vi.fn(),
  collabLiveStop: vi.fn(),
  collabMembersList: vi.fn(async () => []),
  onCollabLiveStatus: vi.fn(),
  onCollabLiveRole: vi.fn(),
  onCollabLiveMerged: vi.fn(),
  onCollabLiveNewDevice: vi.fn(),
  onCollabLiveMembers: vi.fn(),
  onCollabPresence: vi.fn(),
  onCollabPresenceLeft: vi.fn(),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  const store = create(() => ({
    projectId: "paper" as string | null,
    projectName: "R3 Paper",
    projects: [] as { id: string; name: string }[],
    openTabs: [] as string[],
    activePath: null as string | null,
    tree: [] as { path: string; is_dir: boolean }[],
    applyExternalDelete: mocks.applyExternalDelete,
    refreshTree: mocks.refreshTree,
    openFile: mocks.openFile,
    refreshProjects: mocks.refreshProjects,
  }));
  return { useFilesStore: store };
});

import { useFilesStore } from "@/store/files";
import { deferred, libraryProject, person, projectMember } from "../tests/fixtures";
import { useCollabLiveStore } from "./live-store";
import { followLocalCopies, startRemovedNotices, useRemovedNotices } from "./removed-notices";

const BOB = "acct-bob";

function file(overrides: Partial<CollabLiveRemovedFile> = {}): CollabLiveRemovedFile {
  return { path: "sections/results.tex", id: "results-id", kind: "text", by: BOB, yours: false, ...overrides };
}

function removed(...files: CollabLiveRemovedFile[]): void {
  mocks.removedHandler?.({ projectId: "paper", files, restored: [] });
}

function restoredElsewhere(...ids: string[]): void {
  mocks.removedHandler?.({ projectId: "paper", files: [], restored: ids });
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

let stop: () => void = () => {};

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.collabTrashRestore.mockResolvedValue(undefined);
  mocks.collabLiveFlush.mockResolvedValue(undefined);
  mocks.collabLiveRemovedList.mockResolvedValue([]);
  mocks.collabLiveRemovedDismiss.mockResolvedValue(undefined);
  mocks.refreshTree.mockResolvedValue(true);
  mocks.openFile.mockResolvedValue(undefined);
  mocks.refreshProjects.mockResolvedValue(undefined);
  useFilesStore.setState({
    projectId: "paper",
    projectName: "R3 Paper",
    projects: [],
    openTabs: ["ai2.tex", "sections/results.tex"],
    activePath: "sections/results.tex",
    tree: [],
  });
  useCollabLiveStore.setState({ projectId: "paper", ended: null });
  stop = startRemovedNotices();
  await settle();
});

afterEach(() => {
  stop();
});

describe("files someone else deleted", () => {
  it("close the open file without another file taking its place and leave one notice", () => {
    removed(file());
    expect(mocks.applyExternalDelete).toHaveBeenCalledWith("paper", "sections/results.tex", { leaveEmpty: true });
    expect(useRemovedNotices.getState().notices).toEqual([
      { id: "results-id", path: "sections/results.tex", kind: "text", by: BOB, yours: false },
    ]);
    removed(file());
    expect(useRemovedNotices.getState().notices).toHaveLength(1);
  });

  it("say nothing about a file nobody here had open unless offline work went with it", () => {
    removed(file({ path: "notes.tex", id: "notes-id" }));
    expect(useRemovedNotices.getState().notices).toEqual([]);
    expect(mocks.applyExternalDelete).not.toHaveBeenCalled();
    removed(file({ path: "plan.tex", id: "plan-id", yours: true }));
    expect(useRemovedNotices.getState().notices.map((notice) => notice.id)).toEqual(["plan-id"]);
  });

  it("count a file inside a deleted folder that was open", () => {
    removed(file({ path: "sections", id: "sections-id", kind: "dir" }));
    expect(useRemovedNotices.getState().notices.map((notice) => notice.id)).toEqual(["sections-id"]);
    expect(mocks.applyExternalDelete).toHaveBeenCalledWith("paper", "sections", { leaveEmpty: true });
  });

  it("come back with Restore, which reopens the file and clears the notice", async () => {
    removed(file());
    useFilesStore.setState({ tree: [{ path: "sections/results.tex", is_dir: false }] });
    await useRemovedNotices.getState().restore("results-id");
    expect(mocks.collabTrashRestore).toHaveBeenCalledWith("paper", "results-id");
    expect(mocks.openFile).toHaveBeenCalledWith("sections/results.tex");
    expect(useRemovedNotices.getState().notices).toEqual([]);
  });

  it("keep the notice and say why when Restore fails", async () => {
    removed(file());
    mocks.collabTrashRestore.mockRejectedValueOnce({ code: "forbidden", message: "no" });
    await useRemovedNotices.getState().restore("results-id");
    const state = useRemovedNotices.getState();
    expect(state.notices).toHaveLength(1);
    expect(state.failure).toEqual({ id: "results-id", code: "forbidden" });
  });

  it("go away for everyone when someone else brings the file back", () => {
    removed(file(), file({ path: "plan.tex", id: "plan-id", yours: true }));
    expect(useRemovedNotices.getState().notices).toHaveLength(2);
    restoredElsewhere("results-id", "plan-id");
    expect(useRemovedNotices.getState().notices).toEqual([]);
  });

  it("ignore a file brought back in another project", () => {
    removed(file());
    mocks.removedHandler?.({ projectId: "other", files: [], restored: ["results-id"] });
    expect(useRemovedNotices.getState().notices).toHaveLength(1);
  });

  it("go away when dismissed or when another project opens", () => {
    removed(file(), file({ path: "ai2.tex", id: "ai2-id" }));
    useRemovedNotices.getState().dismiss("results-id");
    expect(useRemovedNotices.getState().notices.map((notice) => notice.id)).toEqual(["ai2-id"]);
    useFilesStore.setState({ projectId: "other" });
    expect(useRemovedNotices.getState().notices).toEqual([]);
  });
});

describe("offline work lost to someone else's delete", () => {
  async function restart(): Promise<void> {
    stop();
    stop = startRemovedNotices();
    await settle();
  }

  it("is still announced after the app restarts", async () => {
    mocks.collabLiveRemovedList.mockImplementation(async (projectId: string) =>
      projectId === "paper" ? [file({ path: "plan.tex", id: "plan-id", yours: true })] : [],
    );
    await restart();
    expect(mocks.collabLiveRemovedList).toHaveBeenCalledWith("paper");
    expect(useRemovedNotices.getState()).toMatchObject({
      projectId: "paper",
      notices: [{ id: "plan-id", path: "plan.tex", kind: "text", by: BOB, yours: true }],
    });
  });

  it("comes back when its project opens again", async () => {
    useFilesStore.setState({ projectId: "other" });
    await settle();
    mocks.collabLiveRemovedList.mockResolvedValue([file({ path: "plan.tex", id: "plan-id", yours: true })]);
    useFilesStore.setState({ projectId: "paper" });
    await settle();
    expect(useRemovedNotices.getState().notices.map((notice) => notice.id)).toEqual(["plan-id"]);
  });

  it("is forgotten for good when dismissed", async () => {
    mocks.collabLiveRemovedList.mockResolvedValue([file({ path: "plan.tex", id: "plan-id", yours: true })]);
    await restart();
    useRemovedNotices.getState().dismiss("plan-id");
    expect(useRemovedNotices.getState().notices).toEqual([]);
    await settle();
    expect(mocks.collabLiveRemovedDismiss).toHaveBeenCalledWith("paper", "plan-id");
  });

  it("stays gone when the saved list arrives after someone brought the file back", async () => {
    let answer: (files: CollabLiveRemovedFile[]) => void = () => {};
    mocks.collabLiveRemovedList.mockImplementation(
      () =>
        new Promise<CollabLiveRemovedFile[]>((resolve) => {
          answer = resolve;
        }),
    );
    useFilesStore.setState({ projectId: "other" });
    useFilesStore.setState({ projectId: "paper" });
    restoredElsewhere("plan-id");
    await settle();
    answer([file({ path: "plan.tex", id: "plan-id", yours: true })]);
    await settle();
    expect(useRemovedNotices.getState().notices).toEqual([]);
  });

  it("does not repeat a notice the live session already showed", async () => {
    removed(file({ path: "plan.tex", id: "plan-id", yours: true }));
    mocks.collabLiveRemovedList.mockResolvedValue([file({ path: "plan.tex", id: "plan-id", yours: true })]);
    useFilesStore.setState({ projectId: "other" });
    useFilesStore.setState({ projectId: "paper" });
    removed(file({ path: "plan.tex", id: "plan-id", yours: true }));
    await settle();
    expect(useRemovedNotices.getState().notices.map((notice) => notice.id)).toEqual(["plan-id"]);
  });
});

describe("a project that became a local copy", () => {
  it("shows its new name once access is removed", async () => {
    mocks.refreshProjects.mockImplementation(async () => {
      useFilesStore.setState({ projects: [libraryProject({ id: "paper", name: "R3 Paper (local copy)" })] });
    });
    useCollabLiveStore.setState({ ended: "access_ended" });
    await settle();
    expect(mocks.refreshProjects).toHaveBeenCalledOnce();
    expect(useFilesStore.getState().projectName).toBe("R3 Paper (local copy)");
  });

  it("keeps its name when live editing simply stops", async () => {
    useCollabLiveStore.setState({ ended: "signed_out" });
    await settle();
    expect(mocks.refreshProjects).not.toHaveBeenCalled();
  });
});

describe("restoring and dismissing removed files", () => {
  it("brings back a folder without reopening anything", async () => {
    useFilesStore.setState({ openTabs: ["sections/results.tex"] });
    removed(file({ path: "sections", id: "sections-id", kind: "dir" }));
    await useRemovedNotices.getState().restore("sections-id");
    expect(mocks.collabTrashRestore).toHaveBeenCalledWith("paper", "sections-id");
    expect(useRemovedNotices.getState().notices).toEqual([]);
    expect(mocks.collabLiveFlush).not.toHaveBeenCalled();
    expect(mocks.openFile).not.toHaveBeenCalled();
  });

  it("does not reopen the file when another project opened while the change was saved", async () => {
    removed(file());
    mocks.collabLiveFlush.mockImplementationOnce(async () => {
      useFilesStore.setState({ projectId: "other" });
    });
    await useRemovedNotices.getState().restore("results-id");
    expect(mocks.refreshTree).not.toHaveBeenCalled();
    expect(mocks.openFile).not.toHaveBeenCalled();
  });

  it("does not reopen the file when another project opened while the file list reloaded", async () => {
    removed(file());
    mocks.refreshTree.mockImplementationOnce(async () => {
      useFilesStore.setState({ projectId: "other", tree: [{ path: "sections/results.tex", is_dir: false }] });
      return true;
    });
    await useRemovedNotices.getState().restore("results-id");
    expect(mocks.openFile).not.toHaveBeenCalled();
  });

  it("restores one file at a time and ignores a notice it does not have", async () => {
    removed(file(), file({ path: "ai2.tex", id: "ai2-id" }));
    const first = deferred<undefined>();
    mocks.collabTrashRestore.mockReturnValueOnce(first.promise);
    const restoring = useRemovedNotices.getState().restore("results-id");
    expect(useRemovedNotices.getState().restoring).toBe("results-id");
    await useRemovedNotices.getState().restore("ai2-id");
    await useRemovedNotices.getState().restore("missing-id");
    expect(mocks.collabTrashRestore).toHaveBeenCalledExactlyOnceWith("paper", "results-id");
    first.resolve(undefined);
    await restoring;
    expect(useRemovedNotices.getState().notices.map((notice) => notice.id)).toEqual(["ai2-id"]);
  });

  it("drops the reason a restore failed along with the notice when it is dismissed", async () => {
    removed(file(), file({ path: "ai2.tex", id: "ai2-id" }));
    mocks.collabTrashRestore.mockRejectedValueOnce({ code: "forbidden", message: "no" });
    await useRemovedNotices.getState().restore("results-id");
    useRemovedNotices.getState().dismiss("ai2-id");
    expect(useRemovedNotices.getState().failure).toEqual({ id: "results-id", code: "forbidden" });
    useRemovedNotices.getState().dismiss("results-id");
    expect(useRemovedNotices.getState()).toMatchObject({ notices: [], failure: null });
  });

  it("drops the reason a restore failed when someone else brings the file back", async () => {
    removed(file(), file({ path: "ai2.tex", id: "ai2-id" }));
    mocks.collabTrashRestore.mockRejectedValueOnce({ code: "forbidden", message: "no" });
    await useRemovedNotices.getState().restore("results-id");
    restoredElsewhere("ai2-id");
    expect(useRemovedNotices.getState().failure).toEqual({ id: "results-id", code: "forbidden" });
    restoredElsewhere("results-id");
    expect(useRemovedNotices.getState()).toMatchObject({ notices: [], failure: null });
  });

  it("forgets a notice without telling the app when no project is open", async () => {
    stop();
    stop = () => {};
    useRemovedNotices.setState({ notices: [{ id: "plan-id", path: "plan.tex", kind: "text", by: BOB, yours: true }] });
    useRemovedNotices.getState().dismiss("plan-id");
    await settle();
    expect(useRemovedNotices.getState().notices).toEqual([]);
    expect(mocks.collabLiveRemovedDismiss).not.toHaveBeenCalled();
  });

  it("ignores a file brought back after the notices stopped", () => {
    removed(file());
    stop();
    stop = () => {};
    const before = useRemovedNotices.getState();
    restoredElsewhere("results-id");
    expect(useRemovedNotices.getState()).toBe(before);
    expect(before).toMatchObject({ projectId: null, notices: [] });
  });

  it("asks for the people list only when the person who deleted the file is new to it", () => {
    const original = useCollabLiveStore.getState().refreshMembers;
    const refreshMembers = vi.fn(async () => {});
    useCollabLiveStore.setState({ refreshMembers, members: [projectMember(person({ account_id: BOB }))] });
    try {
      removed(file());
      expect(refreshMembers).not.toHaveBeenCalled();
      removed(file({ path: "ai2.tex", id: "ai2-id", by: null }));
      expect(refreshMembers).not.toHaveBeenCalled();
      removed(file({ path: "ai2.tex", id: "ai2-id", by: "acct-carol" }));
      expect(refreshMembers).toHaveBeenCalledOnce();
      expect(useRemovedNotices.getState().notices.map((notice) => notice.id)).toEqual(["ai2-id", "results-id"]);
    } finally {
      useCollabLiveStore.setState({ refreshMembers: original, members: [] });
    }
  });

  it("looks up nothing when the project closes", async () => {
    removed(file());
    mocks.collabLiveRemovedList.mockClear();
    useFilesStore.setState({ projectId: null });
    await settle();
    expect(mocks.collabLiveRemovedList).not.toHaveBeenCalled();
    expect(useRemovedNotices.getState()).toMatchObject({ projectId: null, notices: [] });
  });
});

describe("following a local copy", () => {
  it("leaves the open project alone when a different one became a local copy", async () => {
    mocks.refreshProjects.mockImplementation(async () => {
      useFilesStore.setState({ projects: [libraryProject({ id: "paper", name: "R3 Paper (local copy)" })] });
    });
    await followLocalCopies(["thesis"]);
    expect(mocks.refreshProjects).toHaveBeenCalledOnce();
    expect(useFilesStore.getState().projectName).toBe("R3 Paper");
    useFilesStore.setState({ projectId: null });
    await followLocalCopies(["paper"]);
    expect(useFilesStore.getState().projectName).toBe("R3 Paper");
  });

  it("keeps the name when the library has no newer one", async () => {
    await followLocalCopies(["paper"]);
    expect(useFilesStore.getState().projectName).toBe("R3 Paper");
    mocks.refreshProjects.mockImplementation(async () => {
      useFilesStore.setState({ projects: [libraryProject({ id: "paper", name: "R3 Paper" })] });
    });
    await followLocalCopies(["paper"]);
    expect(useFilesStore.getState().projectName).toBe("R3 Paper");
  });

  it("reloads the sharing details only for the project live editing follows", async () => {
    const original = useCollabLiveStore.getState().refreshShare;
    const refreshShare = vi.fn(async () => {});
    useCollabLiveStore.setState({ refreshShare, projectId: "thesis" });
    try {
      await followLocalCopies(["paper"]);
      expect(refreshShare).not.toHaveBeenCalled();
      useCollabLiveStore.setState({ projectId: "paper" });
      await followLocalCopies(["paper"]);
      expect(refreshShare).toHaveBeenCalledOnce();
    } finally {
      useCollabLiveStore.setState({ refreshShare: original });
    }
  });
});
