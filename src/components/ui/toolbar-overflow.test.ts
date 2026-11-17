// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { createElement, Fragment } from "react";
import { describe, expect, it } from "vitest";
import { Type } from "lucide-react";
import {
  CONTROL_GAP,
  DROPDOWN_TRIGGER_WIDTH,
  ICON_BUTTON_WIDTH,
  MORE_BUTTON_WIDTH,
  ToolbarDropdown,
  fitCount,
  fitTools,
  fitToolbar,
  fitWidth,
  type ToolbarControl,
  type ToolbarFitItem,
  useAvailableWidth,
} from "./toolbar-overflow";

function WidthHarness({ mounted, width }: { mounted: boolean; width: number }) {
  const { containerRef, availableWidth } = useAvailableWidth();

  return createElement(
    Fragment,
    null,
    createElement(
      "output",
      { "data-testid": "available-width" },
      availableWidth,
    ),
    mounted
      ? createElement("div", {
          ref: containerRef,
          "data-testid": "measured-toolbar",
          "data-width": width,
        })
      : null,
  );
}

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
    const fitted = fitCount(icons(4), exactlyThree);
    expect(fitted).toBeLessThan(3);
    expect(
      widthFor(fitted) + CONTROL_GAP + MORE_BUTTON_WIDTH,
    ).toBeLessThanOrEqual(exactlyThree);
  });

  it("collapses everything when there is no room at all", () => {
    expect(fitCount(icons(4), 0)).toBe(0);
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

describe("fitToolbar", () => {
  const items: ToolbarFitItem[] = [{ width: 60 }, { width: 100 }, { width: 190, tools: 6, collapsed: { width: 50 } }, { width: 40 }, { width: 70 }];
  const all = 60 + 100 + 190 + 40 + 70 + 4 * CONTROL_GAP;
  const more = CONTROL_GAP + MORE_BUTTON_WIDTH;

  it("shows everything, expanded, when the row has room", () => {
    expect(fitToolbar(items, all)).toEqual({ visible: 5, collapsed: false });
    expect(fitToolbar(items, Number.POSITIVE_INFINITY)).toEqual({ visible: 5, collapsed: false });
  });

  it("moves items out from the right while that still shows the most tools", () => {
    expect(fitToolbar(items, all - 1)).toEqual({ visible: 4, collapsed: false });
    expect(fitToolbar(items, 60 + 100 + 190 + 40 + 3 * CONTROL_GAP + more)).toEqual({ visible: 4, collapsed: false });
    expect(fitToolbar(items, 60 + 100 + 190 + 2 * CONTROL_GAP + more)).toEqual({ visible: 3, collapsed: false });
  });

  it("folds a group and keeps the controls after it when they fit beside the folded form", () => {
    const folded = 60 + 100 + 50 + 40 + 70 + 4 * CONTROL_GAP;
    expect(fitToolbar(items, 60 + 100 + 190 + 2 * CONTROL_GAP + more - 1)).toEqual({ visible: 5, collapsed: true });
    expect(fitToolbar(items, folded)).toEqual({ visible: 5, collapsed: true });
    expect(fitToolbar(items, folded - 1)).toEqual({ visible: 4, collapsed: true });
    expect(fitToolbar(items, 60 + 100 + 50 + 2 * CONTROL_GAP + more)).toEqual({ visible: 3, collapsed: true });
    expect(fitToolbar(items, 60 + 100 + 50 + 2 * CONTROL_GAP + more - 1)).toEqual({ visible: 2, collapsed: false });
  });

  it("never shows fewer tools at a wider width, and never more than fit", () => {
    let shown = 0;
    for (let width = 0; width <= all + 10; width++) {
      const fit = fitToolbar(items, width);
      expect(fitWidth(items, fit) <= width || fit.visible === 0).toBe(true);
      expect(fitTools(items, fit)).toBeGreaterThanOrEqual(shown);
      shown = fitTools(items, fit);
    }
  });

  it("leaves only More when nothing fits", () => {
    expect(fitToolbar(items, 0)).toEqual({ visible: 0, collapsed: false });
    expect(fitWidth(items, { visible: 0, collapsed: false })).toBe(MORE_BUTTON_WIDTH);
  });
});

describe("toolbar triggers", () => {
  it("draws the bar's dropdown trigger like the icon buttons beside it, and counts it at its drawn width", () => {
    render(createElement(ToolbarDropdown, { variant: "bar", icon: Type, label: "Heading", ariaLabel: "Heading level", items: [] }));
    const trigger = screen.getByRole("button", { name: "Heading level" });
    const classes = trigger.className.split(/\s+/u);
    for (const name of ["h-7", "rounded", "px-1.5", "gap-0.5", "text-muted-foreground"]) expect(classes).toContain(name);
    for (const name of ["h-8", "px-3", "text-foreground", "rounded-md"]) expect(classes).not.toContain(name);
    expect(MORE_BUTTON_WIDTH).toBe(ICON_BUTTON_WIDTH);
    expect(DROPDOWN_TRIGGER_WIDTH).toBe(6 + 16 + 2 + 12 + 6);
  });
});

describe("useAvailableWidth", () => {
  it("remeasures a toolbar that remounts after a conditional view change", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return Number(this.getAttribute("data-width") ?? 0);
      },
    });

    try {
      const view = render(
        createElement(WidthHarness, { mounted: true, width: 160 }),
      );
      expect(screen.getByTestId("available-width")).toHaveTextContent("160");

      view.rerender(
        createElement(WidthHarness, { mounted: false, width: 0 }),
      );
      view.rerender(
        createElement(WidthHarness, { mounted: true, width: 640 }),
      );

      expect(screen.getByTestId("available-width")).toHaveTextContent("640");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientWidth",
          originalDescriptor,
        );
      } else {
        delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      }
    }
  });
});
