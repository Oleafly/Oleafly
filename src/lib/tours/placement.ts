type TourPlacementSide = "top" | "bottom" | "left" | "right";

export interface TourBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface TourViewport {
  width: number;
  height: number;
}

export interface TourTooltipMetrics {
  width: number;
  height: number;
  minHeight: number;
}

export interface TourPlacementInput {
  target: TourBox;
  viewport: TourViewport;
  tooltip: TourTooltipMetrics;
  standoff: number;
  shiftPadding: number;
}

export interface TourPlacementFit {
  placement: TourPlacementSide | "center";
  maxHeight: number | null;
}

const SIDES = ["top", "bottom", "left", "right"] as const;

function freeSpace(side: TourPlacementSide, { target, viewport }: TourPlacementInput) {
  if (side === "top") return target.top;
  if (side === "bottom") return viewport.height - target.bottom;
  if (side === "left") return target.left;
  return viewport.width - target.right;
}

export function fitTourTooltip(input: TourPlacementInput): TourPlacementFit {
  const { shiftPadding, standoff, tooltip, viewport } = input;
  const shiftBand = viewport.height - shiftPadding * 2;
  const sides = SIDES.map((side) => {
    const vertical = side === "top" || side === "bottom";
    const free = Math.max(0, freeSpace(side, input));
    return {
      side,
      free,
      vertical,
      slack: free - ((vertical ? tooltip.height : tooltip.width) + standoff),
    };
  });
  const roomiest = sides.reduce((best, side) => (side.slack > best.slack ? side : best));
  if (roomiest.slack >= 0) {
    const overflows = !roomiest.vertical && tooltip.height > shiftBand;
    return { placement: roomiest.side, maxHeight: overflows ? shiftBand : null };
  }
  const band = sides
    .filter((side) => side.vertical)
    .reduce((best, side) => (side.free > best.free ? side : best));
  const available = band.free - standoff;
  if (available <= tooltip.minHeight) return { placement: "center", maxHeight: null };
  return { placement: band.side, maxHeight: available };
}
