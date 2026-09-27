// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    mocks.events.set(name, handler);
    return () => mocks.events.delete(name);
  }),
  probeProjectAvailability: vi.fn(),
  gitStatus: vi.fn(async () => []),
  approvalsModeGet: vi.fn(),
  approvalsModeSet: vi.fn(),
  refreshOpenFilesFromDisk: vi.fn(),
  clearFolderPause: vi.fn(),
  logError: vi.fn(async () => {}),
  files: {
    projectId: "linked-a" as string | null,
    resumeAutosave: vi.fn(),
    refreshTree: vi.fn(async () => {}),
  },
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@/lib/tauri", () => ({
  probeProjectAvailability: mocks.probeProjectAvailability,
  gitStatus: mocks.gitStatus,
  approvalsModeGet: mocks.approvalsModeGet,
  approvalsModeSet: mocks.approvalsModeSet,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/external-file-changes", () => ({
  refreshOpenFilesFromDisk: mocks.refreshOpenFilesFromDisk,
}));
vi.mock("@/store/compile", () => ({ clearFolderPause: mocks.clearFolderPause }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.files } }));

import { useApprovalModeStore } from "@/store/approval-mode";
import { useProjectAvailabilityStore } from "@/store/project-availability";
import { ProjectAvailabilityKeeper, recheckProjectAvailability } from "./ProjectAvailabilityKeeper";

beforeEach(() => {
  for (const fn of [
    mocks.probeProjectAvailability,
    mocks.refreshOpenFilesFromDisk,
    mocks.clearFolderPause,
    mocks.files.resumeAutosave,
    mocks.files.refreshTree,
    mocks.gitStatus,
    mocks.logError,
  ]) {
    fn.mockClear();
  }
  mocks.events.clear();
  useProjectAvailabilityStore.getState().reset("linked-a");
});

afterEach(() => {
  useProjectAvailabilityStore.getState().reset(null);
});

describe("ProjectAvailabilityKeeper", () => {
  it("applies backend availability events for the open project", async () => {
    render(<ProjectAvailabilityKeeper />);
    await waitFor(() => expect(mocks.events.has("project-availability")).toBe(true));
    act(() => {
      mocks.events.get("project-availability")?.({
        payload: {
          projectId: "linked-a",
          availability: "missing",
          locationGeneration: 0,
          relocated: false,
          grantsReset: false,
        },
      });
    });
    expect(useProjectAvailabilityStore.getState().availability).toBe("missing");
  });

  it("resumes saving, file refresh, compile and git once the folder is back", async () => {
    render(<ProjectAvailabilityKeeper />);
    act(() => {
      useProjectAvailabilityStore.getState().report("linked-a", "missing");
    });
    expect(mocks.files.resumeAutosave).not.toHaveBeenCalled();
    act(() => {
      useProjectAvailabilityStore.getState().report("linked-a", "ok");
    });
    expect(mocks.files.resumeAutosave).toHaveBeenCalledWith("linked-a");
    expect(mocks.files.refreshTree).toHaveBeenCalledTimes(1);
    expect(mocks.refreshOpenFilesFromDisk).toHaveBeenCalledWith("linked-a");
    expect(mocks.clearFolderPause).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.gitStatus).toHaveBeenCalledWith("linked-a"));
  });

  it("drops the cached approval mode after a rebind that reset grants", () => {
    useApprovalModeStore.setState({
      modes: { "linked-a": "full-access" },
      loaded: { "linked-a": true },
      persisted: { "linked-a": "full-access" },
    });
    render(<ProjectAvailabilityKeeper />);
    act(() => {
      useProjectAvailabilityStore.getState().apply({
        projectId: "linked-a",
        availability: "ok",
        locationGeneration: 1,
        relocated: true,
        grantsReset: true,
      });
    });
    expect(useApprovalModeStore.getState().modes).toEqual({});
    expect(mocks.files.resumeAutosave).toHaveBeenCalledWith("linked-a");
  });

  it("asks the backend again on focus only while the folder is unavailable", async () => {
    mocks.probeProjectAvailability.mockResolvedValue([
      { project_id: "linked-a", availability: "ok" },
    ]);
    render(<ProjectAvailabilityKeeper />);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.probeProjectAvailability).not.toHaveBeenCalled();
    act(() => {
      useProjectAvailabilityStore.getState().report("linked-a", "missing");
    });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.probeProjectAvailability).toHaveBeenCalledWith(["linked-a"]);
    await waitFor(() => expect(useProjectAvailabilityStore.getState().availability).toBe("ok"));
    expect(mocks.files.resumeAutosave).toHaveBeenCalledWith("linked-a");
  });

  it("runs one check at a time when focus, visibility and Try again all ask", async () => {
    let answer: (reports: { project_id: string; availability: string }[]) => void = () => {};
    mocks.probeProjectAvailability.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    useProjectAvailabilityStore.getState().report("linked-a", "missing");
    render(<ProjectAvailabilityKeeper />);
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const clicked = recheckProjectAvailability();
    expect(mocks.probeProjectAvailability).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer([{ project_id: "linked-a", availability: "ok" }]);
      await clicked;
    });
    expect(useProjectAvailabilityStore.getState().availability).toBe("ok");
    expect(mocks.files.resumeAutosave).toHaveBeenCalledTimes(1);
  });

  it("ignores a check that began before the folder was relocated", async () => {
    let answer: (reports: { project_id: string; availability: string }[]) => void = () => {};
    mocks.probeProjectAvailability.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    useProjectAvailabilityStore.getState().report("linked-a", "missing");
    const pending = recheckProjectAvailability();
    useProjectAvailabilityStore.getState().apply({
      projectId: "linked-a",
      availability: "ok",
      locationGeneration: 1,
      relocated: true,
      grantsReset: false,
    });
    answer([{ project_id: "linked-a", availability: "missing" }]);
    await pending;
    expect(useProjectAvailabilityStore.getState().availability).toBe("ok");
  });

  it("keeps the banner state when a recheck fails", async () => {
    useProjectAvailabilityStore.getState().report("linked-a", "offline");
    mocks.probeProjectAvailability.mockRejectedValue(new Error("busy"));
    await recheckProjectAvailability();
    expect(useProjectAvailabilityStore.getState().availability).toBe("offline");
    expect(mocks.logError).toHaveBeenCalled();
  });
});
