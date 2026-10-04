// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { GroupImperativeHandle, Layout, PanelImperativeHandle } from "react-resizable-panels";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collapsePanel,
  expandPanel,
  hasStoredPanelLayout,
  keyboardResizeLayout,
  migrateLegacyPanelLayout,
  panelExpandSizesKey,
  panelLayoutKey,
  reevaluateLayout,
  useDismissiblePanelLayout,
  usePersistentPanelLayout,
  useSeparatorHitArea,
  useSeparatorKeyboard,
} from "./panel-layout";
import { useSettingsStore } from "@/store/settings";

function fakePanel(size: number, collapsed = false): PanelImperativeHandle {
  return {
    collapse: vi.fn(),
    expand: vi.fn(),
    getSize: () => ({ asPercentage: size, inPixels: size * 10 }),
    isCollapsed: () => collapsed,
    resize: vi.fn(),
  } as unknown as PanelImperativeHandle;
}

function fakeGroup(layout: Layout) {
  let current = { ...layout };
  const group = {
    getLayout: () => current,
    setLayout: vi.fn((next: Layout) => {
      current = next;
      return next;
    }),
  };
  return { group, ref: { current: group as unknown as GroupImperativeHandle } };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("storage that refuses access", () => {
  it("reports no stored layout when storage cannot be listed", () => {
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new Error("denied");
    });
    localStorage.setItem(panelLayoutKey("g", ["a", "b"]), JSON.stringify({ a: 50, b: 50 }));
    expect(hasStoredPanelLayout("g")).toBe(false);
  });

  it("still collapses and reopens panels when sizes cannot be saved or read", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const open = fakePanel(40);
    collapsePanel("g", "terminal", open);
    expect(open.collapse).toHaveBeenCalledOnce();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const closed = fakePanel(0, true);
    expandPanel("g", "terminal", closed, 25);
    expect(closed.resize).toHaveBeenCalledWith("25%");
  });

  it("migrates a legacy layout even when the old key cannot be removed", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    localStorage.setItem("react-resizable-panels:legacy-remove", JSON.stringify({ "a,b": { layout: [30, 70] } }));
    migrateLegacyPanelLayout("legacy-remove", ["a", "b"]);
    expect(JSON.parse(localStorage.getItem(panelLayoutKey("legacy-remove", ["a", "b"])) ?? "null")).toEqual({ a: 30, b: 70 });
  });
});

describe("expand sizes", () => {
  it.each([
    ["unreadable JSON", "{oops"],
    ["a non-object value", "null"],
    ["a non-finite size", JSON.stringify({ terminal: "big" })],
  ])("falls back to the minimum for %s", (_label, stored) => {
    localStorage.setItem(panelExpandSizesKey("g"), stored);
    const panel = fakePanel(0, true);
    expandPanel("g", "terminal", panel, 20);
    expect(panel.resize).toHaveBeenCalledWith("20%");
  });

  it("does nothing without a panel", () => {
    collapsePanel("g", "terminal", null);
    expandPanel("g", "terminal", null, 20);
    expect(localStorage.getItem(panelExpandSizesKey("g"))).toBeNull();
  });
});

describe("legacy migration of malformed entries", () => {
  it.each([
    ["unreadable JSON", "{oops"],
    ["a non-object value", "42"],
    ["an entry without a layout", JSON.stringify({ "a,b": { sizes: [50, 50] } })],
  ])("leaves %s in place", (_label, stored) => {
    const group = `legacy-${_label.replaceAll(" ", "-")}`;
    localStorage.setItem(`react-resizable-panels:${group}`, stored);
    migrateLegacyPanelLayout(group, ["a", "b"]);
    expect(localStorage.getItem(`react-resizable-panels:${group}`)).toBe(stored);
  });

  it("skips entries that do not match the panels and keeps only usable expand sizes", () => {
    localStorage.setItem(
      "react-resizable-panels:legacy-mixed",
      JSON.stringify({
        "a,b": { layout: [40, 60], expandToSizes: { a: 35, ghost: 10, b: "wide" } },
        "a,c": { layout: [50, 50] },
        "a,b,c": { layout: [30, 70] },
        b: { layout: [Number.NaN] },
      }),
    );
    migrateLegacyPanelLayout("legacy-mixed", ["a", "b", "c"]);
    expect(JSON.parse(localStorage.getItem(panelLayoutKey("legacy-mixed", ["a", "b"])) ?? "null")).toEqual({ a: 40, b: 60 });
    expect(JSON.parse(localStorage.getItem(panelLayoutKey("legacy-mixed", ["a", "c"])) ?? "null")).toEqual({ a: 50, c: 50 });
    expect(localStorage.getItem(panelLayoutKey("legacy-mixed", ["a", "b", "c"]))).toBeNull();
    expect(localStorage.getItem(panelLayoutKey("legacy-mixed", ["b"]))).toBeNull();
    expect(JSON.parse(localStorage.getItem(panelExpandSizesKey("legacy-mixed")) ?? "null")).toEqual({ a: 35 });
    expect(localStorage.getItem("react-resizable-panels:legacy-mixed")).toBeNull();
  });
});

describe("persistent layout hook", () => {
  it("never restores a layout for a group without an id", () => {
    const { result } = renderHook(() => usePersistentPanelLayout(undefined, ["a", "b"], ["a", "b"]));
    expect(result.current.defaultLayout).toBeUndefined();
  });

  it.each([
    ["an array", JSON.stringify([50, 50])],
    ["a non-finite size", JSON.stringify({ a: "half", b: 50 })],
  ])("ignores a saved layout that is %s", (_label, stored) => {
    localStorage.setItem(panelLayoutKey("saved", ["a", "b"]), stored);
    const { result } = renderHook(() => usePersistentPanelLayout("saved", ["a", "b"], ["a", "b"]));
    expect(result.current.defaultLayout).toBeUndefined();
  });
});

describe("separator hit area", () => {
  afterEach(() => {
    useSettingsStore.setState({ appFontSize: 16 });
  });

  it("scales with the interface font size and falls back to the base size", () => {
    useSettingsStore.setState({ appFontSize: 20 });
    expect(renderHook(() => useSeparatorHitArea(0.5)).result.current).toEqual({ coarse: 40, fine: 20 });
    useSettingsStore.setState({ appFontSize: 0 });
    expect(renderHook(() => useSeparatorHitArea(0.5)).result.current).toEqual({ coarse: 38, fine: 18 });
  });
});

describe("layout arithmetic", () => {
  it("spills growth past a panel's maximum into the next panel", () => {
    expect(keyboardResizeLayout([20, 60, 20], [{}, { maxSize: 65 }, {}], [0, 1], -10)).toEqual([10, 65, 25]);
    expect(keyboardResizeLayout([20, 60, 20], [{}, { maxSize: 65 }, {}], [1, 2], 10)).toEqual([25, 65, 10]);
  });

  it("shrinks a panel that is now larger than its maximum", () => {
    expect(reevaluateLayout({ a: 70, b: 30 }, {}, { a: { maxSize: 50 } })).toEqual({ a: 50, b: 50 });
  });
});

describe("dismissible panel reopening", () => {
  it("reopens a panel that reappears collapsed at its default size", async () => {
    const { group, ref } = fakeGroup({ editor: 100, assistant: 0 });
    const onDismiss = vi.fn();
    const limits = { assistant: { minSize: 20, collapsible: true, collapsedSize: 0 } };
    const { result } = renderHook(() =>
      useDismissiblePanelLayout(ref, undefined, ["editor", "assistant"], ["editor", "assistant"], limits, {
        id: "assistant",
        defaultSize: 30,
        onDismiss,
      }),
    );
    result.current.onLayoutChange({ editor: 100, assistant: 0 });
    await Promise.resolve();
    expect(group.setLayout).toHaveBeenCalledWith({ editor: 70, assistant: 30 });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does not reopen once the group has moved on before the reopen runs", async () => {
    const { group, ref } = fakeGroup({ editor: 60, assistant: 40 });
    const limits = { assistant: { minSize: 20, collapsible: true, collapsedSize: 0 } };
    const { result } = renderHook(() =>
      useDismissiblePanelLayout(ref, undefined, ["editor", "assistant"], ["editor", "assistant"], limits, {
        id: "assistant",
        defaultSize: 30,
        onDismiss: vi.fn(),
      }),
    );
    result.current.onLayoutChange({ editor: 100, assistant: 0 });
    await Promise.resolve();
    expect(group.setLayout).not.toHaveBeenCalled();
  });
});

describe("separator keyboard guards", () => {
  function separatorBetween(before: string, after: string, attributes: Record<string, string> = {}) {
    const host = document.createElement("div");
    const left = document.createElement("div");
    left.id = before;
    left.dataset.panel = "";
    const decoration = document.createElement("span");
    const separator = document.createElement("div");
    for (const [name, value] of Object.entries(attributes)) separator.setAttribute(name, value);
    const right = document.createElement("div");
    right.id = after;
    right.dataset.panel = "";
    host.append(left, decoration, separator, right);
    return separator;
  }

  function keyEvent(separator: HTMLElement, key: string, defaultPrevented = false) {
    return {
      key,
      shiftKey: false,
      defaultPrevented,
      currentTarget: separator,
      preventDefault: vi.fn(),
    } as unknown as ReactKeyboardEvent<HTMLElement>;
  }

  it("ignores handled, disabled, unrelated and unattached separators", () => {
    const { group, ref } = fakeGroup({ a: 50, b: 50 });
    const { result } = renderHook(() => useSeparatorKeyboard(ref, {}));
    const handle = result.current;
    const separator = separatorBetween("a", "b");
    handle(keyEvent(separator, "ArrowRight", true));
    handle(keyEvent(separatorBetween("a", "b", { "aria-disabled": "true" }), "ArrowRight"));
    handle(keyEvent(separator, "Tab"));
    handle(keyEvent(separatorBetween("x", "y"), "ArrowRight"));
    handle(keyEvent(separatorBetween("b", "a"), "ArrowRight"));
    expect(group.setLayout).not.toHaveBeenCalled();

    const detached = renderHook(() => useSeparatorKeyboard({ current: null }, {})).result.current;
    const event = keyEvent(separator, "ArrowRight");
    detached(event);
    expect(event.preventDefault).not.toHaveBeenCalled();

    handle(keyEvent(separator, "ArrowRight"));
    expect(group.setLayout).toHaveBeenCalledWith({ a: 60, b: 40 });
  });
});
