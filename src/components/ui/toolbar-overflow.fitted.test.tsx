// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ICON_BUTTON_WIDTH, type ToolbarControl, useFittedCount } from "./toolbar-overflow";

const RENDERED_WIDTH = 60;
const originals = {
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
  scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth"),
};

function layout(available: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.testid === "bar" ? available : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.testid === "bar" ? this.children.length * RENDERED_WIDTH : 0;
    },
  });
}

afterEach(() => {
  for (const [name, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
  }
});

function controls(count: number): ToolbarControl[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    width: ICON_BUTTON_WIDTH,
    render: () => null,
    renderMenu: () => null,
  }));
}

function Bar({ items }: Readonly<{ items: readonly ToolbarControl[] }>) {
  const { containerRef, visibleCount } = useFittedCount(items);
  return (
    <div ref={containerRef} data-testid="bar">
      {items.slice(0, visibleCount).map((control) => (
        <span key={control.id} data-testid="shown" />
      ))}
    </div>
  );
}

describe("useFittedCount", () => {
  it("moves controls out until the rendered ones really fit", () => {
    layout(130);
    render(<Bar items={controls(6)} />);
    expect(screen.getAllByTestId("shown")).toHaveLength(2);
  });

  it("keeps the estimate when the controls are as wide as declared", () => {
    layout(4000);
    render(<Bar items={controls(6)} />);
    expect(screen.getAllByTestId("shown")).toHaveLength(6);
  });

  it("starts from the estimate again when the controls change", () => {
    layout(130);
    const { rerender } = render(<Bar items={controls(6)} />);
    expect(screen.getAllByTestId("shown")).toHaveLength(2);
    rerender(<Bar items={controls(1)} />);
    expect(screen.getAllByTestId("shown")).toHaveLength(1);
  });
});
