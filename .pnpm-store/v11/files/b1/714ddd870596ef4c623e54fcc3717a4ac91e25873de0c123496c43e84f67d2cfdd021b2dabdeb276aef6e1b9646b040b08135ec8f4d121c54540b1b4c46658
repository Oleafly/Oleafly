import { CSSProperties, ComponentProps, ReactNode, Ref } from "react";
import { Input } from "@base-ui/react/input";
import { NumberField } from "@base-ui/react/number-field";
import { OTPField } from "@base-ui/react/otp-field";
//#region src/base-ui/Input/type.d.ts
type InputVariant = 'filled' | 'outlined' | 'borderless';
type InputSize = 'small' | 'middle' | 'large';
interface InputClassNames {
  input?: string;
  prefix?: string;
  suffix?: string;
}
interface InputStyles {
  input?: CSSProperties;
  prefix?: CSSProperties;
  suffix?: CSSProperties;
}
type BaseInputProps = Omit<ComponentProps<typeof Input>, 'size' | 'prefix' | 'render' | 'className' | 'style'>;
interface InputProps extends BaseInputProps {
  className?: string;
  /**
   * Custom class names for each part
   */
  classNames?: InputClassNames;
  /**
   * Prefix node rendered before the input
   */
  prefix?: ReactNode;
  /**
   * Reference to the input element
   */
  ref?: Ref<HTMLInputElement>;
  /**
   * Apply lobe shadow style
   */
  shadow?: boolean;
  /**
   * Size of the input
   * @default 'middle'
   */
  size?: InputSize;
  style?: CSSProperties;
  /**
   * Custom styles for each part
   */
  styles?: InputStyles;
  /**
   * Suffix node rendered after the input
   */
  suffix?: ReactNode;
  /**
   * Visual variant, defaults to `filled` in dark mode and `outlined` in light mode
   */
  variant?: InputVariant;
}
interface InputPasswordProps extends Omit<InputProps, 'type'> {
  /**
   * Show the eye toggle button
   * @default true
   */
  visibilityToggle?: boolean;
}
type BaseNumberFieldProps = Omit<ComponentProps<typeof NumberField.Root>, 'className' | 'style' | 'render' | 'onValueChange' | 'children'>;
interface InputNumberProps extends BaseNumberFieldProps {
  /**
   * Change value on wheel scrub
   */
  changeOnWheel?: boolean;
  className?: string;
  classNames?: Pick<InputClassNames, 'input'>;
  /**
   * Show increment/decrement buttons
   * @default true
   */
  controls?: boolean;
  onChange?: (value: number | null) => void;
  placeholder?: string;
  ref?: Ref<HTMLInputElement>;
  shadow?: boolean;
  size?: InputSize;
  style?: CSSProperties;
  styles?: Pick<InputStyles, 'input'>;
  variant?: InputVariant;
}
type BaseOTPFieldProps = Omit<ComponentProps<typeof OTPField.Root>, 'className' | 'style' | 'render' | 'onValueChange' | 'children' | 'length'>;
interface InputOTPProps extends BaseOTPFieldProps {
  className?: string;
  classNames?: Pick<InputClassNames, 'input'>;
  /**
   * Number of cells
   * @default 6
   */
  length?: number;
  onChange?: (value: string) => void;
  shadow?: boolean;
  size?: InputSize;
  style?: CSSProperties;
  styles?: Pick<InputStyles, 'input'>;
  variant?: InputVariant;
}
type TextAreaAutoSize = boolean | {
  maxRows?: number;
  minRows?: number;
};
interface TextAreaProps extends Omit<ComponentProps<'textarea'>, 'prefix'>, Pick<InputProps, 'shadow' | 'variant'> {
  /**
   * Auto grow with content, optionally bounded by minRows/maxRows
   */
  autoSize?: TextAreaAutoSize;
  classNames?: Pick<InputClassNames, 'input'>;
  ref?: Ref<HTMLTextAreaElement>;
  /**
   * Allow manual resize
   * @default false
   */
  resize?: boolean;
  styles?: Pick<InputStyles, 'input'>;
}
//#endregion
export { InputClassNames, InputNumberProps, InputOTPProps, InputPasswordProps, InputProps, InputSize, InputStyles, InputVariant, TextAreaAutoSize, TextAreaProps };
//# sourceMappingURL=type.d.mts.map