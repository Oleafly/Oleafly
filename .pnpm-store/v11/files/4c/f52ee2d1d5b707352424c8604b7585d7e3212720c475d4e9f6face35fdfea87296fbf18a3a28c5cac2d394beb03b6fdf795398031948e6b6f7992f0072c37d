import { FlexboxProps } from "../../Flex/type.mjs";
import "../../Flex/index.mjs";
import { DraggablePanelProps } from "../../DraggablePanel/type.mjs";
import "../../DraggablePanel/index.mjs";
import { TextAreaProps as TextAreaProps$1 } from "../../Input/type.mjs";
import "../../Input/index.mjs";
import { CSSProperties, ReactNode, Ref } from "react";
import { TextAreaRef } from "antd/es/input/TextArea.js";
//#region src/chat/ChatInputArea/type.d.ts
interface ChatInputAreaProps extends Omit<ChatInputAreaInnerProps, 'classNames'> {
  bottomAddons?: ReactNode;
  classNames?: DraggablePanelProps['classNames'];
  expand?: boolean;
  heights?: {
    headerHeight?: number;
    inputHeight?: number;
    maxHeight?: number;
    minHeight?: number;
  };
  onSizeChange?: DraggablePanelProps['onSizeChange'];
  ref?: Ref<TextAreaRef>;
  setExpand?: (expand: boolean) => void;
  topAddons?: ReactNode;
}
interface ChatInputActionBarProps {
  leftAddons?: ReactNode;
  mobile?: boolean;
  padding?: number | string;
  ref?: Ref<HTMLDivElement>;
  rightAddons?: ReactNode;
}
interface ChatInputAreaInnerProps extends Omit<TextAreaProps$1, 'onInput'> {
  className?: string;
  loading?: boolean;
  onInput?: (value: string) => void;
  onSend?: () => void;
  ref?: Ref<TextAreaRef>;
  style?: CSSProperties;
}
interface ChatSendButtonProps extends FlexboxProps {
  className?: string;
  leftAddons?: ReactNode;
  loading?: boolean;
  onSend?: () => void;
  onStop?: () => void;
  ref?: Ref<HTMLDivElement>;
  rightAddons?: ReactNode;
  style?: CSSProperties;
  texts?: {
    send?: string;
    stop?: string;
    warp?: string;
  };
}
//#endregion
export { ChatInputActionBarProps, ChatInputAreaInnerProps, ChatInputAreaProps, ChatSendButtonProps };
//# sourceMappingURL=type.d.mts.map