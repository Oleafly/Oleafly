// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planModeForProject, usePlanModeStore } from "./plan-mode";

beforeEach(() => {
  localStorage.clear();
  usePlanModeStore.setState({ enabledByProject: {}, loaded: {} });
});

describe("plan mode store", () => {
  it("defaults every project to off", () => {
    expect(planModeForProject({}, "project-a")).toBe(false);
    expect(usePlanModeStore.getState().load("project-a")).toBe(false);
  });

  it("toggles one project without changing another project", () => {
    expect(usePlanModeStore.getState().toggle("project-a")).toBe(true);
    expect(usePlanModeStore.getState().isEnabled("project-a")).toBe(true);
    expect(usePlanModeStore.getState().isEnabled("project-b")).toBe(false);

    expect(usePlanModeStore.getState().toggle("project-a")).toBe(false);
    expect(usePlanModeStore.getState().isEnabled("project-a")).toBe(false);
  });

  it("loads the persisted project selection", () => {
    usePlanModeStore.getState().setEnabled("project-a", true);
    usePlanModeStore.setState({ enabledByProject: {}, loaded: {} });

    expect(usePlanModeStore.getState().load("project-a")).toBe(true);
    expect(usePlanModeStore.getState().isEnabled("project-a")).toBe(true);
  });

  it("is off and unchanged without a project", () => {
    const store = usePlanModeStore.getState();

    expect(store.load(null)).toBe(false);
    expect(store.isEnabled(null)).toBe(false);
    expect(store.toggle(null)).toBe(false);
    store.setEnabled(null, true);

    expect(usePlanModeStore.getState().enabledByProject).toEqual({});
  });

  it("returns the remembered value without reading storage again", () => {
    usePlanModeStore.getState().setEnabled("project-a", true);
    localStorage.setItem("oleafly.plan-mode.project-a", "0");

    expect(usePlanModeStore.getState().load("project-a")).toBe(true);
  });
});

describe("plan mode without usable storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("treats unreadable storage as off and still switches for this session", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(usePlanModeStore.getState().isEnabled("project-b")).toBe(false);
    expect(usePlanModeStore.getState().toggle("project-b")).toBe(true);
    expect(usePlanModeStore.getState().isEnabled("project-b")).toBe(true);
  });
});
