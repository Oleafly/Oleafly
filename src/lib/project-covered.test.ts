import { afterEach, describe, expect, it } from "vitest";
import { type HomePage, useHomeViewStore } from "@/store/home-view";
import { coversProject, projectCovered } from "./project-covered";

afterEach(() => {
  useHomeViewStore.setState({ page: "library" });
});

describe("pages that cover an open project", () => {
  it("counts the full-window pages drawn over the project and nothing else", () => {
    const covering: HomePage[] = ["notes", "diagram-composer", "generators", "symbols"];
    const others: HomePage[] = ["library", "tools", "converter", "reference", "equation", "deadlines", "stats"];
    for (const page of covering) expect(coversProject(page)).toBe(true);
    for (const page of others) expect(coversProject(page)).toBe(false);
  });

  it("reads the page that is open now", () => {
    expect(projectCovered()).toBe(false);
    useHomeViewStore.setState({ page: "notes" });
    expect(projectCovered()).toBe(true);
  });
});
