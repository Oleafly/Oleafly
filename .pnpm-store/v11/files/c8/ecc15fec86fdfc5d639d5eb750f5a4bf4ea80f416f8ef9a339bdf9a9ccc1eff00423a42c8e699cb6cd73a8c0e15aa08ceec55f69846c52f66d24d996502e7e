import { FlexboxProps } from "../Flex/type.mjs";
import { AvatarProps } from "../Avatar/type.mjs";
import { PopoverProps } from "../base-ui/Popover/type.mjs";
import "../Popover/index.mjs";
import { CSSProperties, ReactNode } from "react";
//#region src/EmojiPicker/type.d.ts
interface AvatarUploaderProps {
  compressSize?: number;
  onChange: (avatar: string) => void;
  onUpload?: (file: File) => void;
  shape?: 'circle' | 'square';
  texts?: {
    draggerDesc?: string;
    fileTypeError?: string;
    uploadBtn?: string;
  };
}
interface EmojiPickerCustomEmoji {
  emojis: [{
    id: string;
    keywords?: string[];
    name: string;
    skins: {
      src: string;
    }[];
  }];
  id: string;
  name: string;
}
interface EmojiPickerCustomTab {
  label: ReactNode;
  render: (handleAvatarChange: (avatar: string) => void) => ReactNode;
  value: string;
}
interface EmojiPickerProps extends Omit<AvatarProps, 'onChange' | 'avatar'> {
  allowDelete?: boolean;
  allowModelAvatar?: boolean;
  allowUpload?: boolean | {
    enableEmoji?: boolean;
  };
  compressSize?: number;
  contentProps?: Omit<FlexboxProps, 'className' | 'ref' | 'style'>;
  customEmojis?: EmojiPickerCustomEmoji[];
  customRender?: (avatar: string) => ReactNode;
  customTabs?: EmojiPickerCustomTab[];
  defaultAvatar?: string;
  defaultOpen?: boolean;
  loading?: boolean;
  locale?: string;
  onChange?: (emoji: string) => void;
  onDelete?: () => void;
  onOpenChange?: (open: boolean) => void;
  onUpload?: AvatarUploaderProps['onUpload'];
  open?: boolean;
  popupClassName?: string;
  popupProps?: Omit<PopoverProps, 'onOpenChange' | 'defaultOpen' | 'content' | 'open' | 'trigger' | 'children'>;
  popupStyle?: CSSProperties;
  size?: number;
  texts?: AvatarUploaderProps['texts'] & {
    delete?: string;
    emoji?: string;
    upload?: string;
  };
  value?: string;
}
//#endregion
export { AvatarUploaderProps, EmojiPickerCustomEmoji, EmojiPickerCustomTab, EmojiPickerProps };
//# sourceMappingURL=type.d.mts.map