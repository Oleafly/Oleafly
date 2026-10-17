// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ICON_BUTTON_WIDTH, type ToolbarControl, useFittedCount } from "./toolbar-overflow";

const originals = {
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
  scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth"),
};
const geometry = { available: 400, perChild: ICON_BUTTON_WIDTH };

class FakeResizeObserver {
  static callbacks: (() => void)[] = [];
  constructor(private readonly callback: () => void) {}
  observe() {
    FakeResizeObserver.callbacks.push(this.callback);
  }
  unobserve() {}
  disconnect() {
    FakeResizeObserver.callbacks = FakeResizeObserver.callbacks.filter((entry) => entry !== this.callback);
  }
}

function resizeTo(width: number) {
  geometry.available = width;
  act(() => {
    for (const callback of FakeResizeObserver.callbacks) callback();
  });
}

beforeEach(() => {
  FakeResizeObserver.callbacks = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.testid === "bar" ? geometry.available : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.testid === "bar" ? this.children.length * geometry.perChild : 0;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  geometry.perChild = ICON_BUTTON_WIDTH;
  for (const [name, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
  }
});

const CONTROLS: ToolbarControl[] = Array.from({ length: 6 }, (_, index) => ({
  id: `c${index}`,
  width: ICON_BUTTON_WIDTH,
  render: () => null,
  renderMenu: () => null,
}));

let renders = 0;
function Bar() {
  renders += 1;
  const { containerRef, visibleCount } = useFittedCount(CONTROLS);
  return (
    <div ref={containerRef} data-testid="bar">
      {CONTROLS.slice(0, visibleCount).map((control) => (
        <span key={control.id} data-testid="shown" />
      ))}
    </div>
  );
}

describe("useFittedCount while its container is resized", () => {
  it("does not re-render while the same controls still fit", () => {
    render(<Bar />);
    expect(screen.getAllByTestId("shown")).toHaveLength(6);
    renders = 0;
    for (const width of [390, 380, 370, 360, 350, 300, 260, 220]) resizeTo(width);
    expect(renders).toBe(0);
    expect(screen.getAllByTestId("shown")).toHaveLength(6);
  });

  it("re-renders as soon as a control no longer fits", () => {
    render(<Bar />);
    renders = 0;
    resizeTo(120);
    expect(renders).toBeGreaterThan(0);
    expect(screen.getAllByTestId("shown").length).toBeLessThan(6);
    resizeTo(400);
    expect(screen.getAllByTestId("shown")).toHaveLength(6);
  });

  it("re-measures when the rendered controls overflow inside the same estimate", () => {
    render(<Bar />);
    expect(screen.getAllByTestId("shown")).toHaveLength(6);
    geometry.perChild = 60;
    resizeTo(330);
    expect(screen.getAllByTestId("shown").length).toBeLessThan(6);
  });
});
