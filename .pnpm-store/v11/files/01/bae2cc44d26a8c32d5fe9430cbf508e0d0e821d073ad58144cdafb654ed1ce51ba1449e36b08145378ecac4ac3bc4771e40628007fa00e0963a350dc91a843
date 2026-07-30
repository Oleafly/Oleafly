import { FlexboxProps } from "../../Flex/type.mjs";
import "../../Flex/index.mjs";
import { TextProps } from "../../Text/type.mjs";
import "../../Text/index.mjs";
import { CSSProperties, ComponentProps, ReactNode } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { CheckboxGroup } from "@base-ui/react/checkbox-group";
//#region src/base-ui/Checkbox/type.d.ts
type CheckboxShape = 'square' | 'circle';
type BaseCheckboxProps = Omit<ComponentProps<typeof Checkbox.Root>, 'className' | 'style' | 'render' | 'children' | 'onCheckedChange'>;
interface CheckboxProps extends BaseCheckboxProps {
  backgroundColor?: string;
  children?: ReactNode;
  className?: string;
  classNames?: {
    checkbox?: string;
    text?: string;
    wrapper?: string;
  };
  onChange?: (checked: boolean) => void;
  shape?: CheckboxShape;
  /**
   * Box size in pixels
   * @default 16
   */
  size?: number;
  style?: CSSProperties;
  styles?: {
    checkbox?: CSSProperties;
    text?: CSSProperties;
    wrapper?: CSSProperties;
  };
  textProps?: Omit<TextProps, 'children' | 'className' | 'style'>;
}
interface CheckboxGroupOption {
  disabled?: boolean;
  label: ReactNode;
  value: string;
}
type BaseCheckboxGroupProps = Omit<ComponentProps<typeof CheckboxGroup>, 'className' | 'style' | 'render' | 'children' | 'onValueChange' | 'onChange'>;
interface CheckboxGroupProps extends BaseCheckboxGroupProps, Pick<FlexboxProps, 'gap' | 'horizontal'> {
  className?: string;
  onChange?: (value: string[]) => void;
  options: (string | CheckboxGroupOption)[];
  shape?: CheckboxShape;
  size?: number;
  style?: CSSProperties;
  textProps?: CheckboxProps['textProps'];
}
//#endregion
export { CheckboxGroupOption, CheckboxGroupProps, CheckboxProps, CheckboxShape };
//# sourceMappingURL=type.d.mts.map