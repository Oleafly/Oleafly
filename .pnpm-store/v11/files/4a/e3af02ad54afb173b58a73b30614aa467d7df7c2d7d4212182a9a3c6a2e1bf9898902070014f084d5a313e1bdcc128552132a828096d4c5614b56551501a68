import { CSSProperties, ComponentProps, ReactNode, Ref } from "react";
import { ToggleGroup } from "@base-ui/react/toggle-group";
//#region src/base-ui/Segmented/type.d.ts
type SegmentedSize = 'large' | 'middle' | 'small';
type SegmentedVariant = 'filled' | 'outlined';
type SegmentedOrientation = 'horizontal' | 'vertical';
interface SegmentedOption<Value extends string = string> {
  className?: string;
  disabled?: boolean;
  icon?: ReactNode;
  label?: ReactNode;
  title?: string;
  value: Value;
}
type SegmentedOptions<Value extends string = string> = Array<SegmentedOption<Value> | Value>;
interface SegmentedClassNames {
  indicator?: string;
  item?: string;
  itemIcon?: string;
  itemLabel?: string;
  list?: string;
  root?: string;
}
interface SegmentedStyles {
  indicator?: CSSProperties;
  item?: CSSProperties;
  itemIcon?: CSSProperties;
  itemLabel?: CSSProperties;
  list?: CSSProperties;
  root?: CSSProperties;
}
interface SegmentedProps<Value extends string = string> {
  block?: boolean;
  className?: string;
  classNames?: SegmentedClassNames;
  defaultValue?: Value;
  disabled?: boolean;
  glass?: boolean;
  id?: string;
  name?: string;
  onChange?: (value: Value) => void;
  options?: SegmentedOptions<Value>;
  ref?: Ref<HTMLDivElement>;
  shadow?: boolean;
  size?: SegmentedSize;
  style?: CSSProperties;
  styles?: SegmentedStyles;
  value?: Value;
  variant?: SegmentedVariant;
  vertical?: boolean;
}
//#endregion
export { SegmentedClassNames, SegmentedOption, SegmentedOptions, SegmentedOrientation, SegmentedProps, SegmentedSize, SegmentedStyles, SegmentedVariant };
//# sourceMappingURL=type.d.mts.map