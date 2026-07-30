import { Placement } from "@floating-ui/react";
//#region src/utils/placement.d.ts
/**
 * Base UI uses a small set of string literal unions for alignment and side.
 * We re-declare them here to avoid importing internal/non-exported Base UI paths.
 */
type Side = 'top' | 'bottom' | 'left' | 'right' | 'inline-end' | 'inline-start';
type Align = 'start' | 'center' | 'end';
type PlacementConfig = {
  align: Align;
  side: Side;
};
/**
 * All supported placement values
 * - Unified placement names for Tooltip, Popover, and DropdownMenu
 * - Ant Design style: topLeft, topCenter, topRight, etc.
 * - Additional aliases: top (same as topCenter), bottom (same as bottomCenter)
 */
type Placement$1 = 'top' | 'topLeft' | 'topCenter' | 'topRight' | 'bottom' | 'bottomLeft' | 'bottomCenter' | 'bottomRight' | 'left' | 'leftTop' | 'leftBottom' | 'right' | 'rightTop' | 'rightBottom';
/**
 * Map of placement values to Base UI placement config
 * Used by Popover and DropdownMenu components
 */
declare const placementMap: Record<Placement$1, PlacementConfig>;
/**
 * Convert unified Placement to Floating UI placement format
 * Used by Tooltip component which uses @floating-ui/react
 *
 * @param placement - Unified placement value
 * @returns Floating UI placement (e.g., 'top-start', 'bottom-end')
 */
declare const toFloatingUIPlacement: (placement?: Placement$1) => Placement;
//#endregion
export { Align, Placement$1 as Placement, PlacementConfig, Side, placementMap, toFloatingUIPlacement };
//# sourceMappingURL=placement.d.mts.map