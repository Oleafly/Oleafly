import { IconProps } from "../Icon/type.mjs";
import { IconContentConfig } from "../Icon/components/IconProvider.mjs";
import "../Icon/index.mjs";
import { Key, ReactNode, Ref } from "react";
import { MenuProps, MenuRef } from "antd";
import { MenuDividerType, MenuInfo, MenuItemGroupType, MenuItemType, SubMenuType } from "rc-menu/es/interface.js";
//#region src/Menu/type.d.ts
interface MenuItemType$1 extends MenuItemType {
  /**
   * Whether to close the menu when this item is clicked.
   * Set to `false` to keep the menu open (useful for items with Upload, file picker, etc.)
   * @default true
   */
  closeOnClick?: boolean;
  danger?: boolean;
  desc?: ReactNode;
  icon?: IconProps['icon'];
  loading?: boolean;
  title?: string;
}
interface SubMenuType$1<T extends MenuItemType$1 = MenuItemType$1> extends Omit<SubMenuType, 'children'> {
  children: ItemType<T>[];
  desc?: ReactNode;
  icon?: IconProps['icon'];
}
interface MenuItemGroupType$1<T extends MenuItemType$1 = MenuItemType$1> extends Omit<MenuItemGroupType, 'children'> {
  children?: ItemType<T>[];
  key?: Key;
}
interface MenuDividerType$1 extends MenuDividerType {
  dashed?: boolean;
  key?: Key;
}
type ItemType<T extends MenuItemType$1 = MenuItemType$1> = T | SubMenuType$1<T> | MenuItemGroupType$1<T> | MenuDividerType$1 | null;
type GenericItemType<T = unknown> = T extends (infer U extends MenuItemType$1) ? unknown extends U ? ItemType : ItemType<U> : ItemType;
interface MenuProps$1<T = unknown> extends Omit<MenuProps, 'items'> {
  compact?: boolean;
  iconProps?: IconContentConfig;
  items: GenericItemType<T>[];
  ref?: Ref<MenuRef>;
  shadow?: boolean;
  variant?: 'filled' | 'outlined' | 'borderless';
}
//#endregion
export { GenericItemType, ItemType, MenuDividerType$1 as MenuDividerType, type MenuInfo, MenuItemGroupType$1 as MenuItemGroupType, MenuItemType$1 as MenuItemType, MenuProps$1 as MenuProps, SubMenuType$1 as SubMenuType };
//# sourceMappingURL=type.d.mts.map