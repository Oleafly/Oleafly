import * as React from 'react';
import { FloatingPortal } from "../../floating-ui-react/index.js";
/**
 * A portal element that moves the popup to a different part of the DOM.
 * By default, the portal element is appended to `<body>`.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Popover](https://base-ui.com/react/components/popover)
 */
export declare const PopoverPortal: React.ForwardRefExoticComponent<Omit<PopoverPortalProps, "ref"> & React.RefAttributes<HTMLDivElement>>;
export interface PopoverPortalState {}
export interface PopoverPortalProps extends FloatingPortal.Props<PopoverPortalState> {
  /**
   * Whether to keep the portal mounted in the DOM while the popup is hidden.
   * @default false
   */
  keepMounted?: boolean | undefined;
}
export declare namespace PopoverPortal {
  type State = PopoverPortalState;
  type Props = PopoverPortalProps;
}