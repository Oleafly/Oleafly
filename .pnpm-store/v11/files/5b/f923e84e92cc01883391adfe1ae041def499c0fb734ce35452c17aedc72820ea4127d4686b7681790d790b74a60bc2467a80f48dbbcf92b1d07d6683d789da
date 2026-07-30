import { DivProps } from "../../types/index.mjs";
import { ActionIconGroupEvent, ActionIconGroupProps } from "../../ActionIconGroup/type.mjs";
import "../../ActionIconGroup/index.mjs";
import { AlertProps } from "../../Alert/type.mjs";
import "../../Alert/index.mjs";
import { LLMRoleType } from "../types/llm.mjs";
import { ChatMessage } from "../types/chatMessage.mjs";
import "../types/index.mjs";
import { ChatItemProps } from "../ChatItem/type.mjs";
import "../ChatItem/index.mjs";
import { FC, ReactNode } from "react";
//#region src/chat/ChatList/type.d.ts
type OnMessageChange = (id: string, content: string) => void;
type OnActionsClick = (action: ActionIconGroupEvent, message: ChatMessage) => void;
type OnAvatatsClick = (role: RenderRole) => ChatItemProps['onAvatarClick'];
type RenderRole = LLMRoleType | 'default' | string;
type RenderItem = FC<{
  key: string;
} & ChatMessage & ListItemProps>;
type RenderMessage = FC<ChatMessage & {
  editableContent: ReactNode;
}>;
type RenderMessageExtra = FC<ChatMessage>;
interface RenderErrorMessage {
  config?: AlertProps;
  Render?: FC<ChatMessage>;
}
type RenderAction = FC<ChatActionsBarProps & ChatMessage>;
interface ListItemProps {
  groupNav?: ChatItemProps['avatarAddon'];
  loading?: boolean;
  /**
   * @description 点击操作按钮的回调函数
   */
  onActionsClick?: OnActionsClick;
  onAvatarsClick?: OnAvatatsClick;
  /**
   * @description 消息变化的回调函数
   */
  onMessageChange?: OnMessageChange;
  renderActions?: {
    [actionKey: string]: RenderAction;
  };
  /**
   * @description 渲染错误消息的函数
   */
  renderErrorMessages?: {
    [errorType: 'default' | string]: RenderErrorMessage;
  };
  renderItems?: {
    [role: RenderRole]: RenderItem;
  };
  /**
   * @description 渲染消息的函数
   */
  renderMessages?: {
    [role: RenderRole]: RenderMessage;
  };
  /**
   * @description 渲染消息额外内容的函数
   */
  renderMessagesExtra?: {
    [role: RenderRole]: RenderMessageExtra;
  };
  showAvatar?: boolean;
  /**
   * @description 是否显示聊天项的名称
   * @default false
   */
  showTitle?: boolean;
  /**
   * @description 文本内容
   */
  text?: ChatItemProps['text'] & ChatActionsBarProps['text'] & {
    copySuccess?: string;
    history?: string;
  } & {
    [key: string]: string;
  };
  /**
   * @description 聊天列表的类型
   * @default 'bubble'
   */
  variant?: 'docs' | 'bubble';
}
interface ChatListProps extends DivProps, ListItemProps {
  data: ChatMessage[];
  enableHistoryCount?: boolean;
  historyCount?: number;
  loadingId?: string;
}
interface ChatActionsBarProps extends ActionIconGroupProps {
  text?: {
    copy?: string;
    delete?: string;
    edit?: string;
    regenerate?: string;
  };
}
//#endregion
export { ChatActionsBarProps, ChatListProps, ListItemProps, OnActionsClick, OnAvatatsClick, OnMessageChange, RenderAction, RenderErrorMessage, RenderItem, RenderMessage, RenderMessageExtra, RenderRole };
//# sourceMappingURL=type.d.mts.map