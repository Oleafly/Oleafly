import { DivProps } from "../../types/index.mjs";
import { IconProps } from "../../Icon/type.mjs";
import "../../Icon/index.mjs";
import { SpotlightCardProps } from "../SpotlightCard/type.mjs";
import "../SpotlightCard/index.mjs";
import { CSSProperties } from "react";
//#region src/awesome/Features/type.d.ts
interface FeatureItemType {
  column?: number;
  description?: string;
  hero?: boolean;
  icon?: IconProps['icon'];
  image?: string;
  imageStyle?: CSSProperties;
  imageType?: 'light' | 'primary' | 'soon';
  link?: string;
  openExternal?: boolean;
  row?: number;
  title: string;
}
interface FeaturesProps extends DivProps {
  columns?: SpotlightCardProps['columns'];
  gap?: SpotlightCardProps['gap'];
  itemClassName?: string;
  items: FeatureItemType[];
  itemStyle?: CSSProperties;
  maxWidth?: number;
}
//#endregion
export { FeatureItemType, FeaturesProps };
//# sourceMappingURL=type.d.mts.map