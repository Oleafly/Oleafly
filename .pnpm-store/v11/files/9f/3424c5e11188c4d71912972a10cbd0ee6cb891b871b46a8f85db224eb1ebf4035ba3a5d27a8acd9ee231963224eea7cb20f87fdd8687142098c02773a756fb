import * as React from 'react';
import { FloatingPortalLite } from "../../utils/FloatingPortalLite.js";
/**
 * A portal element that moves the popup to a different part of the DOM.
 * By default, the portal element is appended to `<body>`.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Tooltip](https://base-ui.com/react/components/tooltip)
 */
export declare const TooltipPortal: React.ForwardRefExoticComponent<Omit<TooltipPortalProps, "ref"> & React.RefAttributes<HTMLDivElement>>;
export interface TooltipPortalState {}
export interface TooltipPortalProps extends FloatingPortalLite.Props<TooltipPortalState> {
  /**
   * Whether to keep the portal mounted in the DOM while the popup is hidden.
   * @default false
   */
  keepMounted?: boolean | undefined;
}
export declare namespace TooltipPortal {
  type State = TooltipPortalState;
  type Props = TooltipPortalProps;
}