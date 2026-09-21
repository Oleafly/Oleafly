// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToolbarLayout } from "./use-toolbar-layout";

const observers = new Set<TestResizeObserver>();
class TestResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn(() => observers.delete(this));
  constructor(readonly callback: () => void) {
    observers.add(this);
  }
}

let header: HTMLElement;
let dimensions: { width: number; zoom: number };
let currentLayout: ReturnType<typeof useToolbarLayout> | undefined;

beforeEach(() => {
  observers.clear();
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  document.documentElement.style.fontSize = "16px";
  dimensions = { width: 1400, zoom: 1 };
  currentLayout = undefined;
  header = document.createElement("header");
  header.style.columnGap = "8px";
  header.innerHTML = `
    <div data-toolbar-part="leading" style="padding-left: 12px">
      <div data-toolbar-part="home" data-width="120">
        <div data-toolbar-part="brand" style="column-gap: 8px">
          <span data-brand-label data-width="80">Oleafly</span>
        </div>
      </div>
      <span data-toolbar-part="breadcrumb" data-width="12"></span>
      <span data-toolbar-part="title-minimum" data-width="180"></span>
    </div>
    <div data-toolbar-part="views" data-width="100"></div>
    <div data-toolbar-part="trailing" style="padding-right: 12px">
      <div data-toolbar-part="actions">
        <div data-toolbar-item="compile" data-width="120" style="column-gap: 4px">
          <span data-toolbar-part="compile-label" data-width="84">Compile</span>
        </div>
        <div data-toolbar-item="workspace" data-width="56"></div>
        ${["settings", "theme", "browser", "fork", "layout", "history", "export"].map((name, index) =>
          `<div data-toolbar-item="${name}" data-toolbar-icon data-overflow-order="${index + 1}"></div>`).join("")}
        <div data-toolbar-item="menu" data-toolbar-icon></div>
      </div>
      <div data-toolbar-part="captions" data-width="90"></div>
    </div>`;
  document.body.append(header);
  Object.defineProperty(header, "offsetWidth", { get: () => dimensions.width });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    let width = Number(this.dataset.width ?? 0);
    if (this === header) width = dimensions.width;
    if (this.dataset.toolbarPart === "home" && currentLayout?.compactBrand) width = 32;
    if (this.dataset.toolbarItem === "compile" && currentLayout?.iconOnly) width = 32;
    return { width: width * dimensions.zoom } as DOMRect;
  });
});

afterEach(() => {
  header.remove();
  document.documentElement.style.fontSize = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountToolbar() {
  return renderHook(() => {
    currentLayout = useToolbarLayout({ current: header });
    return currentLayout;
  });
}

function resize(width: number, zoom = 1) {
  act(() => {
    dimensions = { width, zoom };
    for (const observer of [...observers]) observer.callback();
  });
}

describe("toolbar layout measurements", () => {
  it("keeps the full toolbar roomy when both sides of the view switch fit", () => {
    const { result, unmount } = mountToolbar();
    expect(result.current).toEqual({ overflow: 0, compactBrand: false, iconOnly: false, stacked: false, roomy: true });
    const observer = [...observers][0];
    expect(observer.observe).toHaveBeenCalledWith(header);
    expect(observer.observe).toHaveBeenCalledWith(header.querySelector('[data-toolbar-item="compile"]'));
    expect(observer.observe).toHaveBeenCalledWith(header.querySelector("[data-brand-label]"));
    unmount();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(observers.size).toBe(0);
  });

  it("moves optional actions into overflow before hiding the compile caption or adding a row", () => {
    const { result } = mountToolbar();
    resize(1100);
    expect(result.current).toMatchObject({ overflow: 2, iconOnly: false, stacked: false });
    resize(820);
    expect(result.current).toMatchObject({ overflow: 7, iconOnly: false, stacked: false });
    resize(750);
    expect(result.current).toMatchObject({ overflow: 7, compactBrand: true, iconOnly: true, stacked: false });
    resize(560);
    expect(result.current).toMatchObject({ overflow: 7, iconOnly: true, stacked: true, roomy: false });
    resize(1400);
    expect(result.current).toEqual({ overflow: 0, compactBrand: false, iconOnly: false, stacked: false, roomy: true });
  });

  it("uses tighter gaps before overflowing actions", () => {
    const { result } = mountToolbar();
    resize(1200);
    expect(result.current).toMatchObject({ overflow: 0, roomy: false });
  });

  it("accounts for CSS zoom in captions, gaps, and window chrome", () => {
    const { result } = mountToolbar();
    resize(700);
    const unzoomed = result.current;
    resize(700, 2);
    expect(result.current).toEqual(unzoomed);
    expect(result.current).toMatchObject({ compactBrand: true, iconOnly: true, stacked: false });
  });

  it("does not oscillate or publish a new layout when dimensions stay the same", () => {
    const { result } = mountToolbar();
    resize(750);
    const compact = result.current;
    resize(750);
    expect(result.current).toBe(compact);
    resize(1400);
    const expanded = result.current;
    resize(1400);
    expect(result.current).toBe(expanded);
  });

  it("remeasures when feature flags remove optional actions", () => {
    const { result, rerender } = mountToolbar();
    resize(1100);
    expect(result.current.overflow).toBe(2);
    header.querySelector('[data-toolbar-item="browser"]')?.remove();
    header.querySelector('[data-toolbar-item="fork"]')?.remove();
    rerender();
    expect(result.current.overflow).toBe(0);
  });

  it("handles layouts without native chrome, compile labels, or branding", () => {
    for (const part of ["leading", "captions", "compile-label"]) {
      header.querySelector(`[data-toolbar-part="${part}"]`)?.remove();
    }
    const actions = header.querySelector('[data-toolbar-part="actions"]');
    if (!actions) throw new Error("Missing test actions");
    header.append(actions);
    header.querySelector('[data-toolbar-part="trailing"]')?.remove();
    header.style.columnGap = "normal";
    const { result } = mountToolbar();
    resize(1000);
    expect(result.current).toMatchObject({ overflow: 0, compactBrand: false, iconOnly: false, stacked: false });
  });

  it("preserves the last layout while the toolbar is hidden or its actions are absent", () => {
    const { result, rerender } = mountToolbar();
    const visible = result.current;
    resize(0);
    expect(result.current).toBe(visible);
    header.querySelector('[data-toolbar-part="actions"]')?.remove();
    resize(600);
    rerender();
    expect(result.current).toBe(visible);
  });

  it("does not subscribe before a header is mounted", () => {
    renderHook(() => useToolbarLayout({ current: null }));
    expect(observers.size).toBe(0);
  });
});
