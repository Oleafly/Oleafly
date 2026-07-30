import { ButtonProps } from "../../Button/type.mjs";
import "../../Button/index.mjs";
import { ChatInputAreaInnerProps } from "../../chat/ChatInputArea/type.mjs";
import "../../chat/ChatInputArea/index.mjs";
import { CSSProperties, ReactNode, Ref } from "react";
import { TextAreaRef } from "antd/es/input/TextArea.js";
//#region src/mobile/ChatInputArea/type.d.ts
interface ChatInputAreaProps extends ChatInputAreaInnerProps {
  bottomAddons?: ReactNode;
  expand?: boolean;
  ref?: Ref<TextAreaRef>;
  safeArea?: boolean;
  setExpand?: (expand: boolean) => void;
  style?: CSSProperties;
  textAreaLeftAddons?: ReactNode;
  textAreaRightAddons?: ReactNode;
  topAddons?: ReactNode;
}
interface ChatSendButtonProps extends Omit<ButtonProps, 'onClick'> {
  onSend?: ButtonProps['onClick'];
  onStop?: ButtonProps['onClick'];
}
//#endregion
export { ChatInputAreaProps, ChatSendButtonProps };
//# sourceMappingURL=type.d.mts.map