import { FlexboxProps } from "../Flex/type.mjs";
import "../Flex/index.mjs";
import { BlockProps } from "../Block/type.mjs";
import "../Block/index.mjs";
import { IconProps } from "../Icon/type.mjs";
import "../Icon/index.mjs";
import { TextProps } from "../Text/type.mjs";
import "../Text/index.mjs";
import { ReactNode } from "react";
//#region src/Empty/type.d.ts
interface EmptyProps extends Omit<FlexboxProps, 'title'> {
  action?: ReactNode;
  actionProps?: Omit<FlexboxProps, 'children'>;
  description?: ReactNode;
  descriptionProps?: Omit<TextProps, 'children'>;
  emoji?: string;
  icon?: IconProps['icon'];
  iconColor?: IconProps['color'];
  image?: ReactNode;
  imageProps?: Omit<BlockProps, 'children'>;
  imageSize?: number;
  title?: ReactNode;
  titleProps?: Omit<TextProps, 'children'>;
  type?: 'default' | 'page';
}
//#endregion
export { EmptyProps };
//# sourceMappingURL=type.d.mts.map