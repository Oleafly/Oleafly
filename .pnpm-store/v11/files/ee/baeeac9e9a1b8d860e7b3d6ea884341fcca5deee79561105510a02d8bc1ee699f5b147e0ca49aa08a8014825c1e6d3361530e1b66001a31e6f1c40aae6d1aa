import { IconSize } from "../Icon/type.mjs";
import "../Icon/index.mjs";
import { MenuCheckboxItemType } from "./checkboxItem.mjs";
import { MenuItemType, SubMenuType } from "./type.mjs";
import { BaseMenuItemType } from "./baseItem.mjs";
import { Key, ReactNode } from "react";
//#region src/Menu/renderUtils.d.ts
type IconSpaceMode = 'global' | 'group';
type IconAlign = 'center' | 'start';
interface RenderOptions {
  iconAlign?: IconAlign;
  iconSpaceMode?: IconSpaceMode;
  indicatorOnRight?: boolean;
  reserveIconSpace?: boolean;
}
interface RenderItemContentOptions {
  iconAlign?: IconAlign;
  indicatorOnRight?: boolean;
  reserveIconSpace?: boolean;
  submenu?: boolean;
}
type KeyableItem = {
  key?: Key;
};
declare const getItemKey: (item: KeyableItem, fallback: string) => Key;
type LabelableItem = {
  key?: Key;
  label?: ReactNode;
  title?: ReactNode;
};
declare const getItemLabel: (item: MenuItemType | SubMenuType | MenuCheckboxItemType | LabelableItem) => ReactNode;
declare const renderIcon: (icon: MenuItemType["icon"], size?: IconSize) => ReactNode;
declare const hasAnyIcon: (items: BaseMenuItemType[], recursive?: boolean) => boolean;
declare const hasCheckboxAndIcon: (items: BaseMenuItemType[]) => boolean;
//#endregion
export { IconAlign, IconSpaceMode, RenderItemContentOptions, RenderOptions, getItemKey, getItemLabel, hasAnyIcon, hasCheckboxAndIcon, renderIcon };
//# sourceMappingURL=renderUtils.d.mts.map