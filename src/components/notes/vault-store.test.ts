import { afterEach, describe, expect, it } from "vitest";
import { filterByTag, setQuickSwitcherOpen, useVaultStore } from "./vault-store";

afterEach(() => {
  useVaultStore.setState({ tag: null, tagRequest: 0, switcherOpen: false });
});

describe("vault store", () => {
  it("normalises the tag filter and counts each request to show it", () => {
    filterByTag("  ##ML/Vision ");
    expect(useVaultStore.getState()).toMatchObject({ tag: "ml/vision", tagRequest: 1 });
    filterByTag("ml/vision");
    expect(useVaultStore.getState().tagRequest).toBe(2);
    filterByTag(null);
    expect(useVaultStore.getState()).toMatchObject({ tag: null, tagRequest: 2 });
    filterByTag(" # ");
    expect(useVaultStore.getState().tag).toBeNull();
  });

  it("opens and closes the quick switcher", () => {
    setQuickSwitcherOpen(true);
    expect(useVaultStore.getState().switcherOpen).toBe(true);
    setQuickSwitcherOpen(false);
    expect(useVaultStore.getState().switcherOpen).toBe(false);
  });
});
