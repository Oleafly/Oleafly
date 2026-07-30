import { MarkdownProps } from "../../Markdown/type.mjs";
import "../../Markdown/index.mjs";
import { MessageInputProps } from "../MessageInput/type.mjs";
import "../MessageInput/index.mjs";
import { MessageModalProps } from "../MessageModal/type.mjs";
import "../MessageModal/index.mjs";
import { CSSProperties } from "react";
//#region src/chat/EditableMessage/type.d.ts
interface EditableMessageProps {
  className?: string;
  classNames?: MessageInputProps['classNames'] & {
    input?: string;
    markdown?: string;
  };
  defaultValue?: string;
  editButtonSize?: MessageInputProps['editButtonSize'];
  editing?: boolean;
  fontSize?: number;
  fullFeaturedCodeBlock?: boolean;
  height?: MessageInputProps['height'];
  language?: MessageInputProps['language'];
  markdownProps?: Omit<MarkdownProps, 'className' | 'style' | 'children'>;
  model?: {
    extra?: MessageModalProps['extra'];
    footer?: MessageModalProps['footer'];
  };
  onChange?: (value: string) => void;
  onEditingChange?: (editing: boolean) => void;
  onOpenChange?: (open: boolean) => void;
  openModal?: boolean;
  placeholder?: string;
  showEditWhenEmpty?: boolean;
  style?: CSSProperties;
  styles?: MessageInputProps['styles'] & {
    input?: CSSProperties;
    markdown?: CSSProperties;
  };
  text?: MessageModalProps['text'];
  value: string;
  variant?: MessageInputProps['variant'];
}
//#endregion
export { EditableMessageProps };
//# sourceMappingURL=type.d.mts.map