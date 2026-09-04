import { describe, expect, it } from "vitest";
import { fitTourTooltip, type TourBox, type TourPlacementInput } from "./placement";

const TOOLTIP = { width: 384, height: 163, minHeight: 125 };

const STANDOFF = 32;

const SHIFT_PADDING = 10;

function geometry(
  viewport: { width: number; height: number },
  target: TourBox,
  tooltip = TOOLTIP,
): TourPlacementInput {
  return { target, viewport, tooltip, standoff: STANDOFF, shiftPadding: SHIFT_PADDING };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function tooltipRect(input: TourPlacementInput): TourBox {
  const fit = fitTourTooltip(input);
  const { target, viewport, tooltip } = input;
  const height = fit.maxHeight ?? tooltip.height;
  if (fit.placement === "center") {
    const top = (viewport.height - height) / 2;
    const left = (viewport.width - tooltip.width) / 2;
    return { top, bottom: top + height, left, right: left + tooltip.width };
  }
  if (fit.placement === "top" || fit.placement === "bottom") {
    const top =
      fit.placement === "top" ? target.top - STANDOFF - height : target.bottom + STANDOFF;
    const left = clamp(
      (target.left + target.right) / 2 - tooltip.width / 2,
      SHIFT_PADDING,
      Math.max(SHIFT_PADDING, viewport.width - tooltip.width - SHIFT_PADDING),
    );
    return { top, bottom: top + height, left, right: left + tooltip.width };
  }
  const left =
    fit.placement === "left" ? target.left - STANDOFF - tooltip.width : target.right + STANDOFF;
  const top = clamp(
    (target.top + target.bottom) / 2 - height / 2,
    SHIFT_PADDING,
    Math.max(SHIFT_PADDING, viewport.height - height - SHIFT_PADDING),
  );
  return { top, bottom: top + height, left, right: left + tooltip.width };
}

function overlaps(a: TourBox, b: TourBox) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function insideViewport(rect: TourBox, viewport: { width: number; height: number }) {
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= viewport.height &&
    rect.right <= viewport.width
  );
}

const TEMPLATE_LIST = [
  {
    label: "the smallest window the app can open",
    viewport: { width: 900, height: 600 },
    target: { top: 178.5, right: 883.5, bottom: 539.5, left: 192.5 },
    placement: "top",
    maxHeight: 146.5,
  },
  {
    label: "a laptop window",
    viewport: { width: 1280, height: 800 },
    target: { top: 198.5, right: 1087.5, bottom: 719.5, left: 368.5 },
    placement: "top",
    maxHeight: null,
  },
  {
    label: "a large window",
    viewport: { width: 1920, height: 1080 },
    target: { top: 318.5, right: 1407.5, bottom: 879.5, left: 688.5 },
    placement: "left",
    maxHeight: null,
  },
];

describe("tour tooltip placement", () => {
  it.each(TEMPLATE_LIST)(
    "keeps the tooltip clear of the template list in $label",
    ({ viewport, target, placement, maxHeight }) => {
      const input = geometry(viewport, target);

      expect(fitTourTooltip(input)).toEqual({ placement, maxHeight });
      expect(overlaps(tooltipRect(input), target)).toBe(false);
      expect(insideViewport(tooltipRect(input), viewport)).toBe(true);
    },
  );

  it("ranks sides by what is left over, not by raw free space", () => {
    const laptop = TEMPLATE_LIST[1];

    expect(laptop.target.left).toBeGreaterThan(laptop.target.top);
    expect(laptop.target.left).toBeLessThan(TOOLTIP.width + STANDOFF);
    expect(fitTourTooltip(geometry(laptop.viewport, laptop.target)).placement).toBe("top");
  });

  it("prefers the roomiest side when several of them fit", () => {
    const viewport = { width: 1600, height: 900 };
    const target = { top: 300, right: 700, bottom: 600, left: 500 };
    const input = geometry(viewport, target);

    expect(fitTourTooltip(input)).toEqual({ placement: "right", maxHeight: null });
    expect(overlaps(tooltipRect(input), target)).toBe(false);
    expect(insideViewport(tooltipRect(input), viewport)).toBe(true);
  });

  it("caps a card that is taller than the window on the side it lands on", () => {
    const viewport = { width: 1600, height: 600 };
    const target = { top: 200, right: 700, bottom: 400, left: 500 };
    const tall = { width: TOOLTIP.width, height: 620, minHeight: TOOLTIP.minHeight };
    const input = geometry(viewport, target, tall);

    expect(tall.height).toBeGreaterThan(viewport.height - SHIFT_PADDING * 2);
    expect(fitTourTooltip(input)).toEqual({ placement: "right", maxHeight: 580 });
    expect(overlaps(tooltipRect(input), target)).toBe(false);
    expect(insideViewport(tooltipRect(input), viewport)).toBe(true);
  });

  it("leaves a side placement at its natural height while the card fits the window", () => {
    const viewport = { width: 1600, height: 600 };
    const target = { top: 200, right: 700, bottom: 400, left: 500 };
    const exact = { width: TOOLTIP.width, height: 580, minHeight: TOOLTIP.minHeight };
    const input = geometry(viewport, target, exact);

    expect(exact.height).toBe(viewport.height - SHIFT_PADDING * 2);
    expect(fitTourTooltip(input)).toEqual({ placement: "right", maxHeight: null });
    expect(insideViewport(tooltipRect(input), viewport)).toBe(true);
  });

  it("shrinks the card into the roomiest band when no side fits it whole", () => {
    const viewport = { width: 900, height: 600 };
    const target = { top: 40, right: 880, bottom: 420, left: 20 };
    const input = geometry(viewport, target);

    expect(fitTourTooltip(input)).toEqual({ placement: "bottom", maxHeight: 148 });
    expect(overlaps(tooltipRect(input), target)).toBe(false);
    expect(insideViewport(tooltipRect(input), viewport)).toBe(true);
  });

  it("overlaps only once the roomiest band cannot hold the card's controls", () => {
    const viewport = { width: 900, height: 600 };
    const target = { top: 40, right: 880, bottom: 450, left: 20 };
    const input = geometry(viewport, target);

    expect(viewport.height - target.bottom - STANDOFF).toBeLessThan(TOOLTIP.minHeight);
    expect(fitTourTooltip(input)).toEqual({ placement: "center", maxHeight: null });
    expect(insideViewport(tooltipRect(input), viewport)).toBe(true);
  });

  it("overlaps when the target covers the whole viewport", () => {
    const viewport = { width: 900, height: 600 };
    const input = geometry(viewport, { top: 0, right: 900, bottom: 600, left: 0 });

    expect(fitTourTooltip(input)).toEqual({ placement: "center", maxHeight: null });
    expect(insideViewport(tooltipRect(input), viewport)).toBe(true);
  });
});
