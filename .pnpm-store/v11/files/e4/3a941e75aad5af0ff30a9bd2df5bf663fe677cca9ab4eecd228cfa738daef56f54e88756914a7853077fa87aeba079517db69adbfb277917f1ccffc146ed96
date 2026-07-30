import { IconProps } from "../Icon/type.mjs";
import "../Icon/index.mjs";
import { CSSProperties, ReactNode, Ref } from "react";
import { CollapseProps } from "antd";
import { ItemType } from "rc-collapse/es/interface.js";
//#region src/Collapse/type.d.ts
interface CollapseItemType extends ItemType {
  desc?: ReactNode;
  icon?: IconProps['icon'];
}
interface CollapseProps$1 extends Omit<CollapseProps, 'collapsible' | 'ghost' | 'items'> {
  classNames?: {
    desc?: string;
    header?: string;
    title?: string;
  };
  collapsible?: boolean;
  gap?: number;
  items: CollapseItemType[];
  padding?: number | string | {
    body?: number | string;
    header?: number | string;
  };
  ref?: Ref<HTMLDivElement>;
  styles?: {
    desc?: CSSProperties;
    header?: CSSProperties;
    title?: CSSProperties;
  };
  variant?: 'filled' | 'outlined' | 'borderless';
}
//#endregion
export { CollapseItemType, CollapseProps$1 as CollapseProps };
//# sourceMappingURL=type.d.mts.map