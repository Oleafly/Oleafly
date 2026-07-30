import React from "react";
import { ScrollArea } from "@base-ui/react/scroll-area";
//#region src/base-ui/ScrollArea/atoms.d.ts
type ScrollAreaRootProps = React.ComponentProps<typeof ScrollArea.Root>;
type ScrollAreaFadeOrientation = 'vertical' | 'horizontal' | 'both';
type ScrollAreaViewportProps = React.ComponentProps<typeof ScrollArea.Viewport> & {
  /**
   * Enable gradient scroll fade on the viewport edges.
   *
   * - `true` / `'vertical'`: fade top and bottom edges.
   * - `'horizontal'`: fade start and end edges.
   * - `'both'`: fade all four edges (combined via `mask-composite: intersect`).
   * - `false`: no fade.
   *
   * @default false
   */
  scrollFade?: boolean | ScrollAreaFadeOrientation;
};
type ScrollAreaContentProps = React.ComponentProps<typeof ScrollArea.Content>;
type ScrollAreaScrollbarProps = React.ComponentProps<typeof ScrollArea.Scrollbar>;
type ScrollAreaThumbProps = React.ComponentProps<typeof ScrollArea.Thumb>;
type ScrollAreaCornerProps = React.ComponentProps<typeof ScrollArea.Corner>;
declare const ScrollAreaRoot: {
  ({ className, ...rest }: ScrollAreaRootProps): React.JSX.Element;
  displayName: string;
};
declare const ScrollAreaViewport: {
  ({ className, scrollFade, ...rest }: ScrollAreaViewportProps): React.JSX.Element;
  displayName: string;
};
declare const ScrollAreaContent: {
  ({ className, ...rest }: ScrollAreaContentProps): React.JSX.Element;
  displayName: string;
};
declare const ScrollAreaScrollbar: {
  ({ className, ...rest }: ScrollAreaScrollbarProps): React.JSX.Element;
  displayName: string;
};
declare const ScrollAreaThumb: {
  ({ className, ...rest }: ScrollAreaThumbProps): React.JSX.Element;
  displayName: string;
};
declare const ScrollAreaCorner: {
  ({ className, ...rest }: ScrollAreaCornerProps): React.JSX.Element;
  displayName: string;
};
//#endregion
export { ScrollAreaContent, ScrollAreaContentProps, ScrollAreaCorner, ScrollAreaCornerProps, ScrollAreaFadeOrientation, ScrollAreaRoot, ScrollAreaRootProps, ScrollAreaScrollbar, ScrollAreaScrollbarProps, ScrollAreaThumb, ScrollAreaThumbProps, ScrollAreaViewport, ScrollAreaViewportProps };
//# sourceMappingURL=atoms.d.mts.map