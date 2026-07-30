import { FlexboxProps } from "../Flex/type.mjs";
import "../Flex/index.mjs";
import { TextAreaProps } from "../types/index.mjs";
import { CSSProperties, Ref } from "react";
//#region src/CodeEditor/type.d.ts
interface CodeEditorProps extends TextAreaProps, Pick<FlexboxProps, 'width' | 'height' | 'flex'> {
  classNames?: {
    highlight?: string;
    textarea?: string;
  };
  defaultValue?: string;
  language: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  ref?: Ref<HTMLTextAreaElement>;
  style?: CSSProperties;
  styles?: {
    highlight?: CSSProperties;
    textarea?: CSSProperties;
  };
  value: string;
  variant?: 'filled' | 'outlined' | 'borderless';
}
//#endregion
export { CodeEditorProps };
//# sourceMappingURL=type.d.mts.map