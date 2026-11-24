import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabEditModeState, CollabLiveInfo, CollabProjectRole } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { type LiveBackendDriver, startCollabLive, useCollabLiveStore } from "../live/live-store";
import { deferred, LIVE_SEEDS, liveReset, OVERLEAF_ALICE_ID, OVERLEAF_SEED, overleafLive } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabEditModeGet: vi.fn(),
  collabEditModeSet: vi.fn(),
  toastError: vi.fn(),
  logError: vi.fn(),
  listeners: new Map<string, ((event: { payload: unknown }) => void)[]>(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(event, [...(mocks.listeners.get(event) ?? []), handler]);
    return () => mocks.listeners.set(event, (mocks.listeners.get(event) ?? []).filter((other) => other !== handler));
  }),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabEditModeGet: mocks.collabEditModeGet,
  collabEditModeSet: mocks.collabEditModeSet,
}));

vi.mock("@/lib/toast", () => ({ toast: { error: mocks.toastError, info: vi.fn(), infoUnique: vi.fn() } }));

vi.mock("@/lib/log", () => ({ logError: mocks.logError, logWarning: vi.fn() }));

vi.mock("@/lib/overleaf-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf-live")>()),
  overleafLiveMembers: vi.fn(async () => []),
}));

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create(() => ({ projectId: null as string | null, saveAllDirty: vi.fn(async () => {}) })),
  };
});

import { setEditMode, startEditMode, useEditMode } from "./edit-mode";

let stop: (() => void) | null = null;

function state(overrides: Partial<CollabEditModeState> = {}): CollabEditModeState {
  return { mode: "editing", switchable: true, locked: null, everyone: null, guests: null, manage: false, ...overrides };
}

const CLEARED = {
  projectId: null,
  mode: null,
  switchable: false,
  locked: null,
  everyone: null,
  guests: null,
  manage: false,
  busy: false,
};

async function flush() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

async function settle() {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

beforeAll(async () => {
  await loadNamespace("collab");
});

function emit(event: string, payload: unknown) {
  for (const handler of mocks.listeners.get(event) ?? []) handler({ payload });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listeners.clear();
  mocks.collabEditModeGet.mockResolvedValue(state());
  mocks.collabEditModeSet.mockResolvedValue(undefined);
});

afterEach(() => {
  stop?.();
  stop = null;
  useCollabLiveStore.setState(liveReset());
  useEditMode.setState(CLEARED);
});

describe.each(LIVE_SEEDS)("the edit mode on the $name backend", (seed) => {
  function live(role: CollabProjectRole) {
    useCollabLiveStore.setState({ ...seed.live("paper", role), status: { state: "online" } });
  }

  describe("reading it", () => {
    it("falls back to Editing for an editor when the mode can't be read, and logs why", async () => {
      mocks.collabEditModeGet.mockRejectedValue({ code: "unreachable", message: "offline" });
      live("editor");
      stop = startEditMode();
      await flush();
      expect(useEditMode.getState()).toMatchObject({ projectId: "paper", mode: "editing", switchable: true, busy: false });
      expect(mocks.logError).toHaveBeenCalledWith("collab edit mode", expect.objectContaining({ code: "unreachable" }));
    });

    it("keeps a reviewer in Suggesting when the mode can't be read, or reads as editing", async () => {
      mocks.collabEditModeGet.mockRejectedValueOnce({ code: "unreachable", message: "offline" });
      live("reviewer");
      stop = startEditMode();
      await flush();
      expect(useEditMode.getState()).toMatchObject({ mode: "suggesting", switchable: false, locked: "reviewer" });
      mocks.collabEditModeGet.mockResolvedValue(state({ mode: "editing", switchable: true }));
      useCollabLiveStore.setState({ tracking: true });
      await flush();
      expect(useEditMode.getState()).toMatchObject({ mode: "suggesting", switchable: false, locked: "reviewer" });
    });

    it("keeps everything the backend says about the switch", async () => {
      mocks.collabEditModeGet.mockResolvedValue(
        state({ mode: "suggesting", switchable: false, locked: "everyone", everyone: true, guests: false, manage: true }),
      );
      live("owner");
      stop = startEditMode();
      await flush();
      expect(useEditMode.getState()).toEqual({
        projectId: "paper",
        mode: "suggesting",
        switchable: false,
        locked: "everyone",
        everyone: true,
        guests: false,
        manage: true,
        busy: false,
      });
    });

    it("ignores a mode that arrives after the role changed", async () => {
      const first = deferred<CollabEditModeState>();
      mocks.collabEditModeGet.mockReturnValueOnce(first.promise).mockResolvedValue(state({ mode: "suggesting" }));
      live("editor");
      stop = startEditMode();
      await flush();
      useCollabLiveStore.setState({ role: "owner" });
      await flush();
      expect(useEditMode.getState().mode).toBe("suggesting");
      first.resolve(state());
      await flush();
      expect(useEditMode.getState().mode).toBe("suggesting");
      expect(mocks.collabEditModeGet).toHaveBeenCalledTimes(2);
    });

    it("ignores a failed read that answers after the role changed", async () => {
      const first = deferred<CollabEditModeState>();
      mocks.collabEditModeGet.mockReturnValueOnce(first.promise).mockResolvedValue(state({ mode: "suggesting" }));
      live("editor");
      stop = startEditMode();
      await flush();
      useCollabLiveStore.setState({ role: "owner" });
      await flush();
      first.reject({ code: "unreachable", message: "offline" });
      await flush();
      expect(useEditMode.getState().mode).toBe("suggesting");
      expect(mocks.logError).not.toHaveBeenCalled();
    });

    it("asks once per project, role and track changes state, not for every live update", async () => {
      live("editor");
      stop = startEditMode();
      await flush();
      useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 1_000 } });
      useCollabLiveStore.setState({ status: { state: "online" } });
      await flush();
      expect(mocks.collabEditModeGet).toHaveBeenCalledTimes(1);
      expect(useEditMode.getState().mode).toBe("editing");
      mocks.collabEditModeGet.mockResolvedValue(state({ mode: "suggesting", switchable: false, locked: "everyone" }));
      useCollabLiveStore.setState({ tracking: true });
      await flush();
      expect(mocks.collabEditModeGet).toHaveBeenCalledTimes(2);
      expect(useEditMode.getState()).toMatchObject({ mode: "suggesting", locked: "everyone" });
    });

    it("reads the mode again when the review status changes, so a read taken before the server answered doesn't stay", async () => {
      mocks.collabEditModeGet.mockResolvedValueOnce(state({ switchable: false, locked: "server" }));
      live("owner");
      stop = startEditMode();
      await flush();
      expect(useEditMode.getState()).toMatchObject({ switchable: false, locked: "server", manage: false });
      mocks.collabEditModeGet.mockResolvedValue(state({ everyone: false, guests: false, manage: true }));
      emit("collab-comments-status", { projectId: "thesis", status: {} });
      await flush();
      expect(mocks.collabEditModeGet).toHaveBeenCalledTimes(1);
      emit("collab-comments-status", { projectId: "paper", status: {} });
      await flush();
      expect(useEditMode.getState()).toMatchObject({ switchable: true, locked: null, everyone: false, manage: true });
    });

    it("reads the mode again on a role notice that repeats the role, since the project-wide setting may have changed", async () => {
      useCollabLiveStore.setState({ ...seed.live("paper", "editor"), tracking: true, status: { state: "online" } });
      mocks.collabEditModeGet.mockResolvedValueOnce(state({ mode: "suggesting" }));
      stop = startEditMode();
      await flush();
      expect(useEditMode.getState()).toMatchObject({ mode: "suggesting", switchable: true, locked: null });
      mocks.collabEditModeGet.mockResolvedValue(state({ mode: "suggesting", switchable: false, locked: "everyone" }));
      emit("collab-live-role", { projectId: "paper", role: "editor", tracking: true, restricted: false, deletedExternally: false });
      await flush();
      expect(mocks.collabEditModeGet).toHaveBeenCalledTimes(2);
      expect(useEditMode.getState()).toMatchObject({ mode: "suggesting", switchable: false, locked: "everyone" });
    });

    it.each([
      ["the live store hears it first, as at boot", true],
      ["edit mode hears it first", false],
    ] as const)("reads the mode once for a role notice that turns track changes on, when %s", async (_, storeFirst) => {
      const starts = [() => startCollabLive({ drivers: [] }), startEditMode];
      const stops = (storeFirst ? starts : [...starts].reverse()).map((start) => start());
      onTestFinished(() => {
        for (const end of stops.reverse()) end();
      });
      live("editor");
      await flush();
      expect(mocks.collabEditModeGet).toHaveBeenCalledTimes(1);
      mocks.collabEditModeGet.mockResolvedValue(state({ mode: "suggesting", switchable: false, locked: "everyone" }));
      emit("collab-live-role", { projectId: "paper", role: "editor", tracking: true, restricted: false, deletedExternally: false });
      await flush();
      expect(useCollabLiveStore.getState().tracking).toBe(true);
      expect(mocks.collabEditModeGet).toHaveBeenCalledTimes(2);
      expect(useEditMode.getState()).toMatchObject({ mode: "suggesting", switchable: false, locked: "everyone" });
    });

    it("forgets the mode when the project stops being live", async () => {
      live("owner");
      stop = startEditMode();
      await flush();
      expect(useEditMode.getState().mode).toBe("editing");
      useCollabLiveStore.setState(seed.unlive());
      expect(useEditMode.getState()).toEqual(CLEARED);
    });
  });

  describe("switching it", () => {
    it("sends one switch at a time and skips a switch to the mode already on", async () => {
      live("owner");
      stop = startEditMode();
      await flush();
      const switching = deferred<void>();
      mocks.collabEditModeSet.mockReturnValueOnce(switching.promise);
      const first = setEditMode("suggesting");
      expect(useEditMode.getState()).toMatchObject({ mode: "suggesting", busy: true });
      await setEditMode("editing");
      expect(mocks.collabEditModeSet).toHaveBeenCalledTimes(1);
      switching.resolve();
      await first;
      expect(useEditMode.getState()).toMatchObject({ mode: "suggesting", busy: false });
      await setEditMode("suggesting");
      expect(mocks.collabEditModeSet).toHaveBeenCalledTimes(1);
      expect(mocks.collabEditModeSet).toHaveBeenCalledWith("paper", "suggesting", "me");
    });

    it("never switches a mode the backend says is locked", async () => {
      mocks.collabEditModeGet.mockResolvedValue(state({ mode: "suggesting", switchable: false, locked: "everyone" }));
      live("editor");
      stop = startEditMode();
      await flush();
      await setEditMode("editing");
      expect(mocks.collabEditModeSet).not.toHaveBeenCalled();
      expect(useEditMode.getState().mode).toBe("suggesting");
    });

    it("never lets a reviewer switch to Editing", async () => {
      live("reviewer");
      stop = startEditMode();
      await flush();
      await setEditMode("editing");
      expect(mocks.collabEditModeSet).not.toHaveBeenCalled();
      expect(useEditMode.getState().mode).toBe("suggesting");
    });

    it("sends nothing while the project isn't live", async () => {
      await setEditMode("suggesting");
      useEditMode.setState({ projectId: "paper", mode: "editing" });
      await setEditMode("suggesting");
      expect(mocks.collabEditModeSet).not.toHaveBeenCalled();
      expect(useEditMode.getState()).toMatchObject({ mode: "editing", busy: false });
    });

    it("says nothing about a refused switch for a project that was closed meanwhile", async () => {
      live("editor");
      stop = startEditMode();
      await flush();
      const switching = deferred<void>();
      mocks.collabEditModeSet.mockReturnValueOnce(switching.promise);
      const pending = setEditMode("suggesting");
      useCollabLiveStore.setState(seed.unlive());
      switching.reject({ code: "forbidden", message: "no" });
      await pending;
      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(mocks.logError).toHaveBeenCalledWith("collab set edit mode", expect.objectContaining({ code: "forbidden" }));
      expect(useEditMode.getState()).toEqual(CLEARED);
    });
  });
});

describe("the edit mode while an Overleaf session starts", () => {
  it("waits for the session to start before asking, since the backend can't answer for it until then", async () => {
    useCollabLiveStore.setState({ ...OVERLEAF_SEED.live("paper", "owner"), selfId: null, status: { state: "online" } });
    stop = startEditMode();
    emit("collab-live-role", { projectId: "paper", role: "owner", tracking: false, restricted: false, deletedExternally: false });
    await flush();
    expect(mocks.collabEditModeGet).not.toHaveBeenCalled();
    expect(useEditMode.getState()).toEqual(CLEARED);
    useCollabLiveStore.setState({ selfId: OVERLEAF_SEED.alice.account_id });
    await flush();
    expect(mocks.collabEditModeGet).toHaveBeenCalledExactlyOnceWith("paper");
    expect(useEditMode.getState()).toMatchObject({ projectId: "paper", mode: "editing", switchable: true });
  });

  it("waits again when the session is started a second time, until that start returns", async () => {
    const info: CollabLiveInfo = { role: "owner", account_id: OVERLEAF_ALICE_ID, device_id: "laptop" };
    const start = vi.fn(async (_projectId: string) => info);
    const driver: LiveBackendDriver = {
      kind: "overleaf",
      wants: (live) => live.projectId === "paper" && live.overleaf !== null,
      start,
      stop: async () => undefined,
      refresh: async () => undefined,
      resumable: () => false,
      refusal: () => null,
    };
    useFilesStore.setState({ projectId: "paper" });
    const stopLive = startCollabLive({ drivers: [driver] });
    stop = startEditMode();
    onTestFinished(() => {
      stopLive();
      useFilesStore.setState({ projectId: null });
    });
    mocks.collabEditModeGet.mockResolvedValue(state({ everyone: false, guests: false, manage: true }));
    useCollabLiveStore.setState({ ...overleafLive(), selfId: null });
    await settle();
    expect(start).toHaveBeenCalledTimes(1);
    expect(useEditMode.getState()).toMatchObject({ projectId: "paper", manage: true, everyone: false });
    emit("collab-live-status", { projectId: "paper", status: { state: "ended", reason: "failed" }, pending: 0 });
    const restart = deferred<CollabLiveInfo>();
    start.mockReturnValueOnce(restart.promise);
    mocks.collabEditModeGet.mockRejectedValue({ code: "not_shared", message: "not shared" });
    useCollabLiveStore.getState().goLiveAgain();
    await settle();
    expect(start).toHaveBeenCalledTimes(2);
    emit("collab-live-role", { projectId: "paper", role: "owner", tracking: false, restricted: false, deletedExternally: false });
    emit("collab-comments-status", { projectId: "paper", status: {} });
    await settle();
    expect(mocks.collabEditModeGet).toHaveBeenCalledTimes(1);
    expect(useEditMode.getState()).toEqual(CLEARED);
    mocks.collabEditModeGet.mockResolvedValue(state({ everyone: true, guests: false, manage: true }));
    restart.resolve(info);
    await settle();
    expect(mocks.collabEditModeGet).toHaveBeenCalledTimes(2);
    expect(useEditMode.getState()).toMatchObject({ projectId: "paper", manage: true, everyone: true, guests: false });
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("still reads the mode when updates can't be listened for, and logs why", async () => {
    const { listen } = await import("@tauri-apps/api/event");
    vi.mocked(listen).mockRejectedValueOnce(new Error("no event bridge"));
    useCollabLiveStore.setState({ ...OVERLEAF_SEED.live("paper", "owner"), status: { state: "online" } });
    stop = startEditMode();
    await flush();
    expect(useEditMode.getState().mode).toBe("editing");
    expect(mocks.logError).toHaveBeenCalledExactlyOnceWith("collab edit mode listen", expect.any(Error));
  });
});

describe("track changes for others on Overleaf", () => {
  function owner(overrides: Partial<CollabEditModeState> = {}) {
    mocks.collabEditModeGet.mockResolvedValue(state({ everyone: false, guests: false, manage: true, ...overrides }));
    useCollabLiveStore.setState({ ...OVERLEAF_SEED.live("paper", "owner"), status: { state: "online" } });
    stop = startEditMode();
  }

  it("turns it on for everyone and for link guests, each with its own scope", async () => {
    owner();
    await flush();
    await setEditMode("suggesting", "everyone");
    expect(mocks.collabEditModeSet).toHaveBeenLastCalledWith("paper", "suggesting", "everyone");
    expect(useEditMode.getState()).toMatchObject({ everyone: true, guests: false, mode: "editing" });
    await setEditMode("suggesting", "guests");
    expect(mocks.collabEditModeSet).toHaveBeenLastCalledWith("paper", "suggesting", "guests");
    await setEditMode("editing", "everyone");
    expect(mocks.collabEditModeSet).toHaveBeenLastCalledWith("paper", "editing", "everyone");
    expect(useEditMode.getState()).toMatchObject({ everyone: false, guests: true });
    await setEditMode("editing", "everyone");
    expect(mocks.collabEditModeSet).toHaveBeenCalledTimes(3);
  });

  it("puts the setting back and says why when Overleaf refuses it", async () => {
    owner();
    await flush();
    mocks.collabEditModeSet.mockRejectedValue({ code: "review_off_server", message: "" });
    await setEditMode("suggesting", "everyone");
    expect(useEditMode.getState()).toMatchObject({ everyone: false, busy: false });
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(enCollab.errors.review_off_server);
  });

  it("offers the settings for others only to someone who may manage them", async () => {
    owner({ manage: false });
    await flush();
    await setEditMode("suggesting", "everyone");
    await setEditMode("suggesting", "guests");
    expect(mocks.collabEditModeSet).not.toHaveBeenCalled();
  });

  it("sends nothing for a setting this backend doesn't have", async () => {
    owner({ everyone: null, guests: null });
    await flush();
    await setEditMode("suggesting", "everyone");
    expect(mocks.collabEditModeSet).not.toHaveBeenCalled();
  });
});
