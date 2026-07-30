import { FlexboxProps } from "../../Flex/type.mjs";
import "../../Flex/index.mjs";
import { ButtonProps } from "../../Button/type.mjs";
import "../../Button/index.mjs";
import { CodeEditorProps } from "../../CodeEditor/type.mjs";
import "../../CodeEditor/index.mjs";
import { CSSProperties } from "react";
//#region src/chat/MessageInput/type.d.ts
interface MessageInputProps extends FlexboxProps {
  classNames?: CodeEditorProps['classNames'] & {
    editor?: string;
  };
  defaultValue?: string;
  editButtonSize?: ButtonProps['size'];
  language?: CodeEditorProps['language'];
  onCancel?: () => void;
  onConfirm?: (text: string) => void;
  placeholder?: string;
  renderButtons?: (text: string) => ButtonProps[];
  shortcut?: boolean;
  styles?: CodeEditorProps['styles'] & {
    editor?: CSSProperties;
  };
  text?: {
    cancel?: string;
    confirm?: string;
  };
  variant?: CodeEditorProps['variant'];
}
//#endregion
export { MessageInputProps };
//# sourceMappingURL=type.d.mts.map