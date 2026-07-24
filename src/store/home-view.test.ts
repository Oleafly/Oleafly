import { beforeEach, describe, expect, it } from "vitest";
import { useHomeViewStore } from "./home-view";

beforeEach(() => {
  useHomeViewStore.setState({ page: "library", toolsOpen: false });
});

describe("useHomeViewStore", () => {
  it("goTo switches the active page", () => {
    useHomeViewStore.getState().goTo("bibtex");
    expect(useHomeViewStore.getState().page).toBe("bibtex");
  });

  it("goTo switches to the deadlines page", () => {
    useHomeViewStore.getState().goTo("deadlines");
    expect(useHomeViewStore.getState().page).toBe("deadlines");
  });

  it("openTools/closeTools toggle the tools modal", () => {
    useHomeViewStore.getState().openTools();
    expect(useHomeViewStore.getState().toolsOpen).toBe(true);
    useHomeViewStore.getState().closeTools();
    expect(useHomeViewStore.getState().toolsOpen).toBe(false);
  });
});
