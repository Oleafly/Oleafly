import { IconProps } from "../Icon/type.mjs";
import "../Icon/index.mjs";
import { CSSProperties, ReactNode, Ref } from "react";
import { AlertProps } from "antd";
import { AlertRef } from "antd/lib/alert/Alert.js";
//#region src/Alert/type.d.ts
interface AlertProps$1 extends Omit<AlertProps, 'classNames' | 'icon' | 'styles' | 'type' | 'variant'> {
  classNames?: {
    alert?: string;
    container?: string;
    extraContent?: string;
  };
  colorfulText?: boolean;
  extra?: ReactNode;
  extraDefaultExpand?: boolean;
  extraIsolate?: boolean;
  glass?: boolean;
  icon?: IconProps['icon'];
  iconProps?: Omit<IconProps, 'icon'>;
  ref?: Ref<AlertRef>;
  styles?: {
    alert?: CSSProperties;
    container?: CSSProperties;
    extraContent?: CSSProperties;
  };
  text?: {
    detail?: string;
  };
  type?: 'success' | 'info' | 'warning' | 'error' | 'secondary';
  variant?: 'filled' | 'outlined' | 'borderless';
}
//#endregion
export { AlertProps$1 as AlertProps };
//# sourceMappingURL=type.d.mts.map