import { ErrorType } from "./error.mjs";
import { LLMRoleType } from "./llm.mjs";
import { BaseDataModel } from "./meta.mjs";
//#region src/chat/types/chatMessage.d.ts
/**
 * 聊天消息错误对象
 */
interface ChatMessageError {
  body?: any;
  message: string;
  type: ErrorType;
}
interface OpenAIFunctionCall {
  arguments?: string;
  name: string;
}
interface ChatMessage extends BaseDataModel {
  /**
   * @title 内容
   * @description 消息内容
   */
  content: string;
  error?: ChatMessageError;
  extra?: any;
  /**
   * replace with plugin
   * @deprecated
   */
  function_call?: OpenAIFunctionCall;
  name?: string;
  parentId?: string;
  plugin?: any;
  quotaId?: string;
  /**
   * 角色
   * @description 消息发送者的角色
   */
  role: LLMRoleType;
  /**
   * 保存到主题的消息
   */
  topicId?: string;
}
type ChatMessageMap = Record<string, ChatMessage>;
//#endregion
export { ChatMessage, ChatMessageError, ChatMessageMap, OpenAIFunctionCall };
//# sourceMappingURL=chatMessage.d.mts.map