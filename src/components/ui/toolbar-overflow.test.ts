// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { createElement, Fragment } from "react";
import { describe, expect, it } from "vitest";
import { Type } from "lucide-react";
import {
  CONTROL_GAP,
  DIVIDER_WIDTH,
  DROPDOWN_TRIGGER_WIDTH,
  ICON_BUTTON_WIDTH,
  MORE_BUTTON_WIDTH,
  ToolbarDropdown,
  fitCount,
  fitTools,
  fitToolbar,
  fitWidth,
  type ToolbarControl,
  type ToolbarFit,
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

  it("keeps the folded group and the controls after it until the unfolded row fits, rather than trading them for the unfolded group", () => {
    expect(fitToolbar(items, all - 1)).toEqual({ visible: 5, collapsed: true });
    expect(fitToolbar(items, 60 + 100 + 190 + 40 + 3 * CONTROL_GAP + more)).toEqual({ visible: 5, collapsed: true });
    expect(fitToolbar(items, 60 + 100 + 190 + 2 * CONTROL_GAP + more)).toEqual({ visible: 5, collapsed: true });
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

function shownTools(items: readonly ToolbarFitItem[], fit: ToolbarFit): string[] {
  const shown: string[] = [];
  for (let index = 0; index < fit.visible; index++) {
    const item = items[index];
    const folded = fit.collapsed && item.collapsed !== undefined;
    const tools = folded ? 1 : (item.tools ?? 1);
    for (let tool = 0; tool < tools; tool++) shown.push(`${index}:${tool}`);
  }
  return shown;
}

function edges(items: readonly ToolbarFitItem[]): number[] {
  const widths = new Set([0]);
  for (let visible = 0; visible <= items.length; visible++) {
    for (const collapsed of [false, true]) widths.add(fitWidth(items, { visible, collapsed }));
  }
  return [...widths].sort((left, right) => left - right);
}

function bandsOf(items: readonly ToolbarFitItem[]): { from: number; fit: ToolbarFit }[] {
  const bands: { from: number; fit: ToolbarFit }[] = [];
  for (const width of edges(items)) {
    const fit = fitToolbar(items, width);
    const last = bands.at(-1)?.fit;
    if (!last || last.visible !== fit.visible || last.collapsed !== fit.collapsed) bands.push({ from: width, fit });
  }
  return bands;
}

function nestingBreaks(items: readonly ToolbarFitItem[]): string[] {
  const bands = bandsOf(items);
  const breaks: string[] = [];
  for (let narrow = 0; narrow < bands.length; narrow++) {
    for (let wide = narrow + 1; wide < bands.length; wide++) {
      const kept = new Set(shownTools(items, bands[wide].fit));
      const lost = shownTools(items, bands[narrow].fit).filter((tool) => !kept.has(tool));
      if (lost.length > 0) breaks.push(`${bands[narrow].from}px -> ${bands[wide].from}px loses ${lost.join(" ")}`);
    }
  }
  return breaks;
}

function divided(icons: number, extra = 0): ToolbarFitItem {
  const parts = 1 + icons + (extra > 0 ? 1 : 0);
  return { width: DIVIDER_WIDTH + icons * ICON_BUTTON_WIDTH + extra + (parts - 1) * CONTROL_GAP, tools: icons + (extra > 0 ? 1 : 0) };
}

const MARKDOWN_ROW: ToolbarFitItem[] = [
  { width: 4 * ICON_BUTTON_WIDTH + 3 * CONTROL_GAP, tools: 4 },
  divided(2),
  divided(2),
  { ...divided(6), collapsed: { width: DIVIDER_WIDTH + CONTROL_GAP + DROPDOWN_TRIGGER_WIDTH } },
  divided(1),
  divided(4),
  divided(1),
  divided(1, DROPDOWN_TRIGGER_WIDTH),
  divided(4),
  divided(3),
];

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe("fitToolbar as the row widens", () => {
  it("shows at every wider width each tool a narrower width shows, for the Markdown row", () => {
    expect(fitWidth(MARKDOWN_ROW, { visible: MARKDOWN_ROW.length, collapsed: false })).toBe(981);
    expect(nestingBreaks(MARKDOWN_ROW)).toEqual([]);
  });

  it("keeps folded headings followed by Quote, then unfolds them only together with Quote", () => {
    const bands = bandsOf(MARKDOWN_ROW).map(({ from, fit }) => `${from}:${fit.visible}${fit.collapsed ? "F" : ""}`);
    expect(bands).toEqual(["0:0", "148:1", "219:2", "290:3", "345:4F", "386:5F", "522:5", "653:6", "694:7", "779:8", "910:9", "981:10"]);
  });

  it("only ever adds tools as any row widens, and never draws more than fits", () => {
    const random = seeded(58);
    for (let row = 0; row < 400; row++) {
      const count = 1 + Math.floor(random() * 10);
      const items: ToolbarFitItem[] = Array.from({ length: count }, () => {
        const width = 9 + Math.floor(random() * 190);
        const tools = 1 + Math.floor(random() * 6);
        const folds = random() < 0.25 && width > 40;
        return folds ? { width, tools, collapsed: { width: 9 + Math.floor(random() * (width - 20)) } } : { width, tools };
      });
      expect(nestingBreaks(items), JSON.stringify(items)).toEqual([]);
      for (const edge of edges(items)) {
        for (const width of [edge - 1, edge]) {
          const fit = fitToolbar(items, width);
          expect(fitWidth(items, fit) <= width || fit.visible === 0, JSON.stringify(items)).toBe(true);
        }
      }
    }
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
