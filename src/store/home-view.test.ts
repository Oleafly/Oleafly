import { beforeEach, describe, expect, it } from "vitest";
import { useHomeViewStore } from "./home-view";

beforeEach(() => {
  useHomeViewStore.setState({ page: "library", activeConverter: null, activeReferenceTool: null });
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

  it("opens a reference tool as a full home page", () => {
    useHomeViewStore.getState().openReferenceTool("doi-to-bibtex");
    expect(useHomeViewStore.getState()).toMatchObject({
      page: "reference",
      activeReferenceTool: "doi-to-bibtex",
    });
  });

  it("queues a page to show after the project closes and hands it out once", () => {
    const store = useHomeViewStore.getState();

    store.queuePageAfterProjectClose("deadlines");
    expect(useHomeViewStore.getState().consumeQueuedPageAfterProjectClose()).toBe("deadlines");
    expect(useHomeViewStore.getState().consumeQueuedPageAfterProjectClose()).toBeNull();

    store.queuePageAfterProjectClose("tools");
    store.clearQueuedPageAfterProjectClose();
    expect(useHomeViewStore.getState().queuedPageAfterProjectClose).toBeNull();
  });
});

