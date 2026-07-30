import { FlexboxProps } from "../Flex/type.mjs";
import "../Flex/index.mjs";
import { Key, ReactNode, Ref } from "react";
//#region src/ColorSwatches/type.d.ts
interface ColorSwatchesItemType {
  color: string;
  key?: Key;
  title?: ReactNode;
}
interface ColorSwatchesProps extends Omit<FlexboxProps, 'onChange'> {
  colors: ColorSwatchesItemType[];
  defaultValue?: string;
  enableColorPicker?: boolean;
  enableColorSwatches?: boolean;
  onChange?: (color?: string) => void;
  ref?: Ref<HTMLDivElement>;
  shape?: 'circle' | 'square';
  size?: number;
  texts?: {
    custom: string;
    presets: string;
  };
  value?: string;
}
//#endregion
export { ColorSwatchesProps };
//# sourceMappingURL=type.d.mts.map