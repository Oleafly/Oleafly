import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  autoCommit: vi.fn(),
  headOid: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  gitAutoCommitUpdate: (...args: unknown[]) => mocks.autoCommit(...args),
  gitHeadOid: (...args: unknown[]) => mocks.headOid(...args),
}));

vi.mock("@/store/settings", () => ({
  useSettingsStore: {
    getState: () => ({ railTab: "ai" }),
  },
}));

import { autoCommitNow, subscribeAutoCommit } from "./auto-commit";

beforeEach(() => {
  mocks.autoCommit.mockReset().mockResolvedValue(false);
  mocks.headOid.mockReset().mockResolvedValue("head-1");
});

describe("auto commit notifications", () => {
  it("publishes the project and commit id after a commit succeeds", async () => {
    mocks.autoCommit.mockResolvedValue(true);
    const listener = vi.fn();
    const unsubscribe = subscribeAutoCommit(listener);

    await autoCommitNow("project-1");

    expect(listener).toHaveBeenCalledWith({ projectId: "project-1", oid: "head-1" });
    unsubscribe();
  });

  it("does not publish when there was nothing to commit", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAutoCommit(listener);

    await autoCommitNow("project-1");

    expect(listener).not.toHaveBeenCalled();
    expect(mocks.headOid).not.toHaveBeenCalled();
    unsubscribe();
  });
});
