import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import type { ChatMessage } from "@/store/chats";
import { MessageItem } from "@/components/ai/chat-parts";

export interface RenderedMessage {
  key: string;
  index: number;
  live: boolean;
  isLatestAssistant: boolean;
  msg: ChatMessage;
}

const INITIAL_CHAR_BUDGET = 24_000;
const CHUNK_CHAR_BUDGET = 16_000;
const MIN_MESSAGES_PER_STEP = 2;
const MAX_MESSAGES_PER_STEP = 8;
const IDLE_FALLBACK_MS = 32;
const MIN_ESTIMATED_HEIGHT = 64;
const MAX_ESTIMATED_HEIGHT = 6_000;

function messageWeight(msg: ChatMessage): number {
  const reasoning = (msg.reasoningBlocks ?? []).reduce(
    (sum, block) => sum + block.text.length,
    msg.reasoning?.length ?? 0,
  );
  return msg.content.length + (msg.toolCalls?.length ?? 0) * 200 + reasoning / 4;
}

function mountIndexWithin(
  messages: readonly RenderedMessage[],
  from: number,
  budget: number,
): number {
  let index = from;
  let weight = 0;
  let count = 0;
  while (index > 0) {
    const next = messageWeight(messages[index - 1].msg);
    if (
      count >= MIN_MESSAGES_PER_STEP &&
      (count >= MAX_MESSAGES_PER_STEP || weight + next > budget)
    ) {
      break;
    }
    index--;
    count++;
    weight += next;
  }
  return index;
}

export function initialMountIndex(messages: readonly RenderedMessage[]): number {
  return mountIndexWithin(messages, messages.length, INITIAL_CHAR_BUDGET);
}

export function nextMountIndex(messages: readonly RenderedMessage[], from: number): number {
  return mountIndexWithin(messages, Math.min(from, messages.length), CHUNK_CHAR_BUDGET);
}

export function estimateMessageHeight(msg: ChatMessage): number {
  const lines = msg.content.split("\n").length + msg.content.length / 90;
  const tools = (msg.toolCalls?.length ?? 0) * 36;
  const estimate = 48 + lines * 20 + tools;
  return Math.round(Math.min(MAX_ESTIMATED_HEIGHT, Math.max(MIN_ESTIMATED_HEIGHT, estimate)));
}

function scheduleIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout: 500 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, IDLE_FALLBACK_MS);
  return () => window.clearTimeout(handle);
}


const heightEstimates = new WeakMap<object, number>();

function estimatedHeight(msg: ChatMessage): number {
  const known = heightEstimates.get(msg);
  if (known !== undefined) return known;
  const estimate = estimateMessageHeight(msg);
  heightEstimates.set(msg, estimate);
  return estimate;
}

function nativeScrollAnchoring(): boolean {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function"
    && CSS.supports("overflow-anchor", "auto");
}

export function MessageList({
  messages,
  chatId,
  scrollRef,
  nearBottomRef,
  renderExtras,
}: {
  messages: readonly RenderedMessage[];
  chatId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  nearBottomRef: MutableRefObject<boolean>;
  renderExtras?: (entry: RenderedMessage) => ReactNode;
}) {
  const [listKey, setListKey] = useState(chatId);
  const [mountedFrom, setMountedFrom] = useState(() => initialMountIndex(messages));
  if (listKey !== chatId) {
    setListKey(chatId);
    setMountedFrom(initialMountIndex(messages));
  }
  const from = Math.min(mountedFrom, messages.length);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const previousFromRef = useRef(from);

  useEffect(() => {
    if (from <= 0) return;
    return scheduleIdle(() => {
      startTransition(() => {
        setMountedFrom((current) => nextMountIndex(messagesRef.current, current));
      });
    });
  }, [from]);

  useLayoutEffect(() => {
    const previousFrom = previousFromRef.current;
    previousFromRef.current = from;
    if (from >= previousFrom) return;
    const el = scrollRef.current;
    if (!el) return;
    if (nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (nativeScrollAnchoring()) return;
    const boundary = el.querySelector<HTMLElement>(`[data-mm-index="${previousFrom}"]`);
    const first = el.querySelector<HTMLElement>(`[data-mm-index="${from}"]`);
    if (!boundary || !first) return;
    const renderedHeight = boundary.offsetTop - first.offsetTop;
    let estimatedTotal = 0;
    for (let index = from; index < previousFrom; index++) {
      const entry = messagesRef.current[index];
      if (entry) estimatedTotal += estimatedHeight(entry.msg);
    }
    const delta = renderedHeight - estimatedTotal;
    if (delta === 0) return;
    const regionBottomBefore = boundary.offsetTop - delta;
    if (regionBottomBefore <= el.scrollTop + 1) el.scrollTop += delta;
  }, [from, nearBottomRef, scrollRef]);

  return (
    <>
      {messages.map((entry) => {
        const { key, index, msg, live } = entry;
        const estimate = estimatedHeight(msg);
        if (index < from) {
          return (
            <div
              key={key}
              data-message-role={msg.role}
              data-mm-index={index}
              data-message-pending="true"
              aria-hidden="true"
              className="min-w-0"
              style={{ height: estimate }}
            />
          );
        }
        return (
          <div
            key={key}
            data-message-role={msg.role}
            data-mm-index={index}
            className="min-w-0 [content-visibility:auto]"
            style={{ containIntrinsicSize: `auto ${estimate}px` }}
          >
            <MessageItem msg={msg} live={live} />
            {renderExtras?.(entry)}
          </div>
        );
      })}
    </>
  );
}
