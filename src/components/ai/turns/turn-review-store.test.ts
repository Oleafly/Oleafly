import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnFilePreview, TurnRevertResult, TurnStatus } from "@/lib/agent-turns";

vi.mock("@/lib/agent-turns", async (original) => ({
  ...(await original<typeof import("@/lib/agent-turns")>()),
  agentTurnStatus: vi.fn(),
  agentTurnPreview: vi.fn(),
  agentTurnRevert: vi.fn(),
  agentTurnRedo: vi.fn(),
}));

import { agentTurnPreview, agentTurnRedo, agentTurnRevert, agentTurnStatus } from "@/lib/agent-turns";
import type { ProjectStateChanged } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { EMPTY_TURN_REVIEW, useTurnReviewStore } from "./turn-review-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function preview(index: number): TurnFilePreview {
  return { index, path: `f${index}.tex`, change: "modified", before: "a", after: "b", binary: false, tooLarge: false, state: "applied" };
}

function review(snapshotId = "snap") {
  return useTurnReviewStore.getState().reviews[snapshotId] ?? EMPTY_TURN_REVIEW;
}

const STATE = { projectId: "paper" } as unknown as ProjectStateChanged;
const result = (reverted: number[], skipped: TurnRevertResult["skipped"] = []): TurnRevertResult => ({
  reverted,
  skipped,
  projectState: STATE,
});

beforeEach(() => {
  vi.resetAllMocks();
  useTurnReviewStore.getState().reset();
  vi.mocked(agentTurnStatus).mockResolvedValue({ expired: false, files: [] });
  useFilesStore.setState({
    runExternalProjectMutation: (async (_projectId: string, action: (generation: number) => Promise<unknown>) =>
      action(3)) as never,
  });
});

describe("turn review previews", () => {
  it("loads a diff once, closes it on a second toggle, and reuses it when reopened", async () => {
    vi.mocked(agentTurnPreview).mockResolvedValue(preview(0));
    const store = useTurnReviewStore.getState();

    await store.togglePreview("paper", "snap", 0);
    expect(review().open).toBe(0);
    expect(review().previews[0]).toEqual(preview(0));
    await store.togglePreview("paper", "snap", 0);
    expect(review().open).toBeNull();
    await store.togglePreview("paper", "snap", 0);

    expect(review().open).toBe(0);
    expect(agentTurnPreview).toHaveBeenCalledTimes(1);
  });

  it("does not load the same diff twice while the first load is running", async () => {
    const first = deferred<TurnFilePreview>();
    vi.mocked(agentTurnPreview).mockReturnValueOnce(first.promise);
    const store = useTurnReviewStore.getState();

    const loading = store.togglePreview("paper", "snap", 0);
    await store.togglePreview("paper", "snap", 0);
    await store.togglePreview("paper", "snap", 0);
    first.resolve(preview(0));
    await loading;

    expect(agentTurnPreview).toHaveBeenCalledTimes(1);
    expect(review().loadingPreview).toBeNull();
  });

  it("keeps the newer file loading and quiet when an older load settles", async () => {
    const first = deferred<TurnFilePreview>();
    const second = deferred<TurnFilePreview>();
    vi.mocked(agentTurnPreview).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const store = useTurnReviewStore.getState();

    const one = store.togglePreview("paper", "snap", 0);
    const two = store.togglePreview("paper", "snap", 1);
    first.reject(new Error("blob missing"));
    await one;

    expect(review().previewFailed).toBeNull();
    expect(review().loadingPreview).toBe(1);
    second.resolve(preview(1));
    await two;
    expect(review().loadingPreview).toBeNull();
  });

  it("keeps the newer file loading when an older load succeeds", async () => {
    const first = deferred<TurnFilePreview>();
    vi.mocked(agentTurnPreview).mockReturnValueOnce(first.promise).mockReturnValueOnce(new Promise(() => {}));
    const store = useTurnReviewStore.getState();

    const one = store.togglePreview("paper", "snap", 0);
    void store.togglePreview("paper", "snap", 1);
    first.resolve(preview(0));
    await one;

    expect(review().previews[0]).toEqual(preview(0));
    expect(review().loadingPreview).toBe(1);
  });
});

describe("turn review status", () => {
  it("shares a running status read and skips a read it already has", async () => {
    const pending = deferred<TurnStatus>();
    vi.mocked(agentTurnStatus).mockReturnValueOnce(pending.promise);
    const store = useTurnReviewStore.getState();

    const first = store.loadStatus("paper", "snap");
    const second = store.loadStatus("paper", "snap");
    expect(second).toBe(first);
    pending.resolve({ expired: true, files: [{ index: 2, state: "undone" }] });
    await first;
    await store.loadStatus("paper", "snap");

    expect(agentTurnStatus).toHaveBeenCalledTimes(1);
    expect(review()).toMatchObject({ expired: true, states: { 2: "undone" } });
  });

  it("keeps the row states when the status cannot be read", async () => {
    vi.mocked(agentTurnStatus).mockRejectedValue(new Error("gone"));

    await useTurnReviewStore.getState().loadStatus("paper", "snap");

    expect(review().states).toEqual({});
  });
});

describe("turn review actions", () => {
  it("ignores a second action while one is pending", async () => {
    const pending = deferred<TurnRevertResult>();
    vi.mocked(agentTurnRevert).mockReturnValueOnce(pending.promise);
    const store = useTurnReviewStore.getState();

    const first = store.run("paper", "snap", "undo", [0], 0);
    await store.run("paper", "snap", "undo", [1], 1);
    pending.resolve(result([0]));
    await first;

    expect(agentTurnRevert).toHaveBeenCalledExactlyOnceWith("paper", "snap", [0], 3);
  });

  it("marks the turn expired when the backend says its copy is gone", async () => {
    vi.mocked(agentTurnRedo).mockResolvedValue(result([1], [{ index: 0, reason: "expired" }, { index: 2, reason: "edited" }]));
    vi.mocked(agentTurnStatus).mockRejectedValue(new Error("offline"));

    await useTurnReviewStore.getState().run("paper", "snap", "redo", null, "all");

    expect(review()).toMatchObject({
      expired: true,
      pending: null,
      states: { 1: "applied", 2: "edited" },
      outcome: { action: "redo", done: 1, edited: true, failedWrites: false, failed: false },
    });
    expect(agentTurnStatus).toHaveBeenCalledWith("paper", "snap");
  });
});
