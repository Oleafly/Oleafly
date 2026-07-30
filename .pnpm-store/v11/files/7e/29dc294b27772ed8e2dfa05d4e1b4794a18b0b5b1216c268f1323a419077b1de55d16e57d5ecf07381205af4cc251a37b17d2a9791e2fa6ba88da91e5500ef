import { FlexboxProps } from "../../Flex/type.mjs";
import "../../Flex/index.mjs";
import { InputNumberProps, InputVariant } from "../Input/type.mjs";
import "../Input/index.mjs";
import { CSSProperties, ComponentProps } from "react";
import { Slider } from "@base-ui/react/slider";
//#region src/base-ui/Slider/type.d.ts
type BaseSliderProps = Omit<ComponentProps<typeof Slider.Root>, 'className' | 'style' | 'render' | 'children' | 'onValueChange' | 'value' | 'defaultValue' | 'onChange'>;
interface SliderProps extends BaseSliderProps {
  className?: string;
  classNames?: {
    control?: string;
    indicator?: string;
    thumb?: string;
    track?: string;
  };
  defaultValue?: number;
  onChange?: (value: number) => void;
  onChangeComplete?: (value: number) => void;
  style?: CSSProperties;
  styles?: {
    control?: CSSProperties;
    indicator?: CSSProperties;
    thumb?: CSSProperties;
    track?: CSSProperties;
  };
  value?: number;
}
interface SliderWithInputProps extends Omit<SliderProps, 'classNames' | 'styles'> {
  changeOnWheel?: boolean;
  classNames?: SliderProps['classNames'] & {
    input?: string;
    slider?: string;
  };
  controls?: boolean;
  gap?: FlexboxProps['gap'];
  shadow?: boolean;
  size?: InputNumberProps['size'];
  styles?: SliderProps['styles'] & {
    input?: CSSProperties;
    slider?: CSSProperties;
  };
  unlimitedInput?: boolean;
  variant?: InputVariant;
}
//#endregion
export { SliderProps, SliderWithInputProps };
//# sourceMappingURL=type.d.mts.map