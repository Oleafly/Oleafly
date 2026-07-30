import { FlexboxProps } from "../Flex/type.mjs";
import "../Flex/index.mjs";
import { DivProps } from "../types/index.mjs";
import { TextProps } from "../Text/type.mjs";
import "../Text/index.mjs";
import { CSSProperties, ReactNode } from "react";
//#region src/Checkbox/type.d.ts
interface CheckboxProps extends Omit<DivProps, 'onChange'> {
  backgroundColor?: string;
  checked?: boolean;
  classNames?: {
    checkbox?: string;
    text?: string;
    wrapper?: string;
  };
  defaultChecked?: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  shape?: 'square' | 'circle';
  size?: number;
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
interface CheckboxGroupProps extends Omit<FlexboxProps, 'defaultValue' | 'onChange'> {
  defaultValue?: string[];
  disabled?: boolean;
  onChange?: (value: string[]) => void;
  options: string[] | CheckboxGroupOption[];
  shape?: 'square' | 'circle';
  size?: number;
  textProps?: Omit<TextProps, 'children' | 'className' | 'style'>;
  value?: string[];
}
//#endregion
export { CheckboxGroupOption, CheckboxGroupProps, CheckboxProps };
//# sourceMappingURL=type.d.mts.map