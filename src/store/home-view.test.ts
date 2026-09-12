import { beforeEach, describe, expect, it } from "vitest";
import { useHomeViewStore } from "./home-view";

beforeEach(() => {
  useHomeViewStore.setState({ page: "library", activeConverter: null });
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

  it("opens a converter as a full home page", () => {
    useHomeViewStore.getState().openConverter("latex-to-typst");
    expect(useHomeViewStore.getState()).toMatchObject({
      page: "converter",
      activeConverter: "latex-to-typst",
    });
  });
});
