import { SpanProps } from "../types/index.mjs";
import { FC, ReactNode, Ref } from "react";
import { LucideIcon, LucideProps } from "lucide-react";
//#region src/Icon/type.d.ts
interface IconSizeConfig extends Pick<LucideProps, 'strokeWidth' | 'absoluteStrokeWidth'> {
  size?: number | string;
}
type IconSizeType = 'large' | 'middle' | 'small';
type IconSize = number | IconSizeType | IconSizeConfig;
type LucideIconProps = Pick<LucideProps, 'fill' | 'fillRule' | 'fillOpacity' | 'color' | 'focusable'>;
interface IconProps extends Omit<SpanProps, 'children'>, LucideIconProps {
  icon: LucideIcon | FC<any> | ReactNode;
  ref?: Ref<SVGSVGElement>;
  size?: IconSize;
  spin?: boolean;
}
//#endregion
export { IconProps, IconSize, IconSizeConfig, IconSizeType, LucideIconProps };
//# sourceMappingURL=type.d.mts.map