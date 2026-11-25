import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetProgress, } from "./tauri";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

import {
  ASSET_PROGRESS_EVENT,
  withAssetProgress,
  withEventListener,
} from "./tauri";
import {
  COLLAB_CHANGE_SKIPPED_EVENT,
  COLLAB_OUTPUT_NOT_SHARED_EVENT,
  onCollabChangeSkipped,
  onCollabOutputNotShared,
} from "./tauri-collab";

const component: AssetProgress = {
  component: "lato",
  label: "Lato",
  file: "lato.zip",
  index: 1,
  total: 2,
  received: 10,
  file_total: 20,
};

function emit(event: string, payload: unknown): void {
  mocks.handlers.get(event)?.({ payload });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.listen.mockImplementation(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.handlers.set(event, handler);
    return mocks.unlisten;
  });
});

describe("withEventListener", () => {
  it("listens before the work starts and stops after it resolves", async () => {
    const seen: number[] = [];
    const result = await withEventListener<number, string>(
      "progress",
      (payload) => seen.push(payload),
      async () => {
        expect(mocks.unlisten).not.toHaveBeenCalled();
        emit("progress", 3);
        return "done";
      },
    );
    expect(result).toBe("done");
    expect(seen).toEqual([3]);
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("stops listening when the work fails", async () => {
    const failure = new Error("offline");
    await expect(
      withEventListener("progress", vi.fn(), () => Promise.reject(failure)),
    ).rejects.toBe(failure);
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("never starts the work when the listener cannot register", async () => {
    const failure = new Error("no bridge");
    mocks.listen.mockRejectedValueOnce(failure);
    const run = vi.fn(async () => undefined);
    await expect(withEventListener("progress", vi.fn(), run)).rejects.toBe(failure);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("asset progress", () => {

  it("scopes component progress to one piece of work", async () => {
    const onComponent = vi.fn();
    await withAssetProgress({ component: onComponent }, async () => {
      emit(ASSET_PROGRESS_EVENT, component);
    });
    expect(onComponent).toHaveBeenCalledExactlyOnceWith(component);
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });
});

describe("skipped collaboration changes", () => {
  it("hands each skipped change to the handler", async () => {
    const seen: unknown[] = [];
    const unlisten = await onCollabChangeSkipped((payload) => seen.push(payload));
    expect(COLLAB_CHANGE_SKIPPED_EVENT).toBe("collab-change-skipped");
    emit("collab-change-skipped", { projectId: "p", seq: 4, deviceId: null });
    expect(seen).toEqual([{ projectId: "p", seq: 4, deviceId: null }]);
    expect(unlisten).toBe(mocks.unlisten);
  });
});

describe("compiled PDFs that were not shared", () => {
  it("hands each refusal to the handler", async () => {
    const seen: unknown[] = [];
    const unlisten = await onCollabOutputNotShared((payload) => seen.push(payload));
    expect(COLLAB_OUTPUT_NOT_SHARED_EVENT).toBe("collab-output-not-shared");
    emit("collab-output-not-shared", { projectId: "p", reason: "tooLarge" });
    expect(seen).toEqual([{ projectId: "p", reason: "tooLarge" }]);
    expect(unlisten).toBe(mocks.unlisten);
  });
});
