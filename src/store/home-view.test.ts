import { beforeEach, describe, expect, it } from "vitest";
import { useHomeViewStore } from "./home-view";

beforeEach(() => {
  useHomeViewStore.setState({ page: "library", deadlinesOpen: false, toolsOpen: false });
});

describe("useHomeViewStore", () => {
  it("goTo switches the active page", () => {
    useHomeViewStore.getState().goTo("bibtex");
    expect(useHomeViewStore.getState().page).toBe("bibtex");
  });

  it("openDeadlines opens deadlines and closes tools", () => {
    useHomeViewStore.setState({ toolsOpen: true });
    useHomeViewStore.getState().openDeadlines();
    expect(useHomeViewStore.getState().deadlinesOpen).toBe(true);
    expect(useHomeViewStore.getState().toolsOpen).toBe(false);
  });

  it("openTools opens tools and closes deadlines", () => {
    useHomeViewStore.setState({ deadlinesOpen: true });
    useHomeViewStore.getState().openTools();
    expect(useHomeViewStore.getState().toolsOpen).toBe(true);
    expect(useHomeViewStore.getState().deadlinesOpen).toBe(false);
  });

  it("closeDeadlines/closeTools clear only their own flag", () => {
    useHomeViewStore.setState({ deadlinesOpen: true, toolsOpen: true });
    useHomeViewStore.getState().closeDeadlines();
    expect(useHomeViewStore.getState().deadlinesOpen).toBe(false);
    expect(useHomeViewStore.getState().toolsOpen).toBe(true);
  });
});
