import { FlexboxProps } from "../../Flex/type.mjs";
import "../../Flex/index.mjs";
import { TextProps } from "../../Text/type.mjs";
import "../../Text/index.mjs";
import { CSSProperties, ComponentProps, ReactNode } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
//#region src/base-ui/Radio/type.d.ts
type BaseRadioProps = Omit<ComponentProps<typeof Radio.Root>, 'className' | 'style' | 'render' | 'children'>;
interface RadioProps extends BaseRadioProps {
  backgroundColor?: string;
  children?: ReactNode;
  className?: string;
  classNames?: {
    radio?: string;
    text?: string;
    wrapper?: string;
  };
  /**
   * Dot size in pixels
   * @default 16
   */
  size?: number;
  style?: CSSProperties;
  styles?: {
    radio?: CSSProperties;
    text?: CSSProperties;
    wrapper?: CSSProperties;
  };
  textProps?: Omit<TextProps, 'children' | 'className' | 'style'>;
}
interface RadioGroupOption {
  disabled?: boolean;
  label: ReactNode;
  value: string;
}
type BaseRadioGroupProps = Omit<RadioGroup.Props<string>, 'className' | 'style' | 'render' | 'children' | 'onValueChange' | 'onChange'>;
interface RadioGroupProps extends BaseRadioGroupProps {
  className?: string;
  /**
   * Gap between items
   * @default 12
   */
  gap?: FlexboxProps['gap'];
  /**
   * Row layout
   * @default true
   */
  horizontal?: boolean;
  onChange?: (value: string) => void;
  options: (string | RadioGroupOption)[];
  size?: number;
  style?: CSSProperties;
  textProps?: RadioProps['textProps'];
}
//#endregion
export { RadioGroupOption, RadioGroupProps, RadioProps };
//# sourceMappingURL=type.d.mts.map