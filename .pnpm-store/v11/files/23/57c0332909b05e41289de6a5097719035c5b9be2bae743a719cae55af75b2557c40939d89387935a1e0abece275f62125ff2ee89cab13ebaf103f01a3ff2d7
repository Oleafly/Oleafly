import { PopoverPlacement } from "./type.mjs";
import { ComponentProps, ComponentPropsWithRef } from "react";
import { Popover } from "@base-ui/react/popover";
//#region src/base-ui/Popover/atoms.d.ts
declare const PopoverRoot: typeof Popover.Root;
declare const PopoverBackdrop: import("react").ForwardRefExoticComponent<Omit<import("@base-ui/react").PopoverBackdropProps, "ref"> & import("react").RefAttributes<HTMLDivElement>>;
type PopoverTriggerElementProps = Omit<ComponentPropsWithRef<typeof Popover.Trigger>, 'children' | 'render'> & {
  children: ComponentProps<typeof Popover.Trigger>['children'];
};
declare const PopoverTriggerElement: {
  ({ children, className, nativeButton, ref: refProp, ...rest }: PopoverTriggerElementProps): import("react").JSX.Element;
  displayName: string;
};
type PopoverPortalAtomProps = Omit<ComponentProps<typeof Popover.Portal>, 'container'> & {
  /**
   * Portal container. When not provided, it uses the shared container created by `usePopoverPortalContainer`.
   */
  container?: HTMLElement | null;
  /**
   * Root element used by `usePopoverPortalContainer` to create the default container.
   */
  root?: HTMLElement | ShadowRoot | null;
};
declare const PopoverPortal: {
  ({ container, root, children, ...rest }: PopoverPortalAtomProps): import("react").JSX.Element | null;
  displayName: string;
};
type PopoverPositionerAtomProps = ComponentProps<typeof Popover.Positioner> & {
  hoverTrigger?: boolean;
  placement?: PopoverPlacement;
};
declare const PopoverPositioner: {
  ({ children, className, hoverTrigger, placement, align, side, sideOffset, style, ...rest }: PopoverPositionerAtomProps): import("react").JSX.Element;
  displayName: string;
};
type PopoverPopupAtomProps = ComponentProps<typeof Popover.Popup>;
declare const PopoverPopup: {
  ({ className, ...rest }: PopoverPopupAtomProps): import("react").JSX.Element;
  displayName: string;
};
type PopoverArrowAtomProps = ComponentProps<typeof Popover.Arrow>;
declare const PopoverArrow: {
  ({ className, children, ...rest }: PopoverArrowAtomProps): import("react").JSX.Element;
  displayName: string;
};
type PopoverViewportAtomProps = ComponentProps<typeof Popover.Viewport>;
declare const PopoverViewport: {
  ({ className, ...rest }: PopoverViewportAtomProps): import("react").JSX.Element;
  displayName: string;
};
//#endregion
export { PopoverArrow, PopoverArrowAtomProps, PopoverBackdrop, PopoverPopup, PopoverPopupAtomProps, PopoverPortal, PopoverPortalAtomProps, PopoverPositioner, PopoverPositionerAtomProps, PopoverRoot, PopoverTriggerElement, PopoverTriggerElementProps, PopoverViewport, PopoverViewportAtomProps };
//# sourceMappingURL=atoms.d.mts.map