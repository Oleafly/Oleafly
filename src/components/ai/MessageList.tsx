import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import type { ChatMessage } from "@/store/chats";
import type { ResearchChatActions } from "@/lib/chat-activity";
import { MessageItem } from "@/components/ai/chat-parts";

export interface RenderedMessage {
  key: string;
  index: number;
  live: boolean;
  isLatestAssistant: boolean;
  msg: ChatMessage;
}

export const CHAT_SCROLL_TO_INDEX_EVENT = "oleafly:chat-scroll-to-index";
const MIN_ESTIMATED_HEIGHT = 64;
const MAX_ESTIMATED_HEIGHT = 6_000;
const INITIAL_ROWS = 10;
const OVERSCAN_PX = 800;
const ROW_GAP = 12;

export function estimateMessageHeight(msg: ChatMessage): number {
  const contentLines = msg.content.split("\n").length + msg.content.length / 90;
  const reasoningChars = (msg.reasoningBlocks ?? []).reduce(
    (sum, block) => sum + block.text.length,
    msg.reasoning?.length ?? 0,
  );
  const reasoningLines = reasoningChars / 120;
  const tools = (msg.toolCalls?.length ?? 0) * 48;
  const estimate = 48 + (contentLines + reasoningLines) * 20 + tools;
  return Math.round(Math.min(MAX_ESTIMATED_HEIGHT, Math.max(MIN_ESTIMATED_HEIGHT, estimate)));
}

export function initialMountIndex(messages: readonly RenderedMessage[]): number {
  return Math.max(0, messages.length - INITIAL_ROWS);
}

export function nextMountIndex(messages: readonly RenderedMessage[], from: number): number {
  return Math.max(0, Math.min(from, messages.length) - INITIAL_ROWS);
}

export function messageOffsets(
  messages: readonly RenderedMessage[],
  measured: ReadonlyMap<string, number>,
): number[] {
  const offsets = new Array<number>(messages.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < messages.length; index++) {
    const height = measured.get(messages[index].key) ?? estimateMessageHeight(messages[index].msg);
    offsets[index + 1] = offsets[index] + height + (index + 1 < messages.length ? ROW_GAP : 0);
  }
  return offsets;
}

function indexAtOffset(offsets: readonly number[], value: number): number {
  let low = 0;
  let high = Math.max(0, offsets.length - 2);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function visibleRange(
  offsets: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  overscan = OVERSCAN_PX,
): { start: number; end: number; visible: number } {
  const count = Math.max(0, offsets.length - 1);
  if (count === 0) return { start: 0, end: 0, visible: 0 };
  const visible = indexAtOffset(offsets, Math.max(0, scrollTop));
  const start = indexAtOffset(offsets, Math.max(0, scrollTop - overscan));
  const last = indexAtOffset(offsets, Math.max(0, scrollTop + viewportHeight + overscan));
  return { start, end: Math.min(count, last + 1), visible };
}

function setScrollTop(element: HTMLDivElement, top: number, behavior?: ScrollBehavior) {
  if (typeof element.scrollTo === "function") element.scrollTo({ top, behavior });
  else element.scrollTop = top;
}

export function MessageList({
  messages,
  chatId,
  scrollRef,
  nearBottomRef,
  renderExtras,
  actions,
}: {
  messages: readonly RenderedMessage[];
  chatId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  nearBottomRef: MutableRefObject<boolean>;
  renderExtras?: (entry: RenderedMessage) => ReactNode;
  actions?: ResearchChatActions;
}) {
  const heightsRef = useRef(new Map<string, number>());
  const [measureVersion, bumpMeasureVersion] = useReducer((value) => value + 1, 0);
  const [windowRange, setWindowRange] = useState(() => ({
    start: initialMountIndex(messages),
    end: messages.length,
  }));
  const previousChatRef = useRef<string | null | undefined>(undefined);
  const previousCountRef = useRef(messages.length);
  void measureVersion;
  const offsets = messageOffsets(messages, heightsRef.current);
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const updateWindow = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const next = visibleRange(offsetsRef.current, element.scrollTop, element.clientHeight);
    element.dataset.chatVisibleIndex = String(next.visible);
    element.dispatchEvent(new CustomEvent("oleafly:chat-visible-index", { detail: next.visible }));
    setWindowRange((current) => current.start === next.start && current.end === next.end
      ? current
      : { start: next.start, end: next.end });
  }, [scrollRef]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const switched = previousChatRef.current !== chatId;
    const appended = previousCountRef.current < messages.length;
    previousChatRef.current = chatId;
    previousCountRef.current = messages.length;
    if (switched) {
      heightsRef.current = new Map();
      setWindowRange({ start: initialMountIndex(messages), end: messages.length });
      requestAnimationFrame(() => {
        if (nearBottomRef.current && element.scrollHeight <= 0) {
          element.dataset.chatVisibleIndex = String(Math.max(0, messages.length - 1));
          return;
        }
        if (nearBottomRef.current) setScrollTop(element, element.scrollHeight);
        updateWindow();
      });
      return;
    }
    if (appended && nearBottomRef.current) {
      requestAnimationFrame(() => {
        setScrollTop(element, element.scrollHeight);
        updateWindow();
      });
      return;
    }
    updateWindow();
  }, [chatId, messages, nearBottomRef, scrollRef, updateWindow]);

  const observedWindow = `${windowRange.start}:${windowRange.end}:${messages.length}`;
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateWindow);
    };
    const scrollToIndex = (event: Event) => {
      const detail = (event as CustomEvent<{ index?: number; behavior?: ScrollBehavior }>).detail;
      const index = Math.max(0, Math.min(messagesRef.current.length - 1, detail?.index ?? 0));
      const top = offsetsRef.current[index] ?? 0;
      const next = visibleRange(offsetsRef.current, top, element.clientHeight);
      setWindowRange({ start: next.start, end: next.end });
      setScrollTop(element, Math.max(0, top - 12), detail?.behavior);
      element.dataset.chatVisibleIndex = String(index);
    };
    element.addEventListener("scroll", schedule, { passive: true });
    element.addEventListener(CHAT_SCROLL_TO_INDEX_EVENT, scrollToIndex);
    return () => {
      element.removeEventListener("scroll", schedule);
      element.removeEventListener(CHAT_SCROLL_TO_INDEX_EVENT, scrollToIndex);
      cancelAnimationFrame(frame);
    };
  }, [scrollRef, updateWindow]);

  useEffect(() => {
    void observedWindow;
    if (typeof ResizeObserver === "undefined") return;
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      let anchorDelta = 0;
      const currentOffsets = offsetsRef.current;
      for (const entry of entries) {
        const row = entry.target as HTMLElement;
        const key = row.dataset.messageKey;
        const index = Number(row.dataset.mmIndex);
        if (!key || !Number.isInteger(index)) continue;
        const blockSize = entry.borderBoxSize[0]?.blockSize;
        const height = Math.max(MIN_ESTIMATED_HEIGHT, blockSize ?? entry.contentRect.height);
        const message = messagesRef.current[index];
        if (!message) continue;
        const previous = heightsRef.current.get(key) ?? estimateMessageHeight(message.msg);
        if (Math.abs(previous - height) < 1) continue;
        heightsRef.current.set(key, height);
        changed = true;
        if (!nearBottomRef.current && (currentOffsets[index] ?? 0) < element.scrollTop) {
          anchorDelta += height - previous;
        }
      }
      if (!changed) return;
      if (anchorDelta) element.scrollTop += anchorDelta;
      bumpMeasureVersion();
      if (nearBottomRef.current) {
        requestAnimationFrame(() => {
          setScrollTop(element, element.scrollHeight);
          updateWindow();
        });
      } else {
        requestAnimationFrame(updateWindow);
      }
    });
    const rows = element.querySelectorAll<HTMLElement>("[data-chat-message-row]");
    rows.forEach((row) => {
      observer.observe(row);
    });
    return () => observer.disconnect();
  }, [scrollRef, nearBottomRef, observedWindow, updateWindow]);

  const count = messages.length;
  const start = Math.max(0, Math.min(windowRange.start, count));
  const end = Math.max(start, Math.min(windowRange.end, count));
  const top = offsets[start] ?? 0;
  const total = offsets[count] ?? 0;
  const bottom = Math.max(0, total - (offsets[end] ?? total));

  return (
    <div data-testid="message-window" className="min-w-0">
      {top > 0 && <div data-message-spacer="top" aria-hidden style={{ height: top }} />}
      {messages.slice(start, end).map((entry) => {
        const { key, index, msg, live } = entry;
        const isLast = index === count - 1;
        return (
          <div
            key={key}
            data-chat-message-row
            data-message-key={key}
            data-message-role={msg.role}
            data-mm-index={index}
            className="min-w-0"
            style={{ marginBottom: isLast ? 0 : ROW_GAP }}
          >
            <MessageItem
              msg={msg}
              live={live}
              actions={actions}
              expansionScope={`${chatId ?? "chat"}:${key}`}
            />
            {renderExtras?.(entry)}
          </div>
        );
      })}
      {bottom > 0 && <div data-message-spacer="bottom" aria-hidden style={{ height: bottom }} />}
    </div>
  );
}
