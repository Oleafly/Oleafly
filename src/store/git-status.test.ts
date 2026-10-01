import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gitStatus: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ gitStatus: mocks.gitStatus }));

import { useProjectAvailabilityStore } from "@/store/project-availability";
import { useGitStatusStore } from "./git-status";

beforeEach(() => {
  mocks.gitStatus.mockReset().mockResolvedValue([{ path: "main.tex" }]);
  useGitStatusStore.setState({ count: 0, projectId: null, changes: [] });
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

  it("keeps the changed paths for the Explorer and reuses them when a poll finds nothing new", async () => {
    const changes = [{ path: "main.tex", status: "M", staged: false, conflict: false }];
    mocks.gitStatus.mockResolvedValue(changes);
    await useGitStatusStore.getState().refresh("linked-a");
    const first = useGitStatusStore.getState().changes;
    expect(first).toEqual(changes);
    expect(useGitStatusStore.getState().projectId).toBe("linked-a");

    mocks.gitStatus.mockResolvedValue(changes.map((change) => ({ ...change })));
    await useGitStatusStore.getState().refresh("linked-a");
    expect(useGitStatusStore.getState().changes).toBe(first);

    mocks.gitStatus.mockResolvedValue([{ ...changes[0], staged: true }]);
    await useGitStatusStore.getState().refresh("linked-a");
    expect(useGitStatusStore.getState().changes).not.toBe(first);
  });

  it("clears the changed paths when no project is open", async () => {
    await useGitStatusStore.getState().refresh("linked-a");
    await useGitStatusStore.getState().refresh(null);
    expect(useGitStatusStore.getState()).toMatchObject({ count: 0, projectId: null, changes: [] });
  });
});
