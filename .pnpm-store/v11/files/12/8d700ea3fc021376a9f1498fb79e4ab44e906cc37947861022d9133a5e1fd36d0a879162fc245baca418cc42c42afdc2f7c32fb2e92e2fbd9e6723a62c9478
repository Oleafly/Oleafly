import { DropdownMenuPlacement } from "./type.mjs";
import React from "react";
import { Menu } from "@base-ui/react/menu";
//#region src/base-ui/DropdownMenu/atoms.d.ts
declare const DropdownMenuRoot: typeof Menu.Root;
declare const DropdownMenuSubmenuRoot: typeof Menu.SubmenuRoot;
declare const DropdownMenuCheckboxItemIndicator: React.ForwardRefExoticComponent<Omit<import("@base-ui/react").ContextMenuCheckboxItemIndicatorProps, "ref"> & React.RefAttributes<HTMLSpanElement>>;
type DropdownMenuTriggerProps = Omit<React.ComponentPropsWithRef<typeof Menu.Trigger>, 'children' | 'render'> & {
  children: React.ReactNode;
};
declare const DropdownMenuTrigger: {
  ({ children, className, nativeButton, ref: refProp, ...rest }: DropdownMenuTriggerProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuPortalProps = React.ComponentProps<typeof Menu.Portal> & {
  /**
   * When `container` is not provided, it uses a shared container created by `usePortalContainer`.
   */
  container?: HTMLElement | null;
};
declare const DropdownMenuPortal: {
  ({ container, ...rest }: DropdownMenuPortalProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuPositionerProps = React.ComponentProps<typeof Menu.Positioner> & {
  hoverTrigger?: boolean;
  placement?: DropdownMenuPlacement;
};
declare const DropdownMenuPositioner: {
  ({ className, placement, hoverTrigger, align, side, sideOffset, children, style, ...rest }: DropdownMenuPositionerProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuPopupProps = React.ComponentProps<typeof Menu.Popup>;
declare const DropdownMenuPopup: {
  ({ className, ...rest }: DropdownMenuPopupProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuHeaderProps = React.HTMLAttributes<HTMLDivElement>;
declare const DropdownMenuHeader: {
  ({ className, ...rest }: DropdownMenuHeaderProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuFooterProps = React.HTMLAttributes<HTMLDivElement>;
declare const DropdownMenuFooter: {
  ({ className, ...rest }: DropdownMenuFooterProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuScrollViewportProps = React.HTMLAttributes<HTMLDivElement>;
declare const DropdownMenuScrollViewport: {
  ({ className, ...rest }: DropdownMenuScrollViewportProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuItemProps = React.ComponentProps<typeof Menu.Item> & {
  danger?: boolean;
};
declare const DropdownMenuItem: {
  ({ className, danger, ...rest }: DropdownMenuItemProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuCheckboxItemProps = React.ComponentProps<typeof Menu.CheckboxItem> & {
  danger?: boolean;
};
declare const DropdownMenuCheckboxItemPrimitive: {
  ({ className, danger, ...rest }: DropdownMenuCheckboxItemProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuSeparatorProps = React.ComponentProps<typeof Menu.Separator>;
declare const DropdownMenuSeparator: {
  ({ className, ...rest }: DropdownMenuSeparatorProps): React.JSX.Element;
  displayName: string;
};
declare const DropdownMenuGroup: React.ForwardRefExoticComponent<Omit<import("@base-ui/react").ContextMenuGroupProps, "ref"> & React.RefAttributes<HTMLDivElement>>;
type DropdownMenuGroupLabelProps = React.ComponentProps<typeof Menu.GroupLabel>;
declare const DropdownMenuGroupLabel: {
  ({ className, ...rest }: DropdownMenuGroupLabelProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuSubmenuTriggerProps = React.ComponentProps<typeof Menu.SubmenuTrigger> & {
  danger?: boolean;
};
declare const DropdownMenuSubmenuTrigger: {
  ({ className, danger, ...rest }: DropdownMenuSubmenuTriggerProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuItemContentProps = React.HTMLAttributes<HTMLDivElement>;
declare const DropdownMenuItemContent: {
  ({ className, ...rest }: DropdownMenuItemContentProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuItemIconProps = React.HTMLAttributes<HTMLSpanElement>;
declare const DropdownMenuItemIcon: {
  ({ className, ...rest }: DropdownMenuItemIconProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuItemLabelGroupProps = React.HTMLAttributes<HTMLDivElement>;
declare const DropdownMenuItemLabelGroup: {
  ({ className, ...rest }: DropdownMenuItemLabelGroupProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuItemLabelProps = React.HTMLAttributes<HTMLSpanElement>;
declare const DropdownMenuItemLabel: {
  ({ className, ...rest }: DropdownMenuItemLabelProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuItemDescProps = React.HTMLAttributes<HTMLSpanElement>;
declare const DropdownMenuItemDesc: {
  ({ className, ...rest }: DropdownMenuItemDescProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuItemExtraProps = React.HTMLAttributes<HTMLSpanElement>;
declare const DropdownMenuItemExtra: {
  ({ className, ...rest }: DropdownMenuItemExtraProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuSubmenuArrowProps = React.HTMLAttributes<HTMLSpanElement>;
declare const DropdownMenuSubmenuArrow: {
  ({ className, ...rest }: DropdownMenuSubmenuArrowProps): React.JSX.Element;
  displayName: string;
};
type DropdownMenuSwitchItemProps = Omit<React.ComponentProps<typeof Menu.Item>, 'onClick'> & {
  checked?: boolean;
  closeOnClick?: boolean;
  danger?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};
declare const DropdownMenuSwitchItem: {
  ({ checked: checkedProp, className, closeOnClick, danger, defaultChecked, disabled, onCheckedChange, children, ...rest }: DropdownMenuSwitchItemProps): React.JSX.Element;
  displayName: string;
};
//#endregion
export { DropdownMenuCheckboxItemIndicator, DropdownMenuCheckboxItemPrimitive, DropdownMenuCheckboxItemProps, DropdownMenuFooter, DropdownMenuFooterProps, DropdownMenuGroup, DropdownMenuGroupLabel, DropdownMenuGroupLabelProps, DropdownMenuHeader, DropdownMenuHeaderProps, DropdownMenuItem, DropdownMenuItemContent, DropdownMenuItemContentProps, DropdownMenuItemDesc, DropdownMenuItemDescProps, DropdownMenuItemExtra, DropdownMenuItemExtraProps, DropdownMenuItemIcon, DropdownMenuItemIconProps, DropdownMenuItemLabel, DropdownMenuItemLabelGroup, DropdownMenuItemLabelGroupProps, DropdownMenuItemLabelProps, DropdownMenuItemProps, DropdownMenuPopup, DropdownMenuPopupProps, DropdownMenuPortal, DropdownMenuPortalProps, DropdownMenuPositioner, DropdownMenuPositionerProps, DropdownMenuRoot, DropdownMenuScrollViewport, DropdownMenuScrollViewportProps, DropdownMenuSeparator, DropdownMenuSeparatorProps, DropdownMenuSubmenuArrow, DropdownMenuSubmenuArrowProps, DropdownMenuSubmenuRoot, DropdownMenuSubmenuTrigger, DropdownMenuSubmenuTriggerProps, DropdownMenuSwitchItem, DropdownMenuSwitchItemProps, DropdownMenuTrigger, DropdownMenuTriggerProps };
//# sourceMappingURL=atoms.d.mts.map