import { ModalProps } from "../../Modal/type.mjs";
import "../../Modal/index.mjs";
import { MessageInputProps } from "../MessageInput/type.mjs";
import "../MessageInput/index.mjs";
import { ReactNode } from "react";
//#region src/chat/MessageModal/type.d.ts
interface MessageModalProps extends Pick<ModalProps, 'open' | 'footer' | 'panelRef'> {
  editing?: boolean;
  extra?: ReactNode;
  height?: MessageInputProps['height'];
  language?: MessageInputProps['language'];
  onChange?: (text: string) => void;
  onEditingChange?: (editing: boolean) => void;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  text?: {
    cancel?: string;
    confirm?: string;
    edit?: string;
    title?: string;
  };
  /**
   * @description The value of the message content
   */
  value: string;
}
//#endregion
export { MessageModalProps };
//# sourceMappingURL=type.d.mts.map