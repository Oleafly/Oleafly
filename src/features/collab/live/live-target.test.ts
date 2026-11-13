import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { CollabShareInfo } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  collabShareInfo: vi.fn(),
  collabLiveStart: vi.fn(),
  collabLiveStop: vi.fn(),
  collabMembersList: vi.fn(),
  collabServersList: vi.fn(),
  startLiveEditing: vi.fn(),
  releaseEditing: vi.fn(),
  listen: () => vi.fn(async () => () => undefined),
}));

vi.mock("@/lib/tauri", () => ({}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => undefined) }));
vi.mock("@/lib/tauri-collab", () => ({
  collabShareInfo: mocks.collabShareInfo,
  collabLiveStart: mocks.collabLiveStart,
  collabLiveStop: mocks.collabLiveStop,
  collabMembersList: mocks.collabMembersList,
  collabServersList: mocks.collabServersList,
  onCollabServerChanged: mocks.listen(),
  onCollabLiveStatus: mocks.listen(),
  onCollabLiveRole: mocks.listen(),
  onCollabLiveMerged: mocks.listen(),
  onCollabLiveNewDevice: mocks.listen(),
  onCollabLiveMembers: mocks.listen(),
  onCollabPresence: mocks.listen(),
  onCollabPresenceLeft: mocks.listen(),
  onCollabCommentsNotSent: mocks.listen(),
  onCollabLiveUnwritten: mocks.listen(),
  onCollabLiveProjectFull: mocks.listen(),
}));
vi.mock("./live-editing", () => ({ startLiveEditing: mocks.startLiveEditing }));
vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create(() => ({
      projectId: null as string | null,
      saveAllDirty: vi.fn(async () => {}),
    })),
  };
});

import {
  claimLiveNote,
  installCollabEditorPort,
  useCollabEditorGate,
  useCollabLiveNote,
  useCollabLiveProject,
} from "@/lib/collab-live-bridge";
import { useFilesStore } from "@/store/files";
import { liveTarget, startCollabLive, useCollabLiveStore } from "./live-store";
import { isNoteSession, startLiveTarget, startNoteLive } from "./note-slot";

const PROJECT = "project-1";
const NOTE = "note-1";

function share(projectId: string): CollabShareInfo {
  return {
    project_id: projectId,
    server_id: "server",
    server_name: "Lab",
    server_url: "https://collab.example.org",
    shared_project_id: `shared-${projectId}`,
    role: "editor",
    link: `https://collab.example.org/p/${projectId}`,
    account_id: "me",
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabShareInfo.mockImplementation(async (projectId: string) => share(projectId));
  mocks.collabLiveStart.mockResolvedValue({ role: "editor", account_id: "me", device_id: "device" });
  mocks.collabLiveStop.mockResolvedValue(undefined);
  mocks.collabMembersList.mockResolvedValue([]);
  mocks.collabServersList.mockResolvedValue([]);
  mocks.startLiveEditing.mockReturnValue(mocks.releaseEditing);
  useFilesStore.setState({ projectId: null });
  useCollabLiveNote.setState({ noteId: null, session: null });
  useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false });
});

afterEach(() => {
  stop?.();
  stop = null;
});

describe("the live target", () => {
  it("is the workspace project unless a note holds the live slot", () => {
    useFilesStore.setState({ projectId: PROJECT });
    expect(liveTarget()).toBe(PROJECT);
    claimLiveNote(NOTE);
    expect(liveTarget()).toBe(NOTE);
    claimLiveNote(NOTE);
    expect(useCollabLiveNote.getState().noteId).toBe(NOTE);
  });

  it("moves the live session to a claimed note and hands it back to the workspace", async () => {
    useFilesStore.setState({ projectId: PROJECT });
    stop = startCollabLive({ started: startLiveTarget });
    await settle();
    expect(mocks.collabLiveStart).toHaveBeenLastCalledWith(PROJECT);
    expect(mocks.startLiveEditing).toHaveBeenCalledTimes(1);

    claimLiveNote(NOTE);
    await settle();
    expect(mocks.releaseEditing).toHaveBeenCalledTimes(1);
    expect(mocks.collabLiveStop).toHaveBeenCalledWith(PROJECT);
    expect(mocks.collabLiveStart).toHaveBeenLastCalledWith(NOTE);
    expect(useCollabLiveStore.getState().projectId).toBe(NOTE);
    expect(useCollabLiveNote.getState().session).toEqual({
      projectId: NOTE,
      role: "editor",
      accountId: "me",
      deviceId: "device",
    });
    expect(useCollabEditorGate.getState()).toMatchObject({ projectId: NOTE, connecting: false, viewer: false });
    expect(mocks.startLiveEditing).toHaveBeenCalledTimes(1);

    useFilesStore.setState({ projectId: "ignored-while-a-note-is-live" });
    await settle();
    expect(useCollabLiveStore.getState().projectId).toBe(NOTE);

    useFilesStore.setState({ projectId: PROJECT });
    claimLiveNote(null);
    await settle();
    expect(useCollabLiveNote.getState().session).toBeNull();
    expect(mocks.collabLiveStop).toHaveBeenCalledWith(NOTE);
    expect(mocks.collabLiveStart).toHaveBeenLastCalledWith(PROJECT);
    expect(mocks.startLiveEditing).toHaveBeenCalledTimes(2);
  });

  it("waits for unsent project edits to be confirmed or handed back before moving to a note", async () => {
    let finish: () => void = () => undefined;
    const handBack = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const uninstall = installCollabEditorPort({ documentSession: () => null, flush: async () => undefined, handBack });
    try {
      useFilesStore.setState({ projectId: PROJECT });
      stop = startCollabLive({ started: startLiveTarget });
      await settle();
      claimLiveNote(NOTE);
      await settle();
      expect(handBack).toHaveBeenCalledWith(PROJECT);
      expect(mocks.collabLiveStop).not.toHaveBeenCalled();
      expect(useCollabLiveStore.getState().projectId).toBe(PROJECT);
      finish();
      await settle();
      expect(mocks.collabLiveStop).toHaveBeenCalledWith(PROJECT);
      expect(useCollabLiveStore.getState().projectId).toBe(NOTE);
    } finally {
      uninstall();
    }
  });

  it("stops following the note slot once disposed", async () => {
    stop = startCollabLive({ started: startLiveTarget });
    stop();
    stop = null;
    claimLiveNote(NOTE);
    await settle();
    expect(mocks.collabShareInfo).not.toHaveBeenCalledWith(NOTE);
  });
});

describe("the note slot", () => {
  const session = { projectId: NOTE, role: "editor" as const, accountId: "me", deviceId: "device" };

  it("recognises sessions for the claimed note", () => {
    expect(isNoteSession(session)).toBe(false);
    claimLiveNote(NOTE);
    expect(isNoteSession(session)).toBe(true);
  });

  it("publishes the session, follows role changes and clears both on release", () => {
    useCollabLiveStore.setState({ projectId: NOTE, role: "editor" });
    const release = startNoteLive(session);
    expect(useCollabLiveNote.getState().session).toEqual(session);
    expect(useCollabEditorGate.getState()).toMatchObject({ projectId: NOTE, viewer: false, locked: false });
    useCollabLiveStore.setState({ role: "viewer" });
    expect(useCollabEditorGate.getState()).toMatchObject({ viewer: true, locked: true });
    useCollabLiveStore.setState({ role: "reviewer" });
    expect(useCollabEditorGate.getState()).toMatchObject({ viewer: false, locked: true });
    release();
    expect(useCollabLiveNote.getState().session).toBeNull();
    expect(useCollabEditorGate.getState().projectId).toBeNull();
  });

  it("leaves another project's gate and session alone on release", () => {
    const release = startNoteLive(session);
    useCollabLiveNote.setState({ session: { ...session, projectId: "other" } });
    useCollabEditorGate.setState({ projectId: "other" });
    useCollabLiveStore.setState({ role: "viewer" });
    release();
    expect(useCollabLiveNote.getState().session?.projectId).toBe("other");
    expect(useCollabEditorGate.getState()).toMatchObject({ projectId: "other", viewer: false });
  });

  it("starts workspace editing for projects that are not the claimed note", () => {
    const release = startLiveTarget({ ...session, projectId: PROJECT });
    expect(mocks.startLiveEditing).toHaveBeenCalledWith({ ...session, projectId: PROJECT });
    expect(useCollabLiveProject.getState().session).toEqual({ ...session, projectId: PROJECT });
    release();
    expect(mocks.releaseEditing).toHaveBeenCalledTimes(1);
    expect(useCollabLiveProject.getState().session).toBeNull();
  });

  it("leaves a newer project session published when an older one ends", () => {
    const release = startLiveTarget({ ...session, projectId: PROJECT });
    useCollabLiveProject.setState({ session: { ...session, projectId: "later" } });
    release();
    expect(useCollabLiveProject.getState().session?.projectId).toBe("later");
  });
});
