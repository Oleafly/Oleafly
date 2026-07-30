import { FlexboxProps } from "../Flex/type.mjs";
import "../Flex/index.mjs";
import { ImgProps } from "../types/index.mjs";
import { ActionIconProps } from "../ActionIcon/type.mjs";
import "../ActionIcon/index.mjs";
import { CSSProperties, ReactNode, Ref } from "react";
import { ImageProps } from "antd";
//#region src/GuideCard/type.d.ts
interface GuideCardProps extends Omit<FlexboxProps, 'title'> {
  afterClose?: () => void;
  alt?: string;
  classNames?: {
    content?: string;
    cover?: string;
  };
  closable?: boolean;
  closeIconProps?: Omit<ActionIconProps, 'icon' | 'onClick'>;
  cover?: string;
  coverProps?: ImgProps & ImageProps & {
    priority?: boolean;
  };
  desc?: ReactNode;
  height?: number;
  onClose?: ActionIconProps['onClick'];
  ref?: Ref<HTMLDivElement>;
  shadow?: boolean;
  styles?: {
    content?: CSSProperties;
    cover?: CSSProperties;
  };
  title?: ReactNode;
  variant?: 'filled' | 'outlined' | 'borderless';
  width?: number;
}
//#endregion
export { GuideCardProps };
//# sourceMappingURL=type.d.mts.map