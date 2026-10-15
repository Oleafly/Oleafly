import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CollabCommentsNotSent,
  CollabLiveMerged,
  CollabLiveNewDevice,
  CollabLiveRole,
  CollabLiveStatus,
  CollabPresence,
  CollabPresenceLeft,
  CollabProjectMember,
  CollabShareInfo,
} from "@/lib/tauri";
import { avatarHue } from "@/components/ui/avatar";
import { OWN_HUE_BAND, peerHue } from "./peer-hue";

type Handler<T> = (payload: T) => void;

const mocks = vi.hoisted(() => ({
  collabShareInfo: vi.fn(),
  collabLiveStart: vi.fn(),
  collabLiveStop: vi.fn(),
  collabLiveFlush: vi.fn(),
  collabMembersList: vi.fn(),
  collabPresenceSet: vi.fn(),
  collabDocOpen: vi.fn(),
  collabDocChange: vi.fn(),
  collabDocClose: vi.fn(),
  collabServersList: vi.fn(),
  logError: vi.fn(),
  handlers: {} as Record<string, ((payload: unknown) => void) | undefined>,
  unlisten: vi.fn(),
}));

function listener(name: string) {
  return vi.fn(async (handler: (payload: unknown) => void) => {
    mocks.handlers[name] = handler;
    return () => {
      mocks.unlisten(name);
      if (mocks.handlers[name] === handler) mocks.handlers[name] = undefined;
    };
  });
}

vi.mock("@/lib/tauri", () => ({
  collabShareInfo: mocks.collabShareInfo,
  collabLiveStart: mocks.collabLiveStart,
  collabLiveStop: mocks.collabLiveStop,
  collabLiveFlush: mocks.collabLiveFlush,
  collabMembersList: mocks.collabMembersList,
  collabPresenceSet: mocks.collabPresenceSet,
  collabDocOpen: mocks.collabDocOpen,
  collabDocChange: mocks.collabDocChange,
  collabDocClose: mocks.collabDocClose,
  collabServersList: mocks.collabServersList,
  isCollabCommandError: (value: unknown) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string" &&
    typeof (value as { message?: unknown }).message === "string",
  onCollabServerChanged: listener("serverChanged"),
  onCollabLiveStatus: listener("status"),
  onCollabLiveRole: listener("role"),
  onCollabLiveMerged: listener("merged"),
  onCollabLiveNewDevice: listener("newDevice"),
  onCollabLiveMembers: listener("members"),
  onCollabPresence: listener("presence"),
  onCollabPresenceLeft: listener("left"),
  onCollabCommentsNotSent: listener("notSent"),
  onCollabLiveUnwritten: listener("unwritten"),
  onCollabLiveProjectFull: listener("projectFull"),
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create(() => ({
      projectId: null as string | null,
      activePath: null as string | null,
      files: {} as Record<string, { content: string; dirty: boolean }>,
      docVersion: 0,
      saveAllDirty: vi.fn(async () => {}),
      setContent: vi.fn(() => true),
      bumpDocVersion: vi.fn(),
    })),
  };
});

import { collabProjectReadOnly } from "@/lib/collab-live-bridge";
import { useFilesStore } from "@/store/files";
import { PEER_TTL_MS, peerPlaces, startCollabLive, useCollabLiveStore } from "./live-store";
import { syncState } from "../sharing/sync-state";

const PROJECT = "project-1";
const OTHER = "project-2";
const ALICE = "0192a0b0-0000-7000-8000-000000000001";
const BOB = "0192a0b0-0000-7000-8000-000000000002";

function share(overrides: Partial<CollabShareInfo> = {}): CollabShareInfo {
  return {
    project_id: PROJECT,
    server_id: "server",
    server_name: "Smith Lab",
    server_url: "https://collab.uni.edu",
    shared_project_id: "shared-1",
    role: "editor",
    link: "https://collab.uni.edu/p/shared-1",
    account_id: ALICE,
    ...overrides,
  };
}

function member(accountId: string, name: string): CollabProjectMember {
  return {
    person: { account_id: accountId, display_name: name, avatar_url: null, email: null, login: null },
    role: "editor",
    granted_at: 1,
  };
}

function emit<T>(name: string, payload: T): void {
  const handler = mocks.handlers[name] as Handler<T> | undefined;
  if (!handler) throw new Error(`no ${name} listener`);
  handler(payload);
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function openProject(projectId: string | null): void {
  useFilesStore.setState({ projectId, activePath: null, files: {} });
}

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers = {};
  mocks.collabShareInfo.mockResolvedValue(share());
  mocks.collabLiveStart.mockResolvedValue({ role: "editor", account_id: ALICE, device_id: "device-me" });
  mocks.collabLiveStop.mockResolvedValue(undefined);
  mocks.collabLiveFlush.mockResolvedValue(undefined);
  mocks.collabMembersList.mockResolvedValue([member(ALICE, "Alice Chen"), member(BOB, "Bob Jones")]);
  mocks.collabPresenceSet.mockResolvedValue(undefined);
  mocks.collabServersList.mockResolvedValue([]);
  mocks.logError.mockResolvedValue(undefined);
  openProject(null);
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe("collab live store", () => {
  it("starts empty", () => {
    expect(useCollabLiveStore.getState()).toMatchObject({
      projectId: null,
      share: null,
      role: null,
      status: null,
      pending: 0,
      peers: {},
      members: [],
      merged: null,
      newDevice: null,
      ended: null,
    });
  });

  it("goes live when the open project is shared", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    expect(mocks.collabShareInfo).toHaveBeenCalledWith(PROJECT);
    expect(mocks.collabLiveStart).toHaveBeenCalledWith(PROJECT);
    expect(mocks.collabMembersList).toHaveBeenCalledWith(PROJECT);
    expect(useCollabLiveStore.getState()).toMatchObject({
      projectId: PROJECT,
      share: share(),
      role: "editor",
      members: [member(ALICE, "Alice Chen"), member(BOB, "Bob Jones")],
    });
  });

  it("saves unsaved buffers before going live", async () => {
    const order: string[] = [];
    vi.mocked(useFilesStore.getState().saveAllDirty).mockImplementationOnce(async () => {
      order.push("save");
    });
    mocks.collabLiveStart.mockImplementationOnce(async () => {
      order.push("start");
      return { role: "editor", account_id: ALICE, device_id: "device-me" };
    });
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    expect(order).toEqual(["save", "start"]);
  });

  it("still goes live when saving fails", async () => {
    vi.mocked(useFilesStore.getState().saveAllDirty).mockRejectedValueOnce(new Error("disk full"));
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    expect(mocks.collabLiveStart).toHaveBeenCalledWith(PROJECT);
  });

  it("stays local when the open project is not shared", async () => {
    mocks.collabShareInfo.mockResolvedValue(null);
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    expect(mocks.collabLiveStart).not.toHaveBeenCalled();
    expect(useCollabLiveStore.getState()).toMatchObject({ projectId: PROJECT, share: null, role: null });
  });

  it("stops the old project and checks the new one when the project changes", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    mocks.collabShareInfo.mockResolvedValue(null);
    openProject(OTHER);
    await settle();
    expect(mocks.collabLiveStop).toHaveBeenCalledWith(PROJECT);
    expect(mocks.collabShareInfo).toHaveBeenLastCalledWith(OTHER);
    expect(useCollabLiveStore.getState()).toMatchObject({ projectId: OTHER, share: null, role: null, members: [] });
    openProject(null);
    await settle();
    expect(useCollabLiveStore.getState().projectId).toBeNull();
  });

  it("keeps a shared project read-only until live editing has started", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.collabLiveStart.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    expect(collabProjectReadOnly(PROJECT)).toBe(true);
    finish({ role: "editor", account_id: ALICE, device_id: "device-me" });
    await settle();
    expect(collabProjectReadOnly(PROJECT)).toBe(false);
  });

  it("tries again when live editing fails to start and stays read-only meanwhile", async () => {
    vi.useFakeTimers();
    mocks.collabLiveStart.mockRejectedValueOnce(new Error("busy"));
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    expect(mocks.collabLiveStart).toHaveBeenCalledTimes(1);
    expect(collabProjectReadOnly(PROJECT)).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(mocks.collabLiveStart).toHaveBeenCalledTimes(2);
    expect(collabProjectReadOnly(PROJECT)).toBe(false);
  });

  it("logs a start that keeps failing once, not on every retry", async () => {
    vi.useFakeTimers();
    mocks.collabLiveStart.mockRejectedValue(new Error("busy"));
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.collabLiveStart.mock.calls.length).toBeGreaterThan(3);
    expect(mocks.logError.mock.calls.filter(([scope]) => scope === "collab live start")).toHaveLength(1);
  });

  it.each(["signed_out", "unauthorized", "not_found"])(
    "lets the person edit and asks them to sign in when going live is refused with %s",
    async (code) => {
      vi.useFakeTimers();
      mocks.collabLiveStart.mockRejectedValue({ code, message: "" });
      openProject(PROJECT);
      stop = startCollabLive();
      await settle();
      expect(collabProjectReadOnly(PROJECT)).toBe(false);
      const state = useCollabLiveStore.getState();
      expect(syncState(state.status, state.pending)).toBe("signedOut");
      expect(state.ended).toBe("signed_out");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.collabLiveStart).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["server_removed", "server_unknown"])(
    "says the project's server is gone when going live is refused with %s",
    async (code) => {
      vi.useFakeTimers();
      mocks.collabLiveStart.mockRejectedValue({ code, message: "" });
      openProject(PROJECT);
      stop = startCollabLive();
      await settle();
      expect(collabProjectReadOnly(PROJECT)).toBe(false);
      const state = useCollabLiveStore.getState();
      expect(syncState(state.status, state.pending)).toBe("serverRemoved");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.collabLiveStart).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the reason the start's own status event gave and releases the editors", async () => {
    let refuse: (reason: unknown) => void = () => {};
    mocks.collabLiveStart.mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)));
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    expect(collabProjectReadOnly(PROJECT)).toBe(true);
    emit<CollabLiveStatus>("status", {
      projectId: PROJECT,
      status: { state: "ended", reason: "account_suspended" },
      pending: 0,
    });
    expect(collabProjectReadOnly(PROJECT)).toBe(false);
    refuse({ code: "signed_out", message: "" });
    await settle();
    expect(collabProjectReadOnly(PROJECT)).toBe(false);
    const state = useCollabLiveStore.getState();
    expect(syncState(state.status, state.pending)).toBe("suspended");
  });

  it("releases the editors when the session ends before going live, whatever the reason", async () => {
    mocks.collabLiveStart.mockReturnValueOnce(new Promise(() => undefined));
    mocks.collabShareInfo.mockResolvedValueOnce(share()).mockResolvedValue(null);
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    expect(collabProjectReadOnly(PROJECT)).toBe(true);
    emit<CollabLiveStatus>("status", { projectId: PROJECT, status: { state: "ended", reason: "access_ended" }, pending: 0 });
    await settle();
    expect(collabProjectReadOnly(PROJECT)).toBe(false);
  });

  it("tries again after the person signs in to the project's server, and only then", async () => {
    mocks.collabLiveStart.mockRejectedValueOnce({ code: "signed_out", message: "" });
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    expect(mocks.collabLiveStart).toHaveBeenCalledTimes(1);

    emit("serverChanged", { serverId: "another-server" });
    await settle();
    expect(mocks.collabLiveStart).toHaveBeenCalledTimes(1);

    mocks.collabServersList.mockResolvedValue([{ server_id: "server", signed_in: false }]);
    emit("serverChanged", { serverId: "server" });
    await settle();
    expect(mocks.collabLiveStart).toHaveBeenCalledTimes(1);

    mocks.collabServersList.mockResolvedValue([{ server_id: "server", signed_in: true }]);
    emit("serverChanged", { serverId: "server" });
    await settle();
    expect(mocks.collabLiveStart).toHaveBeenCalledTimes(2);
    const state = useCollabLiveStore.getState();
    expect(state).toMatchObject({ ended: null, role: "editor" });
    expect(collabProjectReadOnly(PROJECT)).toBe(false);
  });

  it("does not try again on a server change while the project is live", async () => {
    mocks.collabServersList.mockResolvedValue([{ server_id: "server", signed_in: true }]);
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    emit("serverChanged", { serverId: "server" });
    await settle();
    expect(mocks.collabLiveStart).toHaveBeenCalledTimes(1);
    expect(mocks.collabServersList).not.toHaveBeenCalled();
  });

  it("lets a project that stops being shared be edited again", async () => {
    vi.useFakeTimers();
    mocks.collabLiveStart.mockRejectedValue(new Error("busy"));
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    expect(collabProjectReadOnly(PROJECT)).toBe(true);
    useCollabLiveStore.setState({ share: null });
    await settle();
    expect(collabProjectReadOnly(PROJECT)).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.collabLiveStart).toHaveBeenCalledTimes(1);
  });

  it("stops live sync for a project that closes before going live", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.collabLiveStart.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    openProject(null);
    await settle();
    finish({ role: "editor", account_id: ALICE, device_id: "device-me" });
    await settle();
    expect(mocks.collabLiveStop).toHaveBeenCalledWith(PROJECT);
    expect(useCollabLiveStore.getState()).toMatchObject({ projectId: null, role: null });
  });

  it("follows status, role and merge events for the open project only", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    emit<CollabLiveStatus>("status", { projectId: OTHER, status: { state: "offline", retry_in_ms: 5 }, pending: 9 });
    emit<CollabLiveStatus>("status", { projectId: PROJECT, status: { state: "online" }, pending: 2 });
    expect(useCollabLiveStore.getState()).toMatchObject({ status: { state: "online" }, pending: 2 });
    emit<CollabLiveRole>("role", { projectId: OTHER, role: "owner" });
    emit<CollabLiveRole>("role", { projectId: PROJECT, role: "viewer" });
    expect(useCollabLiveStore.getState().role).toBe("viewer");
    const merged: CollabLiveMerged = {
      projectId: PROJECT,
      files: [{ path: "main.tex", changes: 3 }],
      authors: [{ accountId: BOB, files: [{ path: "main.tex", changes: 3 }] }],
      review: { before: "b", after: "a" },
    };
    emit<CollabLiveMerged>("merged", { ...merged, projectId: OTHER, files: [] });
    emit<CollabLiveMerged>("merged", merged);
    expect(useCollabLiveStore.getState().merged).toEqual(merged);
    useCollabLiveStore.getState().dismissMerged();
    expect(useCollabLiveStore.getState().merged).toBeNull();
  });

  it("stays offline with the waiting count while reconnect attempts fail, until a connection succeeds", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    const shown: string[] = [];
    const send = (status: CollabLiveStatus["status"], pending: number) => {
      emit<CollabLiveStatus>("status", { projectId: PROJECT, status, pending });
      const state = useCollabLiveStore.getState();
      shown.push(`${syncState(state.status, state.pending)}:${state.pending}`);
    };
    send({ state: "online" }, 0);
    send({ state: "offline", retry_in_ms: 1_000 }, 0);
    send({ state: "connecting" }, 0);
    send({ state: "offline", retry_in_ms: 2_000 }, 3);
    send({ state: "connecting" }, 3);
    send({ state: "offline", retry_in_ms: 5_000 }, 4);
    send({ state: "connecting" }, 4);
    send({ state: "connecting" }, 5);
    send({ state: "online" }, 5);
    send({ state: "online" }, 0);
    expect(shown).toEqual([
      "upToDate:0",
      "reconnecting:0",
      "reconnecting:0",
      "offline:3",
      "offline:3",
      "offline:4",
      "offline:4",
      "offline:5",
      "syncing:5",
      "upToDate:0",
    ]);
  });

  it("shows syncing while the first connection is made", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    emit<CollabLiveStatus>("status", { projectId: PROJECT, status: { state: "connecting" }, pending: 2 });
    const state = useCollabLiveStore.getState();
    expect(syncState(state.status, state.pending)).toBe("syncing");
  });

  it("records a sign-in on a new device for the open project only", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    emit<CollabLiveNewDevice>("newDevice", { projectId: OTHER, accountId: BOB, deviceId: "tablet" });
    expect(useCollabLiveStore.getState().newDevice).toBeNull();
    const signedIn: CollabLiveNewDevice = { projectId: PROJECT, accountId: BOB, deviceId: "tablet" };
    emit<CollabLiveNewDevice>("newDevice", signedIn);
    expect(useCollabLiveStore.getState().newDevice).toEqual(signedIn);
  });

  it("reloads the member list when this person's role changes", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    const before = mocks.collabMembersList.mock.calls.length;
    mocks.collabMembersList.mockResolvedValueOnce([
      { ...member(ALICE, "Alice Chen"), role: "viewer" },
      member(BOB, "Bob Jones"),
    ]);
    emit<CollabLiveRole>("role", { projectId: PROJECT, role: "viewer" });
    await settle();
    expect(mocks.collabMembersList.mock.calls).toHaveLength(before + 1);
    expect(useCollabLiveStore.getState().members[0]).toMatchObject({ role: "viewer" });
  });

  it("reloads the people list and names who changed whom when someone is added or removed", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    const CAROL = "0192a0b0-0000-7000-8000-000000000003";
    mocks.collabMembersList.mockClear();
    mocks.collabMembersList.mockResolvedValueOnce([
      member(ALICE, "Alice Chen"),
      member(BOB, "Bob Jones"),
      member(CAROL, "Carol Diaz"),
    ]);
    emit("members", { projectId: PROJECT, accountId: CAROL, by: BOB, kind: "added" });
    await settle();
    expect(mocks.collabMembersList).toHaveBeenCalledWith(PROJECT);
    expect(useCollabLiveStore.getState().members).toHaveLength(3);
    expect(useCollabLiveStore.getState().memberChange).toEqual({
      projectId: PROJECT,
      accountId: CAROL,
      by: BOB,
      kind: "added",
      name: "Carol Diaz",
      byName: "Bob Jones",
    });
    mocks.collabMembersList.mockResolvedValueOnce([member(ALICE, "Alice Chen"), member(BOB, "Bob Jones")]);
    emit("members", { projectId: PROJECT, accountId: CAROL, by: BOB, kind: "removed" });
    await settle();
    expect(useCollabLiveStore.getState().members).toHaveLength(2);
    expect(useCollabLiveStore.getState().memberChange).toMatchObject({ kind: "removed", name: "Carol Diaz" });
    emit("members", { projectId: OTHER, accountId: CAROL, by: BOB, kind: "added" });
    await settle();
    expect(useCollabLiveStore.getState().memberChange).toMatchObject({ kind: "removed" });
  });

  it("names who removed this person without asking the server for a list it can no longer read", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    mocks.collabMembersList.mockClear();
    emit("members", { projectId: PROJECT, accountId: ALICE, by: BOB, kind: "removed" });
    await settle();
    expect(mocks.collabMembersList).not.toHaveBeenCalled();
    expect(useCollabLiveStore.getState().memberChange).toMatchObject({ name: "Alice Chen", byName: "Bob Jones" });
  });

  it("tells the person once who made them a viewer while they could edit", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    emit("members", { projectId: PROJECT, accountId: ALICE, by: BOB, kind: "role_changed" });
    emit<CollabLiveRole>("role", { projectId: PROJECT, role: "viewer" });
    await settle();
    const notice = useCollabLiveStore.getState().accessNotice;
    expect(notice).toEqual({ kind: "viewer", byName: "Bob Jones" });
    emit<CollabLiveRole>("role", { projectId: PROJECT, role: "viewer" });
    await settle();
    expect(useCollabLiveStore.getState().accessNotice).toBe(notice);
    useCollabLiveStore.getState().dismissAccessNotice();
    expect(useCollabLiveStore.getState().accessNotice).toBeNull();
    emit<CollabLiveRole>("role", { projectId: PROJECT, role: "viewer" });
    await settle();
    expect(useCollabLiveStore.getState().accessNotice).toBeNull();
  });

  it("leaves the name out when nothing says who changed the role, and drops the notice once editing is back", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    emit<CollabLiveRole>("role", { projectId: PROJECT, role: "viewer" });
    await settle();
    expect(useCollabLiveStore.getState().accessNotice).toEqual({ kind: "viewer", byName: "" });
    emit<CollabLiveRole>("role", { projectId: PROJECT, role: "editor" });
    await settle();
    expect(useCollabLiveStore.getState().accessNotice).toBeNull();
  });

  it("does not use an old change of someone else's role to name who changed this person's role", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    const CAROL = "0192a0b0-0000-7000-8000-000000000003";
    emit("members", { projectId: PROJECT, accountId: CAROL, by: BOB, kind: "role_changed" });
    emit<CollabLiveRole>("role", { projectId: PROJECT, role: "viewer" });
    await settle();
    expect(useCollabLiveStore.getState().accessNotice).toEqual({ kind: "viewer", byName: "" });
  });

  it("tells the person once who removed them, and keeps the notice after the project turns local", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    mocks.collabShareInfo.mockResolvedValue(null);
    emit("members", { projectId: PROJECT, accountId: ALICE, by: BOB, kind: "removed" });
    emit<CollabLiveStatus>("status", { projectId: PROJECT, status: { state: "ended", reason: "removed" }, pending: 0 });
    await settle();
    expect(useCollabLiveStore.getState()).toMatchObject({
      share: null,
      accessNotice: { kind: "removed", byName: "Bob Jones" },
    });
  });

  it("says nothing about a removal the person made themselves by leaving", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    mocks.collabShareInfo.mockResolvedValue(null);
    emit("members", { projectId: PROJECT, accountId: ALICE, by: ALICE, kind: "removed" });
    emit<CollabLiveStatus>("status", { projectId: PROJECT, status: { state: "ended", reason: "removed" }, pending: 0 });
    await settle();
    expect(useCollabLiveStore.getState().accessNotice).toBeNull();
  });

  it("forgets the notice when another project opens", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    emit<CollabLiveRole>("role", { projectId: PROJECT, role: "viewer" });
    await settle();
    expect(useCollabLiveStore.getState().accessNotice).not.toBeNull();
    openProject(OTHER);
    await settle();
    expect(useCollabLiveStore.getState().accessNotice).toBeNull();
  });

  it("keeps the comments the server would not take for the open project until they are dismissed", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    const first = { fileId: "f1", path: "main.tex", threadId: "t1", quote: "quick", body: "written while off" };
    const second = { fileId: "f1", path: "main.tex", threadId: "t2", quote: "fox", body: "and another" };
    emit<CollabCommentsNotSent>("notSent", { projectId: PROJECT, comments: [first] });
    emit<CollabCommentsNotSent>("notSent", { projectId: OTHER, comments: [second] });
    expect(useCollabLiveStore.getState().commentsNotSent).toEqual([first]);
    emit<CollabCommentsNotSent>("notSent", { projectId: PROJECT, comments: [second] });
    expect(useCollabLiveStore.getState().commentsNotSent).toEqual([first, second]);
    useCollabLiveStore.getState().dismissCommentsNotSent();
    expect(useCollabLiveStore.getState().commentsNotSent).toBeNull();
    emit<CollabCommentsNotSent>("notSent", { projectId: PROJECT, comments: [] });
    expect(useCollabLiveStore.getState().commentsNotSent).toEqual([]);
    openProject(OTHER);
    await settle();
    expect(useCollabLiveStore.getState().commentsNotSent).toBeNull();
  });

  it("tracks peers with names from the member list and drops them when they leave", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    const bob: CollabPresence = {
      projectId: PROJECT,
      deviceId: "device-bob",
      accountId: BOB,
      path: "main.tex",
      cursor: 4,
      anchor: 2,
    };
    emit("presence", bob);
    emit("presence", { ...bob, deviceId: "device-me", accountId: ALICE });
    emit("presence", { ...bob, projectId: OTHER, deviceId: "device-elsewhere" });
    const peers = useCollabLiveStore.getState().peers;
    expect(Object.keys(peers)).toEqual(["device-bob"]);
    expect(peers["device-bob"]).toMatchObject({
      deviceId: "device-bob",
      accountId: BOB,
      person: member(BOB, "Bob Jones").person,
      path: "main.tex",
      cursor: 4,
      anchor: 2,
      hue: peerHue(BOB, ALICE),
    });
    emit<CollabPresenceLeft>("left", { projectId: PROJECT, deviceId: "device-bob" });
    expect(useCollabLiveStore.getState().peers).toEqual({});
  });

  it("keeps a peer's colour out of the band around this person's own colour", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    expect(Math.abs(avatarHue(BOB) - avatarHue(ALICE))).toBeLessThan(OWN_HUE_BAND);
    emit("presence", { projectId: PROJECT, deviceId: "device-bob", accountId: BOB, path: "main.tex", cursor: 1, anchor: 1 });
    const hue = useCollabLiveStore.getState().peers["device-bob"]?.hue;
    expect(hue).toBe(peerHue(BOB, ALICE));
    expect(hue).not.toBe(avatarHue(BOB));
    emit("presence", { projectId: PROJECT, deviceId: "device-bob", accountId: BOB, path: "main.tex", cursor: 9, anchor: 9 });
    expect(useCollabLiveStore.getState().peers["device-bob"]?.hue).toBe(hue);
  });

  it("forgets a peer after thirty seconds without an update", async () => {
    vi.useFakeTimers();
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    emit("presence", {
      projectId: PROJECT,
      deviceId: "device-bob",
      accountId: BOB,
      path: null,
      cursor: null,
      anchor: null,
    });
    vi.advanceTimersByTime(20_000);
    expect(Object.keys(useCollabLiveStore.getState().peers)).toEqual(["device-bob"]);
    vi.advanceTimersByTime(15_000);
    expect(useCollabLiveStore.getState().peers).toEqual({});
  });

  it("runs the expiry timer only while someone else is here", async () => {
    vi.useFakeTimers();
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    emit("presence", { projectId: PROJECT, deviceId: "d", accountId: BOB, path: null, cursor: null, anchor: null });
    expect(vi.getTimerCount()).toBe(1);
    emit<CollabPresenceLeft>("left", { projectId: PROJECT, deviceId: "d" });
    expect(vi.getTimerCount()).toBe(0);
    emit("presence", { projectId: PROJECT, deviceId: "d", accountId: BOB, path: null, cursor: null, anchor: null });
    vi.advanceTimersByTime(PEER_TTL_MS + 1_000);
    expect(useCollabLiveStore.getState().peers).toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the same place list while people only move their cursors", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    const bob: CollabPresence = {
      projectId: PROJECT,
      deviceId: "device-bob",
      accountId: BOB,
      path: "main.tex",
      cursor: 4,
      anchor: 4,
    };
    emit("presence", bob);
    const places = peerPlaces(useCollabLiveStore.getState().peers);
    expect(places["device-bob"]).toMatchObject({ accountId: BOB, path: "main.tex", hue: peerHue(BOB, ALICE) });
    emit("presence", { ...bob, cursor: 90, anchor: 80 });
    emit("presence", { ...bob, cursor: 91, anchor: 91 });
    expect(peerPlaces(useCollabLiveStore.getState().peers)).toBe(places);
    emit("presence", { ...bob, path: "intro.tex" });
    const moved = peerPlaces(useCollabLiveStore.getState().peers);
    expect(moved).not.toBe(places);
    expect(moved["device-bob"]?.path).toBe("intro.tex");
    emit("presence", { ...bob, deviceId: "device-bob-laptop", path: "intro.tex" });
    expect(Object.keys(peerPlaces(useCollabLiveStore.getState().peers))).toEqual(["device-bob", "device-bob-laptop"]);
    mocks.collabMembersList.mockResolvedValueOnce([member(ALICE, "Alice Chen"), member(BOB, "Bob J.")]);
    const named = peerPlaces(useCollabLiveStore.getState().peers);
    await useCollabLiveStore.getState().refreshMembers();
    const renamed = peerPlaces(useCollabLiveStore.getState().peers);
    expect(renamed).not.toBe(named);
    expect(renamed["device-bob"]?.person?.display_name).toBe("Bob J.");
    emit<CollabPresenceLeft>("left", { projectId: PROJECT, deviceId: "device-bob-laptop" });
    expect(Object.keys(peerPlaces(useCollabLiveStore.getState().peers))).toEqual(["device-bob"]);
  });

  it("names a peer once the member list learns about them", async () => {
    mocks.collabMembersList.mockResolvedValueOnce([member(ALICE, "Alice Chen")]);
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    emit("presence", { projectId: PROJECT, deviceId: "d", accountId: BOB, path: null, cursor: null, anchor: null });
    expect(useCollabLiveStore.getState().peers.d.person).toBeNull();
    await useCollabLiveStore.getState().refreshMembers();
    expect(useCollabLiveStore.getState().peers.d.person?.display_name).toBe("Bob Jones");
  });

  it("reloads the member list when someone it has never heard of shows up", async () => {
    mocks.collabMembersList.mockResolvedValueOnce([member(ALICE, "Alice Chen")]);
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    const before = mocks.collabMembersList.mock.calls.length;
    const bob: CollabPresence = { projectId: PROJECT, deviceId: "d", accountId: BOB, path: "main.tex", cursor: 1, anchor: null };
    emit("presence", bob);
    emit("presence", { ...bob, cursor: 2 });
    emit("presence", { ...bob, cursor: 3 });
    await settle();
    expect(mocks.collabMembersList.mock.calls).toHaveLength(before + 1);
    expect(useCollabLiveStore.getState().peers.d.person?.display_name).toBe("Bob Jones");
    expect(useCollabLiveStore.getState().members.map((entry) => entry.person.display_name)).toEqual([
      "Alice Chen",
      "Bob Jones",
    ]);
  });

  it("learns who made merged changes or signed in on a new device", async () => {
    const carol = "0192a0b0-0000-7000-8000-000000000003";
    mocks.collabMembersList.mockResolvedValueOnce([member(ALICE, "Alice Chen")]);
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    const before = mocks.collabMembersList.mock.calls.length;
    emit<CollabLiveMerged>("merged", {
      projectId: PROJECT,
      files: [{ path: "main.tex", changes: 2 }],
      authors: [{ accountId: BOB, files: [{ path: "main.tex", changes: 2 }] }],
      review: { before: "b", after: "a" },
    });
    await settle();
    expect(mocks.collabMembersList.mock.calls).toHaveLength(before + 1);
    mocks.collabMembersList.mockResolvedValueOnce([
      member(ALICE, "Alice Chen"),
      member(BOB, "Bob Jones"),
      member(carol, "Carol Diaz"),
    ]);
    emit<CollabLiveNewDevice>("newDevice", { projectId: PROJECT, accountId: carol, deviceId: "tablet" });
    emit<CollabLiveNewDevice>("newDevice", { projectId: PROJECT, accountId: BOB, deviceId: "phone" });
    await settle();
    expect(mocks.collabMembersList.mock.calls).toHaveLength(before + 2);
    expect(useCollabLiveStore.getState().members).toHaveLength(3);
  });

  it("makes the project local again when this person is removed", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    mocks.collabShareInfo.mockResolvedValue(null);
    emit<CollabLiveStatus>("status", { projectId: PROJECT, status: { state: "ended", reason: "removed" }, pending: 0 });
    await settle();
    expect(useCollabLiveStore.getState()).toMatchObject({ ended: "removed", share: null, role: null });
    useCollabLiveStore.getState().dismissEnded();
    expect(useCollabLiveStore.getState().ended).toBeNull();
  });

  it("does not report its own stop as an ending", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    emit<CollabLiveStatus>("status", { projectId: PROJECT, status: { state: "ended", reason: "stopped" }, pending: 0 });
    await settle();
    expect(useCollabLiveStore.getState().ended).toBeNull();
  });

  it("goes live after the project is shared and stops after sharing ends", async () => {
    mocks.collabShareInfo.mockResolvedValue(null);
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    expect(mocks.collabLiveStart).not.toHaveBeenCalled();
    mocks.collabShareInfo.mockResolvedValue(share({ role: "owner" }));
    await useCollabLiveStore.getState().refreshShare();
    await settle();
    expect(mocks.collabLiveStart).toHaveBeenCalledWith(PROJECT);
    mocks.collabShareInfo.mockResolvedValue(null);
    await useCollabLiveStore.getState().refreshShare();
    await settle();
    expect(mocks.collabLiveStop).toHaveBeenCalledWith(PROJECT);
    expect(useCollabLiveStore.getState()).toMatchObject({ share: null, role: null, status: null });
  });

  it("keeps the files the project couldn't write, until they are written or the project changes", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    const files = [
      { path: "main.tex", reason: "locked" },
      { path: "figures/plot.png", reason: "not_downloaded" },
    ];
    mocks.handlers.unwritten?.({ projectId: "other-project", files });
    expect(useCollabLiveStore.getState().unwritten).toEqual([]);
    mocks.handlers.unwritten?.({ projectId: PROJECT, files });
    expect(useCollabLiveStore.getState().unwritten).toEqual(files);
    mocks.handlers.unwritten?.({ projectId: PROJECT, files: [] });
    expect(useCollabLiveStore.getState().unwritten).toEqual([]);
    mocks.handlers.unwritten?.({ projectId: PROJECT, files });
    openProject("thesis");
    await settle();
    expect(useCollabLiveStore.getState().unwritten).toEqual([]);
  });

  it("says the project is full until the connection comes back, and again whenever the server says so", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    const online = (pending = 0) =>
      emit<CollabLiveStatus>("status", { projectId: PROJECT, status: { state: "online" }, pending });
    online();
    emit("projectFull", { projectId: OTHER });
    expect(useCollabLiveStore.getState().projectFull).toBe(false);
    emit("projectFull", { projectId: PROJECT });
    expect(useCollabLiveStore.getState().projectFull).toBe(true);
    online(3);
    expect(useCollabLiveStore.getState().projectFull).toBe(true);
    emit<CollabLiveStatus>("status", {
      projectId: PROJECT,
      status: { state: "offline", retry_in_ms: 4000 },
      pending: 3,
    });
    expect(useCollabLiveStore.getState().projectFull).toBe(true);
    online(3);
    expect(useCollabLiveStore.getState().projectFull).toBe(false);
    emit("projectFull", { projectId: PROJECT });
    expect(useCollabLiveStore.getState().projectFull).toBe(true);
    openProject("thesis");
    await settle();
    expect(useCollabLiveStore.getState().projectFull).toBe(false);
  });

  it("stops live sync, listeners and timers when the lifecycle ends", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    stop();
    stop = null;
    await settle();
    expect(mocks.collabLiveStop).toHaveBeenCalledWith(PROJECT);
    expect(mocks.unlisten).toHaveBeenCalledTimes(11);
    expect(useCollabLiveStore.getState()).toMatchObject({ projectId: null, share: null, peers: {} });
  });
});

describe("collab live store edges", () => {
  it("keeps a peer's name when a newer member list no longer has them", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    emit("presence", { projectId: PROJECT, deviceId: "d", accountId: BOB, path: null, cursor: null, anchor: null });
    expect(useCollabLiveStore.getState().peers.d.person?.display_name).toBe("Bob Jones");
    mocks.collabMembersList.mockResolvedValueOnce([member(ALICE, "Alice Chen")]);
    await useCollabLiveStore.getState().refreshMembers();
    expect(useCollabLiveStore.getState().peers.d.person?.display_name).toBe("Bob Jones");
  });

  it("asks nothing about sharing while no project is open", async () => {
    stop = startCollabLive();
    await settle();
    await useCollabLiveStore.getState().refreshShare();
    expect(mocks.collabShareInfo).not.toHaveBeenCalled();
  });

  it("keeps only the newest answer about sharing", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    let answerOld: (value: CollabShareInfo | null) => void = () => {};
    mocks.collabShareInfo.mockReturnValueOnce(new Promise((resolve) => (answerOld = resolve)));
    mocks.collabShareInfo.mockResolvedValueOnce(share({ server_name: "Newer Lab" }));
    const older = useCollabLiveStore.getState().refreshShare();
    await useCollabLiveStore.getState().refreshShare();
    answerOld(share({ server_name: "Older Lab" }));
    await older;
    expect(useCollabLiveStore.getState().share?.server_name).toBe("Newer Lab");
  });

  it("does not go live for a project that closed while its files were saved", async () => {
    let saved: () => void = () => {};
    vi.mocked(useFilesStore.getState().saveAllDirty).mockImplementationOnce(
      () => new Promise<void>((resolve) => (saved = resolve)),
    );
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    openProject(null);
    await settle();
    saved();
    await settle();
    expect(mocks.collabLiveStart).not.toHaveBeenCalled();
    expect(collabProjectReadOnly(PROJECT)).toBe(false);
  });

  it("does not retry going live for a project that closed while the first try failed", async () => {
    vi.useFakeTimers();
    let fail: (error: Error) => void = () => {};
    mocks.collabLiveStart.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    openProject(null);
    await settle();
    fail(new Error("busy"));
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.collabLiveStart).toHaveBeenCalledOnce();
  });

  it("does not retry going live once the session has ended", async () => {
    vi.useFakeTimers();
    mocks.collabLiveStart.mockRejectedValueOnce(new Error("busy"));
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    emit<CollabLiveStatus>("status", { projectId: PROJECT, status: { state: "ended", reason: "archived" }, pending: 0 });
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(mocks.collabLiveStart).toHaveBeenCalledOnce();
    expect(useCollabLiveStore.getState()).toMatchObject({ ended: "archived", accessNotice: null });
  });

  it("still says this person was removed after an earlier ending, without a name", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    mocks.collabShareInfo.mockResolvedValue(null);
    emit<CollabLiveStatus>("status", { projectId: PROJECT, status: { state: "ended", reason: "signed_out" }, pending: 0 });
    await settle();
    expect(useCollabLiveStore.getState()).toMatchObject({ ended: "signed_out", share: null, accessNotice: null });
    emit<CollabLiveStatus>("status", { projectId: PROJECT, status: { state: "ended", reason: "removed" }, pending: 0 });
    await settle();
    expect(useCollabLiveStore.getState()).toMatchObject({
      ended: "removed",
      accessNotice: { kind: "removed", byName: "" },
    });
  });

  it("names nobody for a change to the people list that lands after another project opened", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    let answer: (members: CollabProjectMember[]) => void = () => {};
    mocks.collabMembersList.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    emit("members", { projectId: PROJECT, accountId: BOB, by: ALICE, kind: "added" });
    mocks.collabShareInfo.mockResolvedValue(null);
    openProject(OTHER);
    answer([member(ALICE, "Alice Chen"), member(BOB, "Bob Jones")]);
    await settle();
    expect(useCollabLiveStore.getState()).toMatchObject({ projectId: OTHER, memberChange: null, members: [] });
  });

  it("colours a peer who shows up before the sharing details arrive", async () => {
    let answer: (value: CollabShareInfo | null) => void = () => {};
    mocks.collabShareInfo.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    openProject(PROJECT);
    stop = startCollabLive();
    emit("presence", { projectId: PROJECT, deviceId: "d", accountId: BOB, path: "main.tex", cursor: 1, anchor: 1 });
    expect(useCollabLiveStore.getState().peers.d.hue).toBe(peerHue(BOB, null));
    answer(share());
    await settle();
  });

  it("ignores someone leaving who was never here", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    emit("presence", { projectId: PROJECT, deviceId: "d", accountId: BOB, path: null, cursor: null, anchor: null });
    const peers = useCollabLiveStore.getState().peers;
    emit<CollabPresenceLeft>("left", { projectId: PROJECT, deviceId: "nobody" });
    emit<CollabPresenceLeft>("left", { projectId: OTHER, deviceId: "d" });
    expect(useCollabLiveStore.getState().peers).toBe(peers);
  });

  it("keeps the live session when the open project only changes its active file", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    useFilesStore.setState({ activePath: "main.tex" });
    await settle();
    expect(mocks.collabShareInfo).toHaveBeenCalledOnce();
    expect(mocks.collabLiveStop).not.toHaveBeenCalled();
  });

  it("stops only once when the lifecycle ends twice", async () => {
    openProject(PROJECT);
    stop = startCollabLive();
    await settle();
    stop();
    stop();
    await settle();
    expect(mocks.collabLiveStop).toHaveBeenCalledOnce();
    expect(mocks.unlisten).toHaveBeenCalledTimes(11);
  });
});

