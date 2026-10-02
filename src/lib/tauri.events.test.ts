import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetProgress, SkillAssetProgress } from "./tauri";

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
  isSkillAssetProgress,
  onAssetProgress,
  withAssetProgress,
  withEventListener,
} from "./tauri";

const component: AssetProgress = {
  component: "lato",
  label: "Lato",
  file: "lato.zip",
  index: 1,
  total: 2,
  received: 10,
  file_total: 20,
};

const skill: SkillAssetProgress = {
  kind: "skill",
  id: "writing",
  phase: "download",
  received: 1,
  total: 4,
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
  it("tells skill progress apart from component progress", () => {
    expect(isSkillAssetProgress(skill)).toBe(true);
    expect(isSkillAssetProgress(component)).toBe(false);
    expect(isSkillAssetProgress({ kind: "font" } as unknown as SkillAssetProgress)).toBe(false);
    expect(isSkillAssetProgress(null as unknown as AssetProgress)).toBe(false);
  });

  it("routes each payload to its own handler", async () => {
    const onComponent = vi.fn();
    const onSkill = vi.fn();
    await onAssetProgress({ component: onComponent, skill: onSkill });
    expect(mocks.listen).toHaveBeenCalledWith(ASSET_PROGRESS_EVENT, expect.any(Function));

    emit(ASSET_PROGRESS_EVENT, component);
    emit(ASSET_PROGRESS_EVENT, skill);

    expect(onComponent).toHaveBeenCalledExactlyOnceWith(component);
    expect(onSkill).toHaveBeenCalledExactlyOnceWith(skill);
  });

  it("drops payloads that have no handler", async () => {
    const onSkill = vi.fn();
    await onAssetProgress({ skill: onSkill });
    emit(ASSET_PROGRESS_EVENT, component);
    expect(onSkill).not.toHaveBeenCalled();
  });

  it("scopes component progress to one piece of work", async () => {
    const onComponent = vi.fn();
    await withAssetProgress({ component: onComponent }, async () => {
      emit(ASSET_PROGRESS_EVENT, skill);
      emit(ASSET_PROGRESS_EVENT, component);
    });
    expect(onComponent).toHaveBeenCalledExactlyOnceWith(component);
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });
});
