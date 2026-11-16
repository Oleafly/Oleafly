import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OverleafLiveProject } from "@/lib/overleaf-live";

const mocks = vi.hoisted(() => ({
  handlers: {} as Record<string, ((payload: unknown) => void) | undefined>,
  project: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(async () => undefined),
  pause: vi.fn(),
  resume: vi.fn(async () => undefined),
  logError: vi.fn(),
  toast: vi.fn(),
}));

function listener(name: string) {
  return vi.fn(async (handler: (payload: unknown) => void) => {
    mocks.handlers[name] = handler;
    return () => {
      if (mocks.handlers[name] === handler) mocks.handlers[name] = undefined;
    };
  });
}

vi.mock("@/lib/tauri", () => ({}));
vi.mock("@/lib/tauri-collab", () => ({
  isCollabCommandError: (error: unknown) => typeof error === "object" && error !== null && "code" in error,
  collabShareInfo: vi.fn(async () => null),
  collabLiveStart: vi.fn(),
  collabLiveStop: vi.fn(),
  collabMembersList: vi.fn(async () => []),
  collabServersList: vi.fn(async () => []),
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
  onCollabLiveDocPending: listener("docPending"),
  onCollabLiveProjectFull: listener("projectFull"),
}));
vi.mock("@/lib/overleaf-live", () => ({
  overleafLiveProject: mocks.project,
  overleafLiveStart: mocks.start,
  overleafLiveStop: mocks.stop,
  overleafLivePause: mocks.pause,
  overleafLiveResume: mocks.resume,
  overleafLiveUnlink: vi.fn(async () => undefined),
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast, notifyError: mocks.toast }));
vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create(() => ({
      projectId: null as string | null,
      activePath: null as string | null,
      files: {},
      docVersion: 0,
      saveAllDirty: vi.fn(async () => {}),
      setContent: vi.fn(() => true),
      bumpDocVersion: vi.fn(),
    })),
  };
});

import { overleafLiveActions, useCollabEditorGate, useLiveBackend } from "@/lib/collab-live-bridge";
import { useFilesStore } from "@/store/files";
import { useOverleafImportStore } from "@/store/overleaf-import";
import { useSettingsStore } from "@/store/settings";
import { startCollabLive, useCollabLiveStore } from "./live-store";
import { overleafDriver, startOverleafLive } from "./overleaf-driver";
import { serverDriver } from "./server-driver";

const PROJECT = "imported-project";
const INFO = { role: "editor" as const, account_id: "alice", device_id: "laptop" };

function link(change: Partial<OverleafLiveProject> = {}): OverleafLiveProject {
  return { server: "https://www.overleaf.com", remoteId: "6af963ebc9037022065bb53f", signedIn: true, paused: false, ...change };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

let stops: (() => void)[] = [];

function begin(): void {
  stops = [
    startOverleafLive(),
    startCollabLive({
      started: (live) => {
        useCollabEditorGate.setState({ projectId: live.projectId, viewer: false, locked: false, connecting: false });
        return () => useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false });
      },
      drivers: [serverDriver(() => useCollabLiveStore.getState().refreshShare()), overleafDriver()],
    }),
  ];
}

function status(state: unknown, pending = 0): void {
  mocks.handlers.status?.({ projectId: PROJECT, status: state, pending });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers = {};
  mocks.project.mockResolvedValue(link());
  mocks.start.mockResolvedValue(INFO);
  localStorage.clear();
  useSettingsStore.getState().setOverleafLive(true);
  useOverleafImportStore.setState({ status: null });
  useFilesStore.setState({ projectId: PROJECT });
});

afterEach(() => {
  for (const stop of stops.reverse()) stop();
  stops = [];
  useFilesStore.setState({ projectId: null });
});

describe("live editing with Overleaf", () => {
  it("goes live only with the pref, a link and a session", async () => {
    begin();
    await settle();
    expect(mocks.start).toHaveBeenCalledWith(PROJECT);
    expect(useCollabLiveStore.getState()).toMatchObject({ backend: "overleaf", overleaf: link(), role: "editor" });
    expect(useLiveBackend.getState()).toMatchObject({ projectId: PROJECT, backend: "overleaf", overleaf: link() });
  });

  it("stays local for an Overleaf project with no session, and goes live once you sign in", async () => {
    mocks.project.mockResolvedValue(link({ signedIn: false }));
    begin();
    await settle();
    expect(mocks.start).not.toHaveBeenCalled();
    mocks.project.mockResolvedValue(link());
    useOverleafImportStore.setState({ status: { server: link().server, signedIn: true, email: "a@example.com" } });
    await settle();
    expect(mocks.start).toHaveBeenCalledWith(PROJECT);
  });

  it("keeps a paused project local", async () => {
    mocks.project.mockResolvedValue(link({ paused: true }));
    begin();
    await settle();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(useLiveBackend.getState().overleaf).toEqual(link({ paused: true }));
  });

  it("opens no socket and asks nothing while the experiment is off", async () => {
    useSettingsStore.getState().setOverleafLive(false);
    begin();
    await settle();
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(useCollabLiveStore.getState().overleaf).toBeNull();
  });

  it("stops the session when the experiment goes off, and starts it when it comes back", async () => {
    begin();
    await settle();
    useSettingsStore.getState().setOverleafLive(false);
    await settle();
    expect(mocks.stop).toHaveBeenCalledWith(PROJECT);
    expect(useCollabLiveStore.getState()).toMatchObject({ backend: null, overleaf: null });
    useSettingsStore.getState().setOverleafLive(true);
    await settle();
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it("keeps the editors attached and the session running while signed out", async () => {
    begin();
    await settle();
    status({ state: "online" });
    mocks.project.mockResolvedValue(link({ signedIn: false }));
    status({ state: "signed_out" }, 2);
    useOverleafImportStore.setState({ status: { server: link().server, signedIn: false, email: null } });
    await settle();
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(useCollabLiveStore.getState()).toMatchObject({ backend: "overleaf", pending: 2 });
    expect(useCollabEditorGate.getState()).toMatchObject({ projectId: PROJECT, connecting: false });
  });

  it("goes live again after a start refused for an expired session, once you sign in", async () => {
    mocks.start.mockRejectedValueOnce({ code: "signed_out", message: "expired" });
    begin();
    await settle();
    expect(useCollabLiveStore.getState().ended).toBe("signed_out");
    expect(useCollabEditorGate.getState().connecting).toBe(false);
    useOverleafImportStore.setState({ status: { server: link().server, signedIn: true, email: "a@example.com" } });
    await settle();
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(useCollabLiveStore.getState()).toMatchObject({ ended: null, backend: "overleaf" });
  });

  it("keeps the editors attached while the session connects, goes offline and comes back", async () => {
    begin();
    await settle();
    for (const state of [
      { state: "connecting" },
      { state: "offline", retry_in_ms: 4_000 },
      { state: "idle" },
      { state: "online" },
    ]) {
      status(state, 1);
      expect(useCollabLiveStore.getState()).toMatchObject({ backend: "overleaf", ended: null });
      expect(useCollabEditorGate.getState()).toMatchObject({ projectId: PROJECT, connecting: false });
    }
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it("marks a file until Overleaf confirms it, and forgets the marks when the session ends", async () => {
    begin();
    await settle();
    mocks.handlers.docPending?.({ projectId: PROJECT, path: "main.tex", pending: true });
    mocks.handlers.docPending?.({ projectId: PROJECT, path: "intro.tex", pending: true });
    mocks.handlers.docPending?.({ projectId: "other", path: "else.tex", pending: true });
    expect(useLiveBackend.getState().pendingPaths).toEqual(["main.tex", "intro.tex"]);
    mocks.handlers.docPending?.({ projectId: PROJECT, path: "main.tex", pending: false });
    expect(useLiveBackend.getState().pendingPaths).toEqual(["intro.tex"]);
    status({ state: "ended", reason: "failed" });
    expect(useLiveBackend.getState().pendingPaths).toEqual([]);
  });

  it("pauses through the installed actions and stays local afterwards", async () => {
    begin();
    await settle();
    mocks.pause.mockResolvedValueOnce({ paused: false, unsent: ["main.tex"] });
    await expect(overleafLiveActions()?.pause(PROJECT, false)).resolves.toEqual({ paused: false, unsent: ["main.tex"] });
    expect(mocks.stop).not.toHaveBeenCalled();
    mocks.pause.mockResolvedValueOnce({ paused: true, unsent: [] });
    mocks.project.mockResolvedValue(link({ paused: true }));
    await overleafLiveActions()?.pause(PROJECT, true);
    await settle();
    expect(mocks.pause).toHaveBeenLastCalledWith(PROJECT, true);
    expect(useCollabLiveStore.getState()).toMatchObject({ backend: null, overleaf: link({ paused: true }) });
    mocks.project.mockResolvedValue(link());
    await overleafLiveActions()?.resume(PROJECT);
    await settle();
    expect(mocks.resume).toHaveBeenCalledWith(PROJECT);
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it("logs background failures and never toasts them", async () => {
    vi.useFakeTimers();
    try {
      mocks.project.mockRejectedValueOnce(new Error("disk"));
      begin();
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.logError).toHaveBeenCalledWith("overleaf live project", expect.any(Error));
      mocks.start.mockRejectedValue({ code: "unreachable", message: "offline" });
      useSettingsStore.getState().setOverleafLive(false);
      useSettingsStore.getState().setOverleafLive(true);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.start).toHaveBeenCalled();
      expect(mocks.toast).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
