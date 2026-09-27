import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gitStatus: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ gitStatus: mocks.gitStatus }));

import { useProjectAvailabilityStore } from "@/store/project-availability";
import { useGitStatusStore } from "./git-status";

beforeEach(() => {
  mocks.gitStatus.mockReset().mockResolvedValue([{ path: "main.tex" }]);
  useGitStatusStore.setState({ count: 0 });
  useProjectAvailabilityStore.getState().reset("linked-a");
});

describe("git status polling", () => {
  it("spawns no git while the folder is unavailable and keeps the last count", async () => {
    await useGitStatusStore.getState().refresh("linked-a");
    useProjectAvailabilityStore.getState().report("linked-a", "missing");
    await useGitStatusStore.getState().refresh("linked-a");
    expect(mocks.gitStatus).toHaveBeenCalledTimes(1);
    expect(useGitStatusStore.getState().count).toBe(1);
  });

  it("reports a folder that vanishes during a poll instead of zeroing quietly forever", async () => {
    mocks.gitStatus.mockRejectedValueOnce(
      `@oleafly/error:${JSON.stringify({ code: "project.linked_replaced", params: {}, detail: null })}`,
    );
    await useGitStatusStore.getState().refresh("linked-a");
    expect(useProjectAvailabilityStore.getState().availability).toBe("replaced");
  });
});
