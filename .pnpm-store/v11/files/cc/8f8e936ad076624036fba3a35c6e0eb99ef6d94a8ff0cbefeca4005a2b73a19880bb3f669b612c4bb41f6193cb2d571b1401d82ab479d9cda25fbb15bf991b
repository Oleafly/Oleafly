import { FlexboxProps } from "../Flex/type.mjs";
import "../Flex/index.mjs";
import { ControlInputProps } from "./ControlInput.mjs";
import { CSSProperties } from "react";
//#region src/EditableText/type.d.ts
interface EditableTextProps extends Omit<FlexboxProps, 'onChange' | 'onBlur' | 'onFocus'>, Pick<ControlInputProps, 'onChange' | 'value' | 'onChangeEnd' | 'onValueChanging' | 'texts' | 'variant' | 'onBlur' | 'onFocus' | 'size'> {
  className?: string;
  classNames?: {
    container?: string;
    input?: string;
  };
  editing?: boolean;
  /**
   * @default 8
   */
  gap?: number;
  inputProps?: Omit<ControlInputProps, 'onChange' | 'value' | 'onChangeEnd' | 'onValueChanging' | 'texts' | 'className' | 'style' | 'onBlur' | 'onFocus' | 'size'>;
  onEditingChange?: (editing: boolean) => void;
  showEditIcon?: boolean;
  style?: CSSProperties;
  styles?: {
    container?: CSSProperties;
    input?: CSSProperties;
  };
  /**
   * @default 'borderless'
   */
  variant?: ControlInputProps['variant'];
}
//#endregion
export { EditableTextProps };
//# sourceMappingURL=type.d.mts.map