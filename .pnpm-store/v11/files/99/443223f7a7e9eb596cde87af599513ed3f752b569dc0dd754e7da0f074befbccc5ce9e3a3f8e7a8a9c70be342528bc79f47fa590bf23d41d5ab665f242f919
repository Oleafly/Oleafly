import { CenterProps } from "../Flex/type.mjs";
import "../Flex/index.mjs";
import { ActionIconProps } from "../ActionIcon/type.mjs";
import "../ActionIcon/index.mjs";
import { MenuInfo, MenuItemType } from "../Menu/type.mjs";
import "../Menu/index.mjs";
import { DropdownMenuProps } from "../base-ui/DropdownMenu/type.mjs";
import "../DropdownMenu/index.mjs";
import { Ref } from "react";
//#region src/ActionIconGroup/type.d.ts
type ActionIconGroupEvent = Pick<MenuInfo, 'key' | 'keyPath' | 'domEvent'>;
interface ActionIconGroupProps extends Omit<CenterProps, 'children'> {
  actionIconProps?: Partial<Omit<ActionIconProps, 'icon' | 'size' | 'ref'>>;
  disabled?: boolean;
  glass?: boolean;
  /**
   * @default true
   */
  horizontal?: boolean;
  items?: MenuItemType[];
  menu?: DropdownMenuProps['items'];
  onActionClick?: (action: ActionIconGroupEvent) => void;
  ref?: Ref<HTMLDivElement>;
  shadow?: boolean;
  size?: ActionIconProps['size'];
  variant?: 'filled' | 'outlined' | 'borderless';
}
//#endregion
export { ActionIconGroupEvent, type MenuItemType as ActionIconGroupItemType, ActionIconGroupProps };
//# sourceMappingURL=type.d.mts.map