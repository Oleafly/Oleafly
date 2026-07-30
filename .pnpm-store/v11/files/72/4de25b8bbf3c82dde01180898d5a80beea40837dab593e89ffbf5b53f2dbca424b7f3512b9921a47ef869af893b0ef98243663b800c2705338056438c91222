import type { DrawerSnapPoint } from "./DrawerRootContext.mjs";
export interface ResolvedDrawerSnapPoint {
  value: DrawerSnapPoint;
  height: number;
  offset: number;
}
/**
 * Resolves the vertical swipe movement for a snap point, applying square-root damping once the drag
 * overshoots the fully-open edge (`nextOffset < 0`) so the popup resists travelling past it.
 */
export declare function getSnapPointSwipeMovement(baseOffset: number, movementValue: number): number;
export declare function useDrawerSnapPoints(): {
  snapPoints: DrawerSnapPoint[] | undefined;
  activeSnapPoint: DrawerSnapPoint | null | undefined;
  setActiveSnapPoint: ((snapPoint: DrawerSnapPoint | null, eventDetails?: import("./DrawerRoot.mjs").DrawerRootSnapPointChangeEventDetails) => void) | undefined;
  popupHeight: number;
  viewportHeight: number;
  resolvedSnapPoints: ResolvedDrawerSnapPoint[];
  activeSnapPointOffset: number | null;
};