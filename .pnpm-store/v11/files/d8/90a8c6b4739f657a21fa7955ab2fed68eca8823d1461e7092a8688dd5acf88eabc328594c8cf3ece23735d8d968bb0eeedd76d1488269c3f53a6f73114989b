import * as React from 'react';
import { type Align, type Side, type UseAnchorPositioningSharedParameters } from "../../utils/useAnchorPositioning.js";
import { BaseUIComponentProps } from "../../internals/types.js";
/**
 * Positions the menu popup against the trigger.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Menu](https://base-ui.com/react/components/menu)
 */
export declare const MenuPositioner: React.ForwardRefExoticComponent<Omit<MenuPositionerProps, "ref"> & React.RefAttributes<HTMLDivElement>>;
export interface MenuPositionerState {
  /**
   * Whether the menu is currently open.
   */
  open: boolean;
  /**
   * The side of the anchor the component is placed on.
   */
  side: Side;
  /**
   * The alignment of the component relative to the anchor.
   */
  align: Align;
  /**
   * Whether the anchor element is hidden.
   */
  anchorHidden: boolean;
  /**
   * Whether the component is nested.
   */
  nested: boolean;
  /**
   * Whether CSS transitions should be disabled.
   */
  instant: string | undefined;
}
export interface MenuPositionerProps extends UseAnchorPositioningSharedParameters, BaseUIComponentProps<'div', MenuPositionerState> {}
export declare namespace MenuPositioner {
  type State = MenuPositionerState;
  type Props = MenuPositionerProps;
}