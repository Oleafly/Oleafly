import { afterEach, describe, expect, it } from "vitest";
import { useHomeViewStore } from "@/store/home-view";
import { projectCovered } from "./project-covered";

afterEach(() => {
  useHomeViewStore.setState({ page: "library" });
});

describe("pages that cover an open project", () => {

  it("reads the page that is open now", () => {
    expect(projectCovered()).toBe(false);
    useHomeViewStore.setState({ page: "notes" });
    expect(projectCovered()).toBe(true);
  });
});
