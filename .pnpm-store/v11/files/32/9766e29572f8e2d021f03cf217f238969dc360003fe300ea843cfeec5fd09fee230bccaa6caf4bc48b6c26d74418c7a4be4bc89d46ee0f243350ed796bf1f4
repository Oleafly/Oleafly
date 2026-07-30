import { FlexboxProps } from "../Flex/type.mjs";
import "../Flex/index.mjs";
import { IconProps } from "../Icon/type.mjs";
import "../Icon/index.mjs";
import { CSSProperties, ReactNode, Ref } from "react";
import { SelectProps } from "antd";
//#region src/ImageSelect/type.d.ts
interface ImageSelectItem {
  alt?: string;
  icon?: IconProps['icon'];
  img: string;
  label: ReactNode;
  value: string;
}
interface ImageSelectProps extends FlexboxProps {
  className?: string;
  classNames?: {
    img?: string;
  };
  defaultValue?: SelectProps['defaultValue'];
  /**
   * @default 86
   */
  height?: number;
  onChange?: (value: this['value']) => void;
  options?: ImageSelectItem[];
  ref?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  styles?: {
    img?: CSSProperties;
  };
  unoptimized?: boolean;
  value?: SelectProps['value'];
  /**
   * @default 144
   */
  width?: number;
}
//#endregion
export { ImageSelectItem, ImageSelectProps };
//# sourceMappingURL=type.d.mts.map