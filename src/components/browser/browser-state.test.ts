import { describe, expect, it } from "vitest";
import {
  activeTab,
  EMPTY_BROWSER_STATE,
  reduceBrowser,
  type BrowserChromeState,
} from "./browser-state";

function opened(state: BrowserChromeState, label: string, url = `https://${label}.test/`) {
  return reduceBrowser(state, { type: "tab-opened", label, url, active: true });
}

describe("reduceBrowser", () => {
  it("adds and activates opened tabs and ignores duplicates", () => {
    let state = opened(EMPTY_BROWSER_STATE, "a");
    state = opened(state, "b");
    expect(state.tabs.map((t) => t.label)).toEqual(["a", "b"]);
    expect(state.active).toBe("b");
    const again = reduceBrowser(state, {
      type: "tab-opened",
      label: "a",
      url: "https://a.test/",
      active: true,
    });
    expect(again.tabs).toHaveLength(2);
    expect(again.active).toBe("a");
  });

  it("keeps the current tab when a background tab opens", () => {
    let state = opened(EMPTY_BROWSER_STATE, "a");
    state = reduceBrowser(state, {
      type: "tab-opened",
      label: "b",
      url: "https://b.test/",
      active: false,
    });
    expect(state.active).toBe("a");
  });

  it("switches to the requested tab when the active one closes", () => {
    let state = opened(opened(opened(EMPTY_BROWSER_STATE, "a"), "b"), "c");
    state = reduceBrowser(state, { type: "tab-activated", label: "b" });
    state = reduceBrowser(state, { type: "tab-closed", label: "b", active: "c" });
    expect(state.tabs.map((t) => t.label)).toEqual(["a", "c"]);
    expect(state.active).toBe("c");
  });

  it("falls back to a remaining tab when the close payload names none", () => {
    let state = opened(opened(EMPTY_BROWSER_STATE, "a"), "b");
    state = reduceBrowser(state, { type: "tab-closed", label: "b", active: null });
    expect(state.active).toBe("a");
    state = reduceBrowser(state, { type: "tab-closed", label: "a", active: null });
    expect(state).toEqual({ tabs: [], active: null });
  });

  it("ignores activation and patches for unknown tabs", () => {
    const state = opened(EMPTY_BROWSER_STATE, "a");
    expect(reduceBrowser(state, { type: "tab-activated", label: "zzz" })).toBe(state);
    expect(reduceBrowser(state, { type: "title", label: "zzz", title: "x" })).toBe(state);
    expect(
      reduceBrowser(state, { type: "tab-closed", label: "zzz", active: null }),
    ).toBe(state);
  });

  it("tracks loading, url, and title from page events", () => {
    let state = opened(EMPTY_BROWSER_STATE, "a");
    expect(activeTab(state)?.loading).toBe(true);
    state = reduceBrowser(state, {
      type: "page-load",
      label: "a",
      state: "finished",
      url: "https://a.test/landed",
    });
    expect(activeTab(state)).toMatchObject({ loading: false, url: "https://a.test/landed" });
    state = reduceBrowser(state, { type: "title", label: "a", title: "Landed" });
    expect(activeTab(state)?.title).toBe("Landed");
    state = reduceBrowser(state, { type: "navigating", label: "a", url: "https://a.test/next" });
    expect(activeTab(state)).toMatchObject({ loading: true, url: "https://a.test/next", title: "" });
  });

  it("merges a snapshot without dropping tabs that arrived by event", () => {
    const state = opened(EMPTY_BROWSER_STATE, "late");
    const merged = reduceBrowser(state, {
      type: "snapshot",
      tabs: [{ label: "first", url: "https://first.test/", title: "First", loading: false }],
      active: "first",
    });
    expect(merged.tabs.map((t) => t.label)).toEqual(["first", "late"]);
    expect(merged.active).toBe("first");
  });

  it("picks a sensible active tab when the snapshot names none", () => {
    const merged = reduceBrowser(EMPTY_BROWSER_STATE, {
      type: "snapshot",
      tabs: [{ label: "only", url: "https://only.test/", title: "", loading: true }],
      active: null,
    });
    expect(merged.active).toBe("only");
  });

  it("keeps the locally active tab when the snapshot names none", () => {
    const state = opened(EMPTY_BROWSER_STATE, "late");
    const merged = reduceBrowser(state, {
      type: "snapshot",
      tabs: [{ label: "first", url: "https://first.test/", title: "First", loading: false }],
      active: null,
    });
    expect(merged.tabs.map((t) => t.label)).toEqual(["first", "late"]);
    expect(merged.active).toBe("late");
  });

  it("keeps the locally active tab when the snapshot names one it did not send", () => {
    const state = opened(EMPTY_BROWSER_STATE, "late");
    const merged = reduceBrowser(state, {
      type: "snapshot",
      tabs: [{ label: "first", url: "https://first.test/", title: "First", loading: false }],
      active: "gone",
    });
    expect(merged.active).toBe("late");
  });

  it("keeps the active tab when a background tab closes", () => {
    let state = opened(opened(opened(EMPTY_BROWSER_STATE, "a"), "b"), "c");
    state = reduceBrowser(state, { type: "tab-activated", label: "a" });
    state = reduceBrowser(state, { type: "tab-closed", label: "b", active: null });
    expect(state.tabs.map((t) => t.label)).toEqual(["a", "c"]);
    expect(state.active).toBe("a");
  });

  it("keeps the active tab when the close payload names the tab that just went away", () => {
    let state = opened(opened(EMPTY_BROWSER_STATE, "a"), "b");
    state = reduceBrowser(state, { type: "tab-activated", label: "a" });
    state = reduceBrowser(state, { type: "tab-closed", label: "b", active: "b" });
    expect(state.active).toBe("a");
  });

  it("returns the state unchanged for an action it does not handle", () => {
    const state = opened(EMPTY_BROWSER_STATE, "a");
    const unknown = { type: "not-a-browser-action" } as unknown as Parameters<
      typeof reduceBrowser
    >[1];
    expect(reduceBrowser(state, unknown)).toBe(state);
  });

  it("resolves the active tab only while one is selected", () => {
    const state = opened(EMPTY_BROWSER_STATE, "a");
    expect(activeTab(state)?.label).toBe("a");
    expect(activeTab({ tabs: state.tabs, active: null })).toBeNull();
    expect(activeTab({ tabs: state.tabs, active: "missing" })).toBeNull();
  });
});
