import { CenterProps } from "../Flex/type.mjs";
import "../Flex/index.mjs";
import { IconProps, IconSizeConfig, IconSizeType, LucideIconProps } from "../Icon/type.mjs";
import "../Icon/index.mjs";
import { TooltipProps } from "../base-ui/Tooltip/type.mjs";
import "../Tooltip/index.mjs";
import { ReactNode, Ref } from "react";
//#region src/ActionIcon/type.d.ts
interface ActionIconSizeConfig extends IconSizeConfig {
  blockSize?: number | string;
  borderRadius?: number | string;
}
type ActionIconSize = number | IconSizeType | ActionIconSizeConfig;
interface ActionIconProps extends Partial<LucideIconProps>, Omit<CenterProps, 'title' | 'children'> {
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  glass?: boolean;
  icon?: IconProps['icon'] | ReactNode;
  loading?: boolean;
  ref?: Ref<HTMLDivElement>;
  shadow?: boolean;
  size?: ActionIconSize;
  spin?: boolean;
  title?: TooltipProps['title'];
  tooltipProps?: Omit<TooltipProps, 'children' | 'title'>;
  variant?: 'borderless' | 'filled' | 'outlined';
}
//#endregion
export { ActionIconProps, ActionIconSize };
//# sourceMappingURL=type.d.mts.map