import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabEditMode, CollabProjectRole } from "@/lib/tauri";
import { useCollabLiveStore } from "../live/live-store";
import { ALICE_ID, deferred, shareInfo } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabEditModeGet: vi.fn(),
  collabEditModeSet: vi.fn(),
  toastError: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabEditModeGet: mocks.collabEditModeGet,
  collabEditModeSet: mocks.collabEditModeSet,
}));

vi.mock("@/lib/toast", () => ({ toast: { error: mocks.toastError, info: vi.fn(), infoUnique: vi.fn() } }));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { setEditMode, startEditMode, useEditMode } from "./edit-mode";

let stop: (() => void) | null = null;

function live(role: CollabProjectRole) {
  useCollabLiveStore.setState({
    projectId: "paper",
    role,
    status: { state: "online" },
    share: shareInfo({ project_id: "paper", role, account_id: ALICE_ID }),
  });
}

async function flush() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.collabEditModeGet.mockResolvedValue("editing");
  mocks.collabEditModeSet.mockResolvedValue(undefined);
});

afterEach(() => {
  stop?.();
  stop = null;
  useCollabLiveStore.setState({ projectId: null, role: null, status: null, share: null });
  useEditMode.setState({ projectId: null, mode: null, busy: false });
});

describe("reading the edit mode", () => {
  it("falls back to Editing for an editor when the mode can't be read, and logs why", async () => {
    mocks.collabEditModeGet.mockRejectedValue({ code: "unreachable", message: "offline" });
    live("editor");
    stop = startEditMode();
    await flush();
    expect(useEditMode.getState()).toMatchObject({ projectId: "paper", mode: "editing", busy: false });
    expect(mocks.logError).toHaveBeenCalledWith("collab edit mode", expect.objectContaining({ code: "unreachable" }));
  });

  it("keeps a reviewer in Suggesting when the mode can't be read", async () => {
    mocks.collabEditModeGet.mockRejectedValue({ code: "unreachable", message: "offline" });
    live("reviewer");
    stop = startEditMode();
    await flush();
    expect(useEditMode.getState().mode).toBe("suggesting");
  });

  it("ignores a mode that arrives after the role changed", async () => {
    const first = deferred<CollabEditMode>();
    mocks.collabEditModeGet.mockReturnValueOnce(first.promise).mockResolvedValue("suggesting");
    live("editor");
    stop = startEditMode();
    useCollabLiveStore.setState({ role: "owner" });
    await flush();
    expect(useEditMode.getState().mode).toBe("suggesting");
    first.resolve("editing");
    await flush();
    expect(useEditMode.getState().mode).toBe("suggesting");
    expect(mocks.collabEditModeGet).toHaveBeenCalledTimes(2);
  });

  it("ignores a failed read that answers after the role changed", async () => {
    const first = deferred<CollabEditMode>();
    mocks.collabEditModeGet.mockReturnValueOnce(first.promise).mockResolvedValue("suggesting");
    live("editor");
    stop = startEditMode();
    useCollabLiveStore.setState({ role: "owner" });
    await flush();
    first.reject({ code: "unreachable", message: "offline" });
    await flush();
    expect(useEditMode.getState().mode).toBe("suggesting");
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("asks once per project and role, not for every live update", async () => {
    live("editor");
    stop = startEditMode();
    await flush();
    useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 1_000 } });
    useCollabLiveStore.setState({ status: { state: "online" } });
    await flush();
    expect(mocks.collabEditModeGet).toHaveBeenCalledTimes(1);
    expect(useEditMode.getState().mode).toBe("editing");
  });

  it("forgets the mode when the project stops being shared", async () => {
    live("owner");
    stop = startEditMode();
    await flush();
    expect(useEditMode.getState().mode).toBe("editing");
    useCollabLiveStore.setState({ share: null });
    expect(useEditMode.getState()).toEqual({ projectId: null, mode: null, busy: false });
  });
});

describe("switching the edit mode", () => {
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
    expect(mocks.collabEditModeSet).toHaveBeenCalledWith("paper", "suggesting");
  });

  it("never lets a reviewer switch to Editing", async () => {
    live("reviewer");
    stop = startEditMode();
    await flush();
    await setEditMode("editing");
    expect(mocks.collabEditModeSet).not.toHaveBeenCalled();
    expect(useEditMode.getState().mode).toBe("suggesting");
  });

  it("sends nothing while the project isn't shared", async () => {
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
    useCollabLiveStore.setState({ share: null });
    switching.reject({ code: "forbidden", message: "no" });
    await pending;
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith("collab set edit mode", expect.objectContaining({ code: "forbidden" }));
    expect(useEditMode.getState()).toEqual({ projectId: null, mode: null, busy: false });
  });
});
