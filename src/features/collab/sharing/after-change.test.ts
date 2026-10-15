import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ logError: vi.fn() }));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "../live/live-store";
import { syncMembersChange, syncShareChange } from "./after-change";

const refreshProjects = vi.fn();
const refreshShare = vi.fn(async () => undefined);
const refreshMembers = vi.fn(async () => undefined);
const original = useCollabLiveStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  refreshProjects.mockResolvedValue(undefined);
  useFilesStore.setState({ refreshProjects });
  useCollabLiveStore.setState({ projectId: "paper", refreshShare, refreshMembers });
});

afterEach(() => {
  useCollabLiveStore.setState({
    projectId: null,
    refreshShare: original.refreshShare,
    refreshMembers: original.refreshMembers,
  });
});

describe("catching up after a sharing change", () => {
  it("refreshes the library and the open project's share", async () => {
    await syncShareChange("paper");
    expect(refreshProjects).toHaveBeenCalledOnce();
    expect(refreshShare).toHaveBeenCalledOnce();
  });

  it("refreshes only the library for a project that is not open, and logs a failed refresh", async () => {
    const failure = new Error("disk busy");
    refreshProjects.mockRejectedValue(failure);
    await syncShareChange("thesis");
    expect(mocks.logError).toHaveBeenCalledWith("refresh projects after a sharing change", failure);
    expect(refreshShare).not.toHaveBeenCalled();
  });

  it("reloads members only for the open project", () => {
    syncMembersChange("thesis");
    expect(refreshMembers).not.toHaveBeenCalled();
    syncMembersChange("paper");
    expect(refreshMembers).toHaveBeenCalledOnce();
  });
});
