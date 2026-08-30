// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
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
});
