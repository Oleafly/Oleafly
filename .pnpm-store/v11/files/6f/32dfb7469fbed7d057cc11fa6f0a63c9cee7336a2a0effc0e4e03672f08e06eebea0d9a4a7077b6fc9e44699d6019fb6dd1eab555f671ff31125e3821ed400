import { IconAlign, IconSpaceMode } from "../../Menu/renderUtils.mjs";
import "../../Menu/index.mjs";
import { ContextMenuItem } from "./type.mjs";
import "./renderItems.mjs";
import { ReactNode } from "react";
import "@floating-ui/react";
//#region src/base-ui/ContextMenu/store.d.ts
interface ShowContextMenuOptions {
  footer?: ReactNode;
  header?: ReactNode;
  iconAlign?: IconAlign;
  iconSpaceMode?: IconSpaceMode;
}
declare const showContextMenu: (items: ContextMenuItem[], options?: ShowContextMenuOptions) => void;
/**
 * Update menu items while keeping current anchor/position.
 * Useful for interactive menu items (e.g. checkbox) to avoid re-positioning.
 */
declare const updateContextMenuItems: (items: ContextMenuItem[]) => void;
declare const closeContextMenu: () => void;
//#endregion
export { ShowContextMenuOptions, closeContextMenu, showContextMenu, updateContextMenuItems };
//# sourceMappingURL=store.d.mts.map