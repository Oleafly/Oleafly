// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/tauri", () => ({ getConfig: mocks.getConfig }));

import {
  loadResearchTasksFlag,
  primeResearchTasksFlag,
  researchTasksEnabled,
  resetResearchTasksFlagForTests,
  setResearchTasksEnabled,
  useResearchTasksEnabled,
  useResearchTasksFlagStore,
} from "./research-tasks-flag";

describe("research tasks switch (0.4.8: experimental, off by default)", () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue(undefined);
    mocks.getConfig.mockReset().mockResolvedValue({ research_tasks_enabled: false });
    resetResearchTasksFlagForTests();
  });

  it("is off until the config says otherwise, and reads the config once for every hook", async () => {
    mocks.getConfig.mockResolvedValue({ research_tasks_enabled: true });
    expect(researchTasksEnabled()).toBe(false);
    const first = renderHook(() => useResearchTasksEnabled());
    const second = renderHook(() => useResearchTasksEnabled());
    expect(first.result.current).toBe(false);
    await act(async () => {
      await loadResearchTasksFlag();
    });
    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(true);
    expect(researchTasksEnabled()).toBe(true);
    expect(mocks.getConfig).toHaveBeenCalledTimes(1);
    expect(useResearchTasksFlagStore.getState().enabled).toBe(true);
  });

  it("takes the switch from a config another caller read, without reading it again", async () => {
    primeResearchTasksFlag({ research_tasks_enabled: true });
    expect(researchTasksEnabled()).toBe(true);
    await loadResearchTasksFlag();
    expect(mocks.getConfig).not.toHaveBeenCalled();
    primeResearchTasksFlag({});
    expect(researchTasksEnabled()).toBe(false);
  });

  it("stays off and tries again when the config could not be read", async () => {
    mocks.getConfig.mockRejectedValueOnce(new Error("no config")).mockResolvedValue({ research_tasks_enabled: true });
    await loadResearchTasksFlag();
    expect(researchTasksEnabled()).toBe(false);
    await loadResearchTasksFlag();
    expect(researchTasksEnabled()).toBe(true);
    expect(mocks.getConfig).toHaveBeenCalledTimes(2);
  });

  it("turns tasks on and off through their own command", async () => {
    await setResearchTasksEnabled(true);
    expect(mocks.invoke).toHaveBeenCalledWith("research_tasks_set_enabled", { enabled: true });
    expect(researchTasksEnabled()).toBe(true);
    await setResearchTasksEnabled(false);
    expect(mocks.invoke).toHaveBeenLastCalledWith("research_tasks_set_enabled", { enabled: false });
    expect(researchTasksEnabled()).toBe(false);
  });

  it("keeps the switch where it was when the command fails", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("Research tasks are off, but some running tasks could not be stopped"));
    await expect(setResearchTasksEnabled(true)).rejects.toThrow("could not be stopped");
    expect(researchTasksEnabled()).toBe(false);
  });
});
