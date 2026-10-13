import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabLiveKept, CollabLiveKeptFile, CollabLiveUploads, CollabUploadFile } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  collabUploadList: vi.fn(),
  collabUploadRetry: vi.fn(),
  collabUploadDismiss: vi.fn(),
  uploadsHandler: null as null | ((payload: CollabLiveUploads) => void),
  keptHandler: null as null | ((payload: CollabLiveKept) => void),
}));

vi.mock("@/lib/tauri", () => ({
  collabUploadList: mocks.collabUploadList,
  collabUploadRetry: mocks.collabUploadRetry,
  collabUploadDismiss: mocks.collabUploadDismiss,
  onCollabLiveUploads: vi.fn(async (handler: (payload: CollabLiveUploads) => void) => {
    mocks.uploadsHandler = handler;
    return () => {
      mocks.uploadsHandler = null;
    };
  }),
  onCollabLiveKept: vi.fn(async (handler: (payload: CollabLiveKept) => void) => {
    mocks.keptHandler = handler;
    return () => {
      mocks.keptHandler = null;
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
  return { useFilesStore: create(() => ({ projectId: "paper" as string | null })) };
});

import { useFilesStore } from "@/store/files";
import { startFileNotices, useFileNotices } from "./file-notices";

function upload(overrides: Partial<CollabUploadFile> = {}): CollabUploadFile {
  return { path: "figures/plot.png", state: "waiting", size: 2048, limit: null, ...overrides };
}

function kept(overrides: Partial<CollabLiveKeptFile> = {}): CollabLiveKeptFile {
  return {
    id: "copy-id",
    path: "figures/plot.png",
    copy: "figures/plot (from Bob Smith).png",
    kind: "replaced",
    by: "acct-alice",
    ...overrides,
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

let stop: () => void = () => {};

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.collabUploadList.mockResolvedValue([]);
  mocks.collabUploadRetry.mockResolvedValue(undefined);
  mocks.collabUploadDismiss.mockResolvedValue(undefined);
  useFilesStore.setState({ projectId: "paper" });
  stop = startFileNotices();
  await settle();
});

afterEach(() => {
  stop();
});

describe("file notices", () => {
  it("shows the figures waiting to be shared in the open project and ignores other projects", async () => {
    mocks.uploadsHandler?.({ projectId: "other", files: [upload()] });
    expect(useFileNotices.getState().uploads).toEqual([]);
    mocks.uploadsHandler?.({ projectId: "paper", files: [upload(), upload({ path: "big.png", state: "too_large" })] });
    expect(useFileNotices.getState().uploads.map((file) => file.path)).toEqual(["figures/plot.png", "big.png"]);
    mocks.uploadsHandler?.({ projectId: "paper", files: [] });
    expect(useFileNotices.getState().uploads).toEqual([]);
  });

  it("loads the waiting figures when a project opens", async () => {
    stop();
    mocks.collabUploadList.mockResolvedValueOnce([upload({ state: "failed" })]);
    useFilesStore.setState({ projectId: "thesis" });
    stop = startFileNotices();
    await settle();
    expect(mocks.collabUploadList).toHaveBeenCalledWith("thesis");
    expect(useFileNotices.getState()).toMatchObject({ projectId: "thesis", uploads: [upload({ state: "failed" })] });
    mocks.collabUploadList.mockResolvedValueOnce([]);
    useFilesStore.setState({ projectId: "paper" });
    await settle();
    expect(useFileNotices.getState()).toMatchObject({ projectId: "paper", uploads: [], kept: [] });
  });

  it("keeps the newest copy notice first until it is dismissed", () => {
    mocks.keptHandler?.({ projectId: "paper", files: [kept()] });
    mocks.keptHandler?.({
      projectId: "paper",
      files: [kept({ id: "plan-id", kind: "added", path: "plan.tex", copy: "plan (from Bob Smith).tex" })],
    });
    expect(useFileNotices.getState().kept.map((file) => file.id)).toEqual(["plan-id", "copy-id"]);
    useFileNotices.getState().dismissKept("plan-id");
    expect(useFileNotices.getState().kept.map((file) => file.id)).toEqual(["copy-id"]);
    mocks.keptHandler?.({ projectId: "other", files: [kept({ id: "elsewhere" })] });
    expect(useFileNotices.getState().kept.map((file) => file.id)).toEqual(["copy-id"]);
  });

  it("retries the waiting figures and forgets a figure the person dismisses", async () => {
    mocks.uploadsHandler?.({ projectId: "paper", files: [upload(), upload({ path: "big.png", state: "too_large" })] });
    await useFileNotices.getState().retry();
    expect(mocks.collabUploadRetry).toHaveBeenCalledWith("paper");
    expect(useFileNotices.getState().retrying).toBe(false);
    useFileNotices.getState().dismissUpload("big.png");
    expect(mocks.collabUploadDismiss).toHaveBeenCalledWith("paper", "big.png");
    expect(useFileNotices.getState().uploads.map((file) => file.path)).toEqual(["figures/plot.png"]);
  });
});
