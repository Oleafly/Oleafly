import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalMode } from "@oleafly/ai-tools";

const mocks = vi.hoisted(() => ({
  getMode: vi.fn(),
  setMode: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  approvalsModeGet: (...args: unknown[]) => mocks.getMode(...args),
  approvalsModeSet: (...args: unknown[]) => mocks.setMode(...args),
}));

import {
  approvalModeForProject,
  useApprovalModeStore,
} from "./approval-mode";

beforeEach(() => {
  mocks.getMode.mockReset().mockResolvedValue("approve-for-me");
  mocks.setMode.mockReset().mockResolvedValue(undefined);
  useApprovalModeStore.setState({ modes: {}, loaded: {}, persisted: {} });
});

describe("approval mode store", () => {
  it("defaults projects to Approve for me until persisted state loads", () => {
    expect(approvalModeForProject({}, "project-a")).toBe("approve-for-me");
    expect(approvalModeForProject({}, null)).toBe("approve-for-me");
  });

  it("loads and caches the persisted project mode", async () => {
    mocks.getMode.mockResolvedValue("custom");

    await expect(useApprovalModeStore.getState().load("project-a")).resolves.toBe("custom");

    expect(mocks.getMode).toHaveBeenCalledWith("project-a");
    expect(useApprovalModeStore.getState().modes).toEqual({ "project-a": "custom" });
    await useApprovalModeStore.getState().load("project-a");
    expect(mocks.getMode).toHaveBeenCalledTimes(1);
  });

  it("updates the active mode immediately and persists it per project", async () => {
    await useApprovalModeStore.getState().load("project-a");
    const write = useApprovalModeStore.getState().setMode("project-a", "full-access");

    expect(approvalModeForProject(useApprovalModeStore.getState().modes, "project-a")).toBe(
      "full-access",
    );
    await write;
    expect(mocks.setMode).toHaveBeenCalledWith("project-a", "full-access");
  });

  it("waits for the latest persisted selection before starting a run", async () => {
    let release!: () => void;
    mocks.setMode.mockImplementation(
      () => new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    await useApprovalModeStore.getState().load("project-a");
    void useApprovalModeStore.getState().setMode("project-a", "full-access");
    let settled = false;
    const ready = useApprovalModeStore
      .getState()
      .ready("project-a")
      .then((mode: ApprovalMode) => {
        settled = true;
        return mode;
      });

    await vi.waitFor(() => expect(mocks.setMode).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    release();
    await expect(ready).resolves.toBe("full-access");
  });

  it("refreshes persisted state before each run", async () => {
    useApprovalModeStore.setState({
      modes: { "project-a": "full-access" },
      loaded: { "project-a": true },
      persisted: { "project-a": "full-access" },
    });
    mocks.getMode.mockResolvedValue("ask-for-approval");

    await expect(useApprovalModeStore.getState().ready("project-a")).resolves.toBe(
      "ask-for-approval",
    );
    expect(useApprovalModeStore.getState().modes["project-a"]).toBe("ask-for-approval");
  });

  it("does not relax the cached mode when a run-time refresh fails", async () => {
    useApprovalModeStore.setState({
      modes: { "project-a": "ask-for-approval" },
      loaded: { "project-a": true },
      persisted: { "project-a": "ask-for-approval" },
    });
    mocks.getMode.mockRejectedValue(new Error("approval mode unavailable"));

    await expect(useApprovalModeStore.getState().ready("project-a")).rejects.toThrow(
      "approval mode unavailable",
    );
    expect(useApprovalModeStore.getState().modes["project-a"]).toBe("ask-for-approval");
  });

  it("keeps a failed initial read unresolved", async () => {
    mocks.getMode.mockRejectedValue(new Error("approval mode unavailable"));

    await expect(useApprovalModeStore.getState().load("project-a")).rejects.toThrow(
      "approval mode unavailable",
    );
    expect(useApprovalModeStore.getState().loaded["project-a"]).toBeUndefined();
  });

  it("rolls rapid failed selections back to the last persisted mode", async () => {
    useApprovalModeStore.setState({
      modes: { "project-a": "approve-for-me" },
      loaded: { "project-a": true },
      persisted: { "project-a": "approve-for-me" },
    });
    mocks.setMode.mockRejectedValue(new Error("write failed"));

    const first = useApprovalModeStore.getState().setMode("project-a", "full-access");
    const second = useApprovalModeStore.getState().setMode("project-a", "ask-for-approval");
    await Promise.allSettled([first, second]);

    expect(useApprovalModeStore.getState().modes["project-a"]).toBe("approve-for-me");
    expect(useApprovalModeStore.getState().persisted["project-a"]).toBe("approve-for-me");
  });

  it("uses the loaded baseline when the first selection fails", async () => {
    let release!: (mode: ApprovalMode) => void;
    mocks.getMode.mockImplementation(
      () => new Promise<ApprovalMode>((resolve) => {
        release = resolve;
      }),
    );
    mocks.setMode.mockRejectedValue(new Error("write failed"));

    const write = useApprovalModeStore.getState().setMode("project-a", "full-access");
    release("ask-for-approval");
    await expect(write).rejects.toThrow("write failed");

    expect(useApprovalModeStore.getState().modes["project-a"]).toBe("ask-for-approval");
    expect(useApprovalModeStore.getState().persisted["project-a"]).toBe("ask-for-approval");
  });

  it("retries a run refresh after a concurrent selection fails", async () => {
    useApprovalModeStore.setState({
      modes: { "project-a": "full-access" },
      loaded: { "project-a": true },
      persisted: { "project-a": "full-access" },
    });
    let release!: (mode: ApprovalMode) => void;
    mocks.getMode
      .mockImplementationOnce(
        () => new Promise<ApprovalMode>((resolve) => {
          release = resolve;
        }),
      )
      .mockResolvedValueOnce("ask-for-approval");
    mocks.setMode.mockRejectedValue(new Error("write failed"));

    const ready = useApprovalModeStore.getState().ready("project-a");
    await vi.waitFor(() => expect(mocks.getMode).toHaveBeenCalledOnce());
    await expect(
      useApprovalModeStore.getState().setMode("project-a", "approve-for-me"),
    ).rejects.toThrow("write failed");
    release("ask-for-approval");

    await expect(ready).resolves.toBe("ask-for-approval");
    expect(mocks.getMode).toHaveBeenCalledTimes(2);
  });
});
