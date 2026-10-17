// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    mocks.events.set(name, handler);
    return () => mocks.events.delete(name);
  }),
  watchProjectFolder: vi.fn(async (): Promise<number | null> => 7),
  unwatchProjectFolder: vi.fn(async () => true),
  applyFolderChange: vi.fn(),
  logError: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock("@/lib/tauri", () => ({
  COLLAB_LIVE_WRITTEN_EVENT: "collab-live-written",
  watchProjectFolder: mocks.watchProjectFolder,
  unwatchProjectFolder: mocks.unwatchProjectFolder,
}));
vi.mock("@/lib/external-file-changes", () => ({ applyFolderChange: mocks.applyFolderChange }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { diskHash } from "@/lib/disk-hash";
import { useFilesStore } from "@/store/files";
import { useProjectAvailabilityStore } from "@/store/project-availability";
import { FolderWatchKeeper } from "./FolderWatchKeeper";

beforeEach(() => {
  mocks.events.clear();
  mocks.watchProjectFolder.mockClear();
  mocks.unwatchProjectFolder.mockClear();
  mocks.applyFolderChange.mockClear();
  useFilesStore.setState({ projectId: "linked-a", manifestHome: "device" });
  useProjectAvailabilityStore.getState().reset("linked-a");
});
afterEach(() => {
  cleanup();
  useProjectAvailabilityStore.getState().reset(null);
});

describe("FolderWatchKeeper and the files a stopped live session wrote", () => {
  function written(text: string) {
    act(() =>
      mocks.events.get("collab-live-written")?.({
        payload: {
          projectId: "linked-a",
          files: [{ path: "main.tex", hash: diskHash(text), crlf: false, length: text.length }],
        },
      }),
    );
  }

  it("takes what the disk holds when the window has that text, with or without a live session", async () => {
    useFilesStore.setState({ files: { "main.tex": { content: "a\nremote\n", dirty: false } } });
    const view = render(<FolderWatchKeeper />);
    await waitFor(() => expect(mocks.events.has("collab-live-written")).toBe(true));
    written("a\nremote\n");
    expect(mocks.applyFolderChange).not.toHaveBeenCalled();
    view.unmount();
  });

  it("checks a file like any outside change when the disk holds text the window doesn't have", async () => {
    useFilesStore.setState({ files: { "main.tex": { content: "a\n", dirty: false } } });
    const view = render(<FolderWatchKeeper />);
    await waitFor(() => expect(mocks.events.has("collab-live-written")).toBe(true));
    written("a\ncollaborator\n");
    expect(mocks.applyFolderChange).toHaveBeenCalledExactlyOnceWith({
      projectId: "linked-a",
      paths: ["main.tex"],
      rescan: false,
    });
    view.unmount();
  });
});

describe("FolderWatchKeeper", () => {
  it("watches an opened folder and stops when the project closes", async () => {
    const view = render(<FolderWatchKeeper />);
    await waitFor(() => expect(mocks.watchProjectFolder).toHaveBeenCalledWith("linked-a"));

    act(() => useFilesStore.setState({ projectId: null, manifestHome: "library" }));
    await waitFor(() => expect(mocks.unwatchProjectFolder).toHaveBeenCalledWith("linked-a", 7));
    view.unmount();
  });

  it("asks Rust about a library project and leaves it alone when Rust declines", async () => {
    mocks.watchProjectFolder.mockResolvedValueOnce(null);
    useFilesStore.setState({ projectId: "paper", manifestHome: "library" });
    const view = render(<FolderWatchKeeper />);
    await waitFor(() => expect(mocks.watchProjectFolder).toHaveBeenCalledWith("paper"));

    view.unmount();
    await act(() => Promise.resolve());
    expect(mocks.unwatchProjectFolder).not.toHaveBeenCalled();
  });

  it("watches a shared library project and stops when the project closes", async () => {
    mocks.watchProjectFolder.mockResolvedValueOnce(9);
    useFilesStore.setState({ projectId: "paper", manifestHome: "library" });
    render(<FolderWatchKeeper />);
    await waitFor(() => expect(mocks.watchProjectFolder).toHaveBeenCalledWith("paper"));

    act(() => useFilesStore.setState({ projectId: null }));
    await waitFor(() => expect(mocks.unwatchProjectFolder).toHaveBeenCalledWith("paper", 9));
  });

  it("stops while the folder is unavailable and starts again when it returns", async () => {
    render(<FolderWatchKeeper />);
    await waitFor(() => expect(mocks.watchProjectFolder).toHaveBeenCalledTimes(1));

    act(() => useProjectAvailabilityStore.getState().report("linked-a", "missing"));
    await waitFor(() => expect(mocks.unwatchProjectFolder).toHaveBeenCalledWith("linked-a", 7));

    act(() => useProjectAvailabilityStore.getState().report("linked-a", "ok"));
    await waitFor(() => expect(mocks.watchProjectFolder).toHaveBeenCalledTimes(2));
  });

  it("watches the new place again after the folder moves", async () => {
    mocks.watchProjectFolder.mockResolvedValueOnce(7).mockResolvedValueOnce(8);
    render(<FolderWatchKeeper />);
    await waitFor(() => expect(mocks.watchProjectFolder).toHaveBeenCalledTimes(1));

    act(() =>
      useProjectAvailabilityStore.getState().apply({
        projectId: "linked-a",
        availability: "ok",
        locationGeneration: 1,
        relocated: true,
        grantsReset: false,
      }),
    );
    await waitFor(() => expect(mocks.watchProjectFolder).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.unwatchProjectFolder).toHaveBeenCalledWith("linked-a", 7));
    expect(mocks.unwatchProjectFolder).toHaveBeenCalledTimes(1);

    act(() =>
      useProjectAvailabilityStore.getState().apply({
        projectId: "linked-a",
        availability: "ok",
        locationGeneration: 2,
        relocated: false,
        grantsReset: false,
      }),
    );
    await act(() => Promise.resolve());
    expect(mocks.watchProjectFolder).toHaveBeenCalledTimes(2);
  });

  it("logs a watch that fails to start and never stops it", async () => {
    const failure = new Error("watch refused");
    mocks.watchProjectFolder.mockRejectedValueOnce(failure);
    mocks.logError.mockClear();
    const view = render(<FolderWatchKeeper />);
    await waitFor(() =>
      expect(mocks.logError).toHaveBeenCalledWith("watch project folder", failure),
    );

    view.unmount();
    await act(() => Promise.resolve());
    expect(mocks.unwatchProjectFolder).not.toHaveBeenCalled();
  });

  it("applies folder changes the backend reports", async () => {
    render(<FolderWatchKeeper />);
    await waitFor(() => expect(mocks.events.has("project-folder-changed")).toBe(true));
    const change = { projectId: "linked-a", paths: ["main.tex"], rescan: false };
    act(() => mocks.events.get("project-folder-changed")?.({ payload: change }));
    expect(mocks.applyFolderChange).toHaveBeenCalledWith(change);
  });
});
