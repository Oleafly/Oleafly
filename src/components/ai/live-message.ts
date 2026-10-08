import type { ChatMessage } from "@/store/chats";

export type LiveMessage = Readonly<{
  base: ChatMessage;
  message: ChatMessage;
}>;

export interface LiveMessageStore {
  get: () => LiveMessage | null;
  set: (next: LiveMessage | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createLiveMessageStore(): LiveMessageStore {
  let current: LiveMessage | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next) => {
      if (next === current) return;
      if (next === null && current === null) return;
      current = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const TEXT_FIELDS: ReadonlySet<string> = new Set(["content", "reasoning", "reasoningBlocks"]);
const STREAM_FIELDS: ReadonlySet<string> = new Set([...TEXT_FIELDS, "toolCalls", "notices"]);

function sameExcept(base: ChatMessage, next: ChatMessage, fields: ReadonlySet<string>): boolean {
  const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
  for (const key of keys) {
    if (fields.has(key)) continue;
    if (base[key as keyof ChatMessage] !== next[key as keyof ChatMessage]) return false;
  }
  return true;
}

function sameReasoningShape(base: ChatMessage, next: ChatMessage): boolean {
  const before = base.reasoningBlocks ?? [];
  const after = next.reasoningBlocks ?? [];
  if (before.length !== after.length) return false;
  return before.every(
    (block, index) =>
      block.id === after[index].id &&
      block.ms === after[index].ms &&
      block.beforeTool === after[index].beforeTool,
  );
}

function sameTools(base: ChatMessage, next: ChatMessage): boolean {
  const before = base.toolCalls ?? [];
  const after = next.toolCalls ?? [];
  return before.length === after.length && before.every((tool, index) => tool.id === after[index].id);
}

export function differsOnlyInText(base: ChatMessage, next: ChatMessage): boolean {
  if (base === next) return false;
  return sameExcept(base, next, TEXT_FIELDS) && sameReasoningShape(base, next);
}

export function differsOnlyInStream(base: ChatMessage, next: ChatMessage): boolean {
  if (base === next) return false;
  return sameExcept(base, next, STREAM_FIELDS) && sameReasoningShape(base, next) && sameTools(base, next);
}

export function textOnlyChange(
  committed: readonly ChatMessage[],
  next: readonly ChatMessage[],
): LiveMessage | null {
  const base = committed.at(-1);
  const message = next.at(-1);
  if (!base || !message || committed.length !== next.length) return null;
  if (!differsOnlyInText(base, message)) return null;
  for (let index = 0; index < next.length - 1; index++) {
    if (next[index] !== committed[index]) return null;
  }
  return { base, message };
}

export interface LiveEntry {
  key: string;
  live: boolean;
  isLatestAssistant: boolean;
  msg: ChatMessage;
}

export function streamedEntryChange(
  committed: readonly LiveEntry[],
  next: readonly LiveEntry[],
): LiveMessage | null {
  if (committed.length !== next.length) return null;
  let change: LiveMessage | null = null;
  for (let index = next.length - 1; index >= 0; index--) {
    const before = committed[index];
    const after = next[index];
    if (before === after) continue;
    if (change) return null;
    if (
      before.key !== after.key ||
      before.live !== after.live ||
      before.isLatestAssistant !== after.isLatestAssistant ||
      !differsOnlyInStream(before.msg, after.msg)
    ) {
      return null;
    }
    change = { base: before.msg, message: after.msg };
  }
  return change;
}

export function liveMessageFor(msg: ChatMessage, live: LiveMessage | null): ChatMessage {
  return live?.base === msg ? live.message : msg;
}
