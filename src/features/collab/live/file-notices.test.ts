import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CollabLiveKept,
  CollabLiveKeptFile,
  CollabLiveUploads,
  CollabUploadFile,
  CollabUploadProgress,
} from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  collabUploadList: vi.fn(),
  collabUploadRetry: vi.fn(),
  collabUploadDismiss: vi.fn(),
  collabLocalCopyOffer: vi.fn(),
  collabLocalCopyBringIn: vi.fn(),
  collabLocalCopyDecline: vi.fn(),
  uploadsHandler: null as null | ((payload: CollabLiveUploads) => void),
  keptHandler: null as null | ((payload: CollabLiveKept) => void),
  progressHandler: null as null | ((payload: CollabUploadProgress) => void),
}));

vi.mock("@/lib/tauri", () => ({
  collabUploadList: mocks.collabUploadList,
  collabUploadRetry: mocks.collabUploadRetry,
  collabUploadDismiss: mocks.collabUploadDismiss,
  collabLocalCopyOffer: mocks.collabLocalCopyOffer,
  collabLocalCopyBringIn: mocks.collabLocalCopyBringIn,
  collabLocalCopyDecline: mocks.collabLocalCopyDecline,
  isCollabCommandError: (error: unknown) =>
    typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string",
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
  onCollabUploadProgress: vi.fn(async (handler: (payload: CollabUploadProgress) => void) => {
    mocks.progressHandler = handler;
    return () => {
      mocks.progressHandler = null;
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
import { deferred, person, projectMember } from "../tests/fixtures";
import { startFileNotices, useFileNotices } from "./file-notices";
import { useCollabLiveStore } from "./live-store";

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
  mocks.collabLocalCopyOffer.mockResolvedValue(null);
  mocks.collabLocalCopyBringIn.mockResolvedValue(undefined);
  mocks.collabLocalCopyDecline.mockResolvedValue(undefined);
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

  it("follows how far each waiting figure got in the open project until it is up", () => {
    mocks.uploadsHandler?.({ projectId: "paper", files: [upload(), upload({ path: "figures/map.png" })] });
    mocks.progressHandler?.({ projectId: "other", path: "figures/plot.png", done: 1, total: 4 });
    expect(useFileNotices.getState().progress).toEqual({});
    mocks.progressHandler?.({ projectId: "paper", path: "figures/plot.png", done: 1024, total: 4096 });
    mocks.progressHandler?.({ projectId: "paper", path: "figures/map.png", done: 10, total: 20 });
    expect(useFileNotices.getState().progress).toEqual({
      "figures/plot.png": { done: 1024, total: 4096 },
      "figures/map.png": { done: 10, total: 20 },
    });
    mocks.progressHandler?.({ projectId: "paper", path: "figures/plot.png", done: 4096, total: 4096 });
    expect(useFileNotices.getState().progress).toEqual({ "figures/map.png": { done: 10, total: 20 } });
    mocks.uploadsHandler?.({ projectId: "paper", files: [upload({ path: "figures/map.png", state: "failed" })] });
    expect(useFileNotices.getState().progress).toEqual({});
  });

  it("forgets upload progress when another project opens", async () => {
    mocks.uploadsHandler?.({ projectId: "paper", files: [upload()] });
    mocks.progressHandler?.({ projectId: "paper", path: "figures/plot.png", done: 1, total: 4 });
    useFilesStore.setState({ projectId: "thesis" });
    await settle();
    expect(useFileNotices.getState().progress).toEqual({});
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

describe("changes made in a local copy", () => {
  const OFFER = { copyId: "paper-copy", name: "R4 Paper (local copy)", files: ["main.tex", "plot.png"] };

  async function offered(): Promise<void> {
    stop();
    mocks.collabLocalCopyOffer.mockResolvedValueOnce(OFFER);
    stop = startFileNotices();
    await settle();
  }

  it("are offered when the shared project opens and brought in when the person asks", async () => {
    await offered();
    expect(mocks.collabLocalCopyOffer).toHaveBeenCalledWith("paper");
    expect(useFileNotices.getState().offer).toEqual(OFFER);
    await useFileNotices.getState().bringIn();
    expect(mocks.collabLocalCopyBringIn).toHaveBeenCalledWith("paper", "paper-copy");
    expect(useFileNotices.getState()).toMatchObject({ offer: null, bringing: false, broughtIn: OFFER.name });
    useFileNotices.getState().dismissBroughtIn();
    expect(useFileNotices.getState().broughtIn).toBeNull();
  });

  it("stay offered with the reason when bringing them in fails", async () => {
    await offered();
    mocks.collabLocalCopyBringIn.mockRejectedValueOnce({ code: "not_found", message: "not live" });
    await useFileNotices.getState().bringIn();
    expect(useFileNotices.getState()).toMatchObject({ offer: OFFER, bringing: false, offerFailure: "not_found" });
  });

  it("go away for good when the person keeps the copy separate", async () => {
    await offered();
    useFileNotices.getState().keepSeparate();
    expect(useFileNotices.getState().offer).toBeNull();
    await settle();
    expect(mocks.collabLocalCopyDecline).toHaveBeenCalledWith("paper", "paper-copy");
  });

  it("belong to the project they were offered in", async () => {
    await offered();
    useFilesStore.setState({ projectId: "thesis" });
    await settle();
    expect(useFileNotices.getState()).toMatchObject({ projectId: "thesis", offer: null, broughtIn: null });
  });
});

describe("guards on file notices", () => {
  const OFFER = { copyId: "paper-copy", name: "R4 Paper (local copy)", files: ["main.tex"] };

  it("retries once while a retry is running and settles back when it fails", async () => {
    const running = deferred<undefined>();
    mocks.collabUploadRetry.mockReturnValueOnce(running.promise);
    const first = useFileNotices.getState().retry();
    expect(useFileNotices.getState().retrying).toBe(true);
    await useFileNotices.getState().retry();
    expect(mocks.collabUploadRetry).toHaveBeenCalledOnce();
    running.reject(new Error("offline"));
    await first;
    expect(useFileNotices.getState().retrying).toBe(false);
  });

  it("does nothing with no project open", async () => {
    stop();
    stop = () => {};
    useFileNotices.setState({ uploads: [upload()], offer: OFFER });
    await useFileNotices.getState().retry();
    useFileNotices.getState().dismissUpload("figures/plot.png");
    await useFileNotices.getState().bringIn();
    useFileNotices.getState().keepSeparate();
    expect(mocks.collabUploadRetry).not.toHaveBeenCalled();
    expect(mocks.collabUploadDismiss).not.toHaveBeenCalled();
    expect(mocks.collabLocalCopyBringIn).not.toHaveBeenCalled();
    expect(mocks.collabLocalCopyDecline).not.toHaveBeenCalled();
    expect(useFileNotices.getState().uploads).toHaveLength(1);
  });

  it("has nothing to bring in or keep separate without an offer", async () => {
    await useFileNotices.getState().bringIn();
    useFileNotices.getState().keepSeparate();
    expect(mocks.collabLocalCopyBringIn).not.toHaveBeenCalled();
    expect(mocks.collabLocalCopyDecline).not.toHaveBeenCalled();
  });

  it("brings changes in once and cannot be kept separate halfway through", async () => {
    useFileNotices.setState({ offer: OFFER });
    const bringing = deferred<undefined>();
    mocks.collabLocalCopyBringIn.mockReturnValueOnce(bringing.promise);
    const first = useFileNotices.getState().bringIn();
    await useFileNotices.getState().bringIn();
    useFileNotices.getState().keepSeparate();
    expect(mocks.collabLocalCopyBringIn).toHaveBeenCalledOnce();
    expect(mocks.collabLocalCopyDecline).not.toHaveBeenCalled();
    expect(useFileNotices.getState().offer).toEqual(OFFER);
    bringing.resolve(undefined);
    await first;
    expect(useFileNotices.getState()).toMatchObject({ offer: null, bringing: false, broughtIn: OFFER.name });
  });

  it("says nothing in the next project when bringing changes in finishes there", async () => {
    useFileNotices.setState({ offer: OFFER });
    const done = deferred<undefined>();
    mocks.collabLocalCopyBringIn.mockReturnValueOnce(done.promise);
    const bringing = useFileNotices.getState().bringIn();
    useFilesStore.setState({ projectId: "thesis" });
    done.resolve(undefined);
    await bringing;
    expect(useFileNotices.getState()).toMatchObject({ projectId: "thesis", broughtIn: null, bringing: false });
  });

  it("shows no failure in the next project when bringing changes in fails there", async () => {
    useFileNotices.setState({ offer: OFFER });
    const done = deferred<undefined>();
    mocks.collabLocalCopyBringIn.mockReturnValueOnce(done.promise);
    const bringing = useFileNotices.getState().bringIn();
    useFilesStore.setState({ projectId: "thesis" });
    done.reject({ code: "not_found", message: "gone" });
    await bringing;
    expect(useFileNotices.getState()).toMatchObject({ projectId: "thesis", offerFailure: null, bringing: false });
  });

  it("asks for the people list only when a copy names someone new", () => {
    const original = useCollabLiveStore.getState().refreshMembers;
    const refreshMembers = vi.fn(async () => {});
    useCollabLiveStore.setState({ refreshMembers, members: [projectMember(person({ account_id: "acct-alice" }))] });
    try {
      mocks.keptHandler?.({ projectId: "paper", files: [kept()] });
      mocks.keptHandler?.({ projectId: "paper", files: [kept({ id: "nobody-id", by: null })] });
      expect(refreshMembers).not.toHaveBeenCalled();
      mocks.keptHandler?.({ projectId: "paper", files: [kept({ id: "carol-id", by: "acct-carol" })] });
      expect(refreshMembers).toHaveBeenCalledOnce();
      expect(useFileNotices.getState().kept.map((file) => file.id)).toEqual(["carol-id", "nobody-id", "copy-id"]);
    } finally {
      useCollabLiveStore.setState({ refreshMembers: original, members: [] });
    }
  });

  it("looks nothing up when the project closes", async () => {
    mocks.collabUploadList.mockClear();
    mocks.collabLocalCopyOffer.mockClear();
    useFilesStore.setState({ projectId: null });
    await settle();
    expect(mocks.collabUploadList).not.toHaveBeenCalled();
    expect(mocks.collabLocalCopyOffer).not.toHaveBeenCalled();
    expect(useFileNotices.getState()).toMatchObject({ projectId: null, uploads: [], kept: [], offer: null });
  });

  it("drops figures and offers that arrive after another project opened", async () => {
    const uploads = deferred<CollabUploadFile[]>();
    const offer = deferred<typeof OFFER | null>();
    mocks.collabUploadList.mockReturnValueOnce(uploads.promise);
    mocks.collabLocalCopyOffer.mockReturnValueOnce(offer.promise);
    useFilesStore.setState({ projectId: "thesis" });
    useFilesStore.setState({ projectId: "paper" });
    uploads.resolve([upload({ state: "failed" })]);
    offer.resolve(OFFER);
    await settle();
    expect(useFileNotices.getState()).toMatchObject({ projectId: "paper", uploads: [], offer: null });
  });

  it("does not look again when something else about the open project changes", async () => {
    mocks.collabUploadList.mockClear();
    mocks.uploadsHandler?.({ projectId: "paper", files: [upload()] });
    useFilesStore.setState({ projectId: "paper" });
    await settle();
    expect(mocks.collabUploadList).not.toHaveBeenCalled();
    expect(useFileNotices.getState().uploads).toEqual([upload()]);
  });
});
