import { IconProps } from "../../Icon/type.mjs";
import "../../Icon/index.mjs";
import { CSSProperties, ReactNode } from "react";
import { SelectRootChangeEventDetails } from "@base-ui/react/select";
//#region src/base-ui/Select/type.d.ts
type SelectSize = 'large' | 'middle' | 'small';
type SelectVariant = 'borderless' | 'filled' | 'outlined';
type SelectBehaviorVariant = 'default' | 'item-aligned';
/**
 * Variant for how selected items are indicated in the popup.
 * - `check`: Display a checkmark icon next to selected items (default)
 * - `bold`: Display selected items with bold text, no checkmark
 */
type SelectIndicatorVariant = 'check' | 'bold';
interface SelectOption<Value = string> {
  className?: string;
  disabled?: boolean;
  label: ReactNode;
  style?: CSSProperties;
  title?: string;
  value: Value;
}
interface SelectOptionGroup<Value = string> {
  disabled?: boolean;
  label: ReactNode;
  options: SelectOption<Value>[];
}
type SelectOptions<Value = string> = Array<SelectOption<Value> | SelectOptionGroup<Value>>;
interface SelectClassNames {
  clear?: string;
  dropdown?: string;
  empty?: string;
  group?: string;
  groupLabel?: string;
  icon?: string;
  item?: string;
  itemIndicator?: string;
  itemText?: string;
  list?: string;
  option?: string;
  popup?: string;
  prefix?: string;
  root?: string;
  search?: string;
  suffix?: string;
  trigger?: string;
  value?: string;
}
interface SelectProps<Value = string> {
  allowClear?: boolean;
  autoFocus?: boolean;
  /**
   * Behavior variant for Base UI Select.
   *
   * - `default`: regular dropdown positioning (alignItemWithTrigger=false, modal=false)
   * - `item-aligned`: aligns the selected item with trigger and uses modal=true
   * @default 'default'
   */
  behaviorVariant?: SelectBehaviorVariant;
  className?: string;
  classNames?: SelectClassNames;
  defaultOpen?: boolean;
  defaultValue?: Value | Value[] | null;
  disabled?: boolean;
  id?: string;
  labelRender?: (option: SelectOption<Value>) => ReactNode;
  /**
   * 设置弹窗滚动高度
   * @default 512
   */
  listHeight?: number;
  listItemHeight?: number;
  loading?: boolean;
  mode?: 'multiple' | 'tags';
  name?: string;
  onChange?: (value: Value | Value[] | null | undefined, option?: SelectOption<Value> | SelectOption<Value>[]) => void;
  onOpenChange?: (open: boolean, eventDetails?: SelectRootChangeEventDetails) => void;
  onSelect?: (value: Value, option?: SelectOption<Value>) => void;
  open?: boolean;
  optionRender?: (option: SelectOption<Value>, info: {
    index: number;
  }) => ReactNode;
  options?: SelectOptions<Value>;
  placeholder?: ReactNode;
  popupClassName?: string;
  popupMatchSelectWidth?: boolean | number;
  prefix?: ReactNode | IconProps['icon'];
  readOnly?: boolean;
  required?: boolean;
  /**
   * Variant for how selected items are indicated in the popup.
   * - `check`: Display a checkmark icon next to selected items (default)
   * - `bold`: Display selected items with bold text, no checkmark
   * @default 'check'
   */
  selectedIndicatorVariant?: SelectIndicatorVariant;
  shadow?: boolean;
  showSearch?: boolean;
  size?: SelectSize;
  style?: CSSProperties;
  suffixIcon?: IconProps['icon'] | ReactNode;
  suffixIconProps?: Omit<IconProps, 'icon'>;
  tokenSeparators?: string[];
  value?: Value | Value[] | null;
  variant?: SelectVariant;
  virtual?: boolean;
}
//#endregion
export { SelectBehaviorVariant, SelectClassNames, SelectIndicatorVariant, SelectOption, SelectOptionGroup, SelectOptions, SelectProps, type SelectRootChangeEventDetails, SelectSize, SelectVariant };
//# sourceMappingURL=type.d.mts.map