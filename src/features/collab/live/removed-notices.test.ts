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
import { libraryProject } from "../tests/fixtures";
import { useCollabLiveStore } from "./live-store";
import { startRemovedNotices, useRemovedNotices } from "./removed-notices";

const BOB = "acct-bob";

function file(overrides: Partial<CollabLiveRemovedFile> = {}): CollabLiveRemovedFile {
  return { path: "sections/results.tex", id: "results-id", kind: "text", by: BOB, yours: false, ...overrides };
}

function removed(...files: CollabLiveRemovedFile[]): void {
  mocks.removedHandler?.({ projectId: "paper", files });
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
