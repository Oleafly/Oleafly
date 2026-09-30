// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent-turns", () => ({ agentTurnFinish: vi.fn() }));

import { agentTurnFinish } from "@/lib/agent-turns";
import {
  closeLeftoverBuiltInTurns,
  forgetOpenBuiltInTurn,
  rememberOpenBuiltInTurn,
} from "./open-built-in-turns";

const KEY = "oleafly.open-built-in-turns";

function stored(): unknown[] {
  return JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]") as unknown[];
}

function leaveFromEarlierPage(snapshotId: string, projectId = "paper") {
  window.sessionStorage.setItem(
    KEY,
    JSON.stringify([...stored(), { projectId, snapshotId, page: "earlier-page" }]),
  );
}

beforeEach(() => {
  vi.mocked(agentTurnFinish).mockReset();
  window.sessionStorage.clear();
});

describe("open built-in turns", () => {
  it("never closes a turn this page began, so a remount cannot end a live run", async () => {
    rememberOpenBuiltInTurn("paper", "snap-live");
    await closeLeftoverBuiltInTurns();
    expect(agentTurnFinish).not.toHaveBeenCalled();
    expect(stored()).toEqual([expect.objectContaining({ projectId: "paper", snapshotId: "snap-live" })]);
    forgetOpenBuiltInTurn("snap-live");
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("closes a turn an earlier page left open once, and every caller waits for it", async () => {
    let finish!: () => void;
    vi.mocked(agentTurnFinish).mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({} as never);
      }),
    );
    leaveFromEarlierPage("snap-left");
    rememberOpenBuiltInTurn("paper", "snap-live");
    let settled = 0;
    const first = closeLeftoverBuiltInTurns().then(() => settled++);
    const second = closeLeftoverBuiltInTurns().then(() => settled++);
    await Promise.resolve();
    expect(settled).toBe(0);
    finish();
    await Promise.all([first, second]);
    expect(agentTurnFinish).toHaveBeenCalledExactlyOnceWith("paper", "snap-left");
    expect(stored()).toEqual([expect.objectContaining({ snapshotId: "snap-live" })]);
  });

  it("drops the record even when the backend refuses the finish", async () => {
    vi.mocked(agentTurnFinish).mockRejectedValue(new Error("gone"));
    leaveFromEarlierPage("snap-left");
    await expect(closeLeftoverBuiltInTurns()).resolves.toBeUndefined();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("ignores unreadable records", async () => {
    window.sessionStorage.setItem(KEY, "{not json");
    await expect(closeLeftoverBuiltInTurns()).resolves.toBeUndefined();
    window.sessionStorage.setItem(KEY, JSON.stringify([{ snapshotId: 4 }, "x"]));
    await expect(closeLeftoverBuiltInTurns()).resolves.toBeUndefined();
    expect(agentTurnFinish).not.toHaveBeenCalled();
  });
});
