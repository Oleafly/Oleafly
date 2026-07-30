import { FlexboxProps } from "../Flex/type.mjs";
import "../Flex/index.mjs";
import { TooltipProps } from "../base-ui/Tooltip/type.mjs";
import "../Tooltip/index.mjs";
import { CSSProperties, ReactNode, Ref } from "react";
import { AvatarProps } from "antd";
//#region src/Avatar/type.d.ts
interface AvatarProps$1 extends AvatarProps {
  animation?: boolean;
  avatar?: string | ReactNode;
  background?: string;
  bordered?: boolean;
  borderedColor?: string;
  emojiScaleWithBackground?: boolean;
  loading?: boolean;
  ref?: Ref<HTMLDivElement>;
  shadow?: boolean;
  shape?: 'circle' | 'square';
  size?: number;
  sliceText?: boolean;
  title?: string;
  tooltipProps?: Omit<TooltipProps, 'children' | 'title'>;
  unoptimized?: boolean;
  variant?: 'borderless' | 'filled' | 'outlined';
}
interface AvatarGroupItemType extends Pick<AvatarProps$1, 'avatar' | 'title' | 'alt' | 'onClick' | 'style' | 'className' | 'loading'> {
  key: string;
}
interface AvatarGroupProps extends Pick<AvatarProps$1, 'variant' | 'bordered' | 'shadow' | 'size' | 'background' | 'animation' | 'draggable' | 'shape'>, Omit<FlexboxProps, 'children' | 'onClick'> {
  classNames?: {
    avatar?: string;
    count?: string;
  };
  items: AvatarGroupItemType[];
  max?: number;
  onClick?: (props: {
    item: AvatarGroupItemType;
    key: string;
  }) => void;
  ref?: Ref<HTMLDivElement>;
  styles?: {
    avatar?: CSSProperties;
    count?: CSSProperties;
  };
  zIndexReverse?: boolean;
}
//#endregion
export { AvatarGroupItemType, AvatarGroupProps, AvatarProps$1 as AvatarProps };
//# sourceMappingURL=type.d.mts.map