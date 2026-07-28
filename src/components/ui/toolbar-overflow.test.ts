import { describe, expect, it } from "vitest";
import {
  CONTROL_GAP,
  ICON_BUTTON_WIDTH,
  MORE_BUTTON_WIDTH,
  fitCount,
  type ToolbarControl,
} from "./toolbar-overflow";

function icons(count: number): ToolbarControl[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `control-${index}`,
    width: ICON_BUTTON_WIDTH,
    render: () => null,
    renderMenu: () => null,
  }));
}

function widthFor(count: number): number {
  return count * ICON_BUTTON_WIDTH + Math.max(0, count - 1) * CONTROL_GAP;
}

describe("fitCount", () => {
  it("keeps every control when they all fit", () => {
    expect(fitCount(icons(4), widthFor(4))).toBe(4);
    expect(fitCount(icons(4), Number.POSITIVE_INFINITY)).toBe(4);
  });

  it("reserves room for the more button once anything overflows", () => {
    const exactlyThree = widthFor(3);
    // Three of the four controls would fit, but the fourth needs a more button
    // and that button has to fit too.
    const fitted = fitCount(icons(4), exactlyThree);
    expect(fitted).toBeLessThan(3);
    expect(
      widthFor(fitted) + CONTROL_GAP + MORE_BUTTON_WIDTH,
    ).toBeLessThanOrEqual(exactlyThree);
  });

  it("collapses everything when there is no room at all", () => {
    expect(fitCount(icons(4), 0)).toBe(0);
    // A zero width is what a not-yet-measured container reports.
    expect(fitCount(icons(4), ICON_BUTTON_WIDTH - 1)).toBe(0);
  });

  it("always leaves room for the more button it renders", () => {
    for (let width = MORE_BUTTON_WIDTH; width < 400; width += 7) {
      const fitted = fitCount(icons(8), width);
      if (fitted === 8) continue;
      const used =
        widthFor(fitted) + (fitted > 0 ? CONTROL_GAP : 0) + MORE_BUTTON_WIDTH;
      expect(used).toBeLessThanOrEqual(width);
    }
  });

  it("measures a mixed bar by its declared widths", () => {
    const controls: ToolbarControl[] = [
      { id: "wide", width: 140, render: () => null, renderMenu: () => null },
      ...icons(2),
    ];
    expect(fitCount(controls, 139)).toBe(0);
    expect(fitCount(controls, 140 + CONTROL_GAP + MORE_BUTTON_WIDTH)).toBe(1);
  });
});
