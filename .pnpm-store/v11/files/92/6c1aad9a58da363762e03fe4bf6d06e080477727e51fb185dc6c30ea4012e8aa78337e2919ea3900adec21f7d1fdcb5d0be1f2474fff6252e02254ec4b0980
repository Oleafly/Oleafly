import { ContextMenuItem } from "./type.mjs";
import React, { HTMLAttributes, MouseEvent, ReactNode } from "react";
//#region src/base-ui/ContextMenu/ContextMenuTrigger.d.ts
type ContextMenuTriggerProps = {
  children: ReactNode;
  /**
   * Footer slot pinned below the scrollable items area, with a divider border.
   */
  footer?: ReactNode;
  /**
   * Header slot pinned above the scrollable items area, with a divider border.
   */
  header?: ReactNode;
  /**
   * Menu items to display. Supports lazy rendering via function.
   * When provided, context menu will be automatically shown on right-click.
   */
  items?: ContextMenuItem[] | (() => ContextMenuItem[]);
  /**
   * Custom context menu handler. If `items` is provided, this is optional.
   */
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
} & Omit<HTMLAttributes<HTMLElement>, 'onContextMenu' | 'children'>;
declare const ContextMenuTrigger: React.NamedExoticComponent<ContextMenuTriggerProps>;
//#endregion
export { ContextMenuTrigger, ContextMenuTriggerProps };
//# sourceMappingURL=ContextMenuTrigger.d.mts.map