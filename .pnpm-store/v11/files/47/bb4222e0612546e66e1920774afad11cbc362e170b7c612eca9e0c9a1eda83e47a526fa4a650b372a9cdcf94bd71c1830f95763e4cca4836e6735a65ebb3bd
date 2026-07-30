import type * as React from 'react';
import type { FloatingPortal } from "../../floating-ui-react/index.js";
/**
 * A portal element that moves the popup to a different part of the DOM.
 * By default, the portal element is appended to `<body>`.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Drawer](https://base-ui.com/react/components/drawer)
 */
export declare const DrawerPortal: DrawerPortal;
export interface DrawerPortalState {}
export interface DrawerPortalProps extends FloatingPortal.Props<DrawerPortalState> {
  /**
   * Whether to keep the portal mounted in the DOM while the popup is hidden.
   * @default false
   */
  keepMounted?: boolean | undefined;
  /**
   * A parent element to render the portal element into.
   */
  container?: FloatingPortal.Props<DrawerPortalState>['container'] | undefined;
}
export interface DrawerPortal {
  (componentProps: DrawerPortalProps & React.RefAttributes<HTMLDivElement>): React.JSX.Element | null;
}
export declare namespace DrawerPortal {
  type Props = DrawerPortalProps;
  type State = DrawerPortalState;
}