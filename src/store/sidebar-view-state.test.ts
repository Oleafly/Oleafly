import { beforeEach, describe, expect, it } from "vitest";
import {
  readSidebarView,
  resetSidebarViewState,
  SIDEBAR_VIEW_PROJECT_LIMIT,
  useSidebarViewStore,
  writeSidebarView,
} from "./sidebar-view-state";

beforeEach(() => {
  resetSidebarViewState();
});

describe("sidebar view state", () => {
  it("returns nothing for a project that has not been remembered yet", () => {
    expect(readSidebarView("alpha", "files")).toBeUndefined();
  });

  it("remembers each view of a project separately from other projects", () => {
    writeSidebarView("alpha", "files", { expanded: new Set(["docs"]), selected: null });
    writeSidebarView("alpha", "scroll.files", 320);
    writeSidebarView("beta", "scroll.files", 40);

    expect(readSidebarView("alpha", "files")?.expanded).toEqual(new Set(["docs"]));
    expect(readSidebarView("alpha", "scroll.files")).toBe(320);
    expect(readSidebarView("beta", "scroll.files")).toBe(40);
    expect(readSidebarView("beta", "files")).toBeUndefined();
  });

  it("replaces an earlier value for the same view", () => {
    writeSidebarView("alpha", "scroll.search", 10);
    writeSidebarView("alpha", "scroll.search", 25);
    expect(readSidebarView("alpha", "scroll.search")).toBe(25);
  });

  it("neither remembers nor returns anything without a project", () => {
    writeSidebarView(null, "scroll.search", 10);
    expect(readSidebarView(null, "scroll.search")).toBeUndefined();
    expect(useSidebarViewStore.getState().projects.size).toBe(0);
  });

  it("forgets everything on reset", () => {
    writeSidebarView("alpha", "scroll.search", 10);
    resetSidebarViewState();
    expect(readSidebarView("alpha", "scroll.search")).toBeUndefined();
  });

  it("drops the project that was used longest ago once the limit is passed", () => {
    for (let index = 0; index < SIDEBAR_VIEW_PROJECT_LIMIT; index += 1) {
      writeSidebarView(`project-${index}`, "scroll.mcp", index);
    }
    writeSidebarView("project-0", "scroll.mcp", 999);
    writeSidebarView("newcomer", "scroll.mcp", 1);

    expect(useSidebarViewStore.getState().projects.size).toBe(SIDEBAR_VIEW_PROJECT_LIMIT);
    expect(readSidebarView("project-0", "scroll.mcp")).toBe(999);
    expect(readSidebarView("project-1", "scroll.mcp")).toBeUndefined();
    expect(readSidebarView("newcomer", "scroll.mcp")).toBe(1);
  });
});
