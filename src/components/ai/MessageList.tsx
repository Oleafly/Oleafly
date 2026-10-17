import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import type { ChatMessage } from "@/store/chats";
import type { ResearchChatActions } from "@/lib/chat-activity";
import { MessageItem } from "@/components/ai/chat-parts";
import { liveMessageFor, type LiveMessageStore } from "@/components/ai/live-message";

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
const MIN_INITIAL_ROWS = 2;
const INITIAL_HEIGHT_PX = 2_400;
const OVERSCAN_PX = 800;
const ROW_GAP = 12;

const estimates = new WeakMap<ChatMessage, number>();

export function estimateMessageHeight(msg: ChatMessage): number {
  const cached = estimates.get(msg);
  if (cached !== undefined) return cached;
  const estimate = computeMessageHeight(msg);
  estimates.set(msg, estimate);
  return estimate;
}

function computeMessageHeight(msg: ChatMessage): number {
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
  const floor = Math.max(0, messages.length - INITIAL_ROWS);
  let height = 0;
  for (let index = messages.length - 1; index > floor; index--) {
    height += estimateMessageHeight(messages[index].msg) + ROW_GAP;
    if (height >= INITIAL_HEIGHT_PX && messages.length - index >= MIN_INITIAL_ROWS) return index;
  }
  return floor;
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

const noSubscription = () => () => {};

const MessageRow = memo(function MessageRow({
  entry,
  isLast,
  chatId,
  actions,
  renderExtras,
  live,
}: Readonly<{
  entry: RenderedMessage;
  isLast: boolean;
  chatId: string | null;
  actions?: ResearchChatActions;
  renderExtras?: (entry: RenderedMessage) => ReactNode;
  live?: LiveMessageStore;
}>) {
  const current = () => liveMessageFor(entry.msg, live?.get() ?? null);
  const msg = useSyncExternalStore(live?.subscribe ?? noSubscription, current, current);
  const shown = msg === entry.msg ? entry : { ...entry, msg };
  return (
    <div
      data-chat-message-row
      data-message-key={entry.key}
      data-message-role={msg.role}
      data-mm-index={entry.index}
      className="min-w-0"
      style={{ marginBottom: isLast ? 0 : ROW_GAP }}
    >
      <MessageItem
        msg={msg}
        live={entry.live}
        actions={actions}
        expansionScope={`${chatId ?? "chat"}:${entry.key}`}
      />
      {renderExtras?.(shown)}
    </div>
  );
});

export function MessageList({
  messages,
  chatId,
  scrollRef,
  nearBottomRef,
  renderExtras,
  actions,
  live,
}: Readonly<{
  messages: readonly RenderedMessage[];
  chatId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  nearBottomRef: MutableRefObject<boolean>;
  renderExtras?: (entry: RenderedMessage) => ReactNode;
  actions?: ResearchChatActions;
  live?: LiveMessageStore;
}>) {
  const heightsRef = useRef(new Map<string, number>());
  const heightsVersionRef = useRef(0);
  const [windowState, setWindowState] = useState(() => ({
    chatId,
    count: messages.length,
    start: initialMountIndex(messages),
    end: messages.length,
  }));
  let windowRange = windowState;
  if (windowState.chatId !== chatId) {
    windowRange = { chatId, count: messages.length, start: initialMountIndex(messages), end: messages.length };
    setWindowState(windowRange);
  } else if (windowState.count !== messages.length) {
    const atEnd = windowState.end >= windowState.count && messages.length > windowState.count;
    windowRange = { ...windowState, count: messages.length, end: atEnd ? messages.length : windowState.end };
    setWindowState(windowRange);
  }
  const windowRef = useRef(windowRange);
  windowRef.current = windowRange;
  const setWindowRange = useCallback((next: { start: number; end: number }) => {
    if (windowRef.current.start === next.start && windowRef.current.end === next.end) return;
    windowRef.current = { ...windowRef.current, ...next };
    setWindowState((current) =>
      current.start === next.start && current.end === next.end ? current : { ...current, ...next },
    );
  }, []);
  const previousChatRef = useRef<string | null | undefined>(undefined);
  const previousCountRef = useRef(messages.length);
  const visibleIndexRef = useRef<number | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const offsetsCacheRef = useRef<{
    messages: readonly RenderedMessage[];
    version: number;
    offsets: number[];
  } | null>(null);
  const currentOffsets = useCallback(() => {
    const cached = offsetsCacheRef.current;
    const version = heightsVersionRef.current;
    if (cached && cached.messages === messagesRef.current && cached.version === version) {
      return cached.offsets;
    }
    const offsets = messageOffsets(messagesRef.current, heightsRef.current);
    offsetsCacheRef.current = { messages: messagesRef.current, version, offsets };
    return offsets;
  }, []);
  const offsets = currentOffsets();

  const updateWindow = useCallback((urgent = false) => {
    const element = scrollRef.current;
    if (!element) return;
    const offsetsNow = currentOffsets();
    const next = visibleRange(offsetsNow, element.scrollTop, element.clientHeight);
    element.dataset.chatVisibleIndex = String(next.visible);
    if (visibleIndexRef.current !== next.visible) {
      visibleIndexRef.current = next.visible;
      element.dispatchEvent(new CustomEvent("oleafly:chat-visible-index", { detail: next.visible }));
    }
    const apply = () => setWindowRange({ start: next.start, end: next.end });
    if (!urgent) {
      apply();
      return;
    }
    const shown = visibleRange(offsetsNow, element.scrollTop, element.clientHeight, 0);
    const mounted = windowRef.current;
    if (mounted.start <= shown.start && mounted.end >= shown.end) apply();
    else flushSync(apply);
  }, [currentOffsets, scrollRef, setWindowRange]);

  const count = messages.length;
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const switched = previousChatRef.current !== chatId;
    const appended = previousCountRef.current < count;
    previousChatRef.current = chatId;
    previousCountRef.current = count;
    if (switched) {
      heightsRef.current = new Map();
      heightsVersionRef.current += 1;
      visibleIndexRef.current = null;
      requestAnimationFrame(() => {
        if (nearBottomRef.current && element.scrollHeight <= 0) {
          element.dataset.chatVisibleIndex = String(Math.max(0, count - 1));
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
  }, [chatId, count, nearBottomRef, scrollRef, updateWindow]);

  const observedWindow = `${windowRange.start}:${windowRange.end}:${count}`;
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onScroll = () => updateWindow(true);
    const scrollToIndex = (event: Event) => {
      const detail = (event as CustomEvent<{ index?: number; behavior?: ScrollBehavior }>).detail;
      const index = Math.max(0, Math.min(messagesRef.current.length - 1, detail?.index ?? 0));
      const offsetsNow = currentOffsets();
      const top = offsetsNow[index] ?? 0;
      const next = visibleRange(offsetsNow, top, element.clientHeight);
      setWindowRange({ start: next.start, end: next.end });
      setScrollTop(element, Math.max(0, top - 12), detail?.behavior);
      element.dataset.chatVisibleIndex = String(index);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener(CHAT_SCROLL_TO_INDEX_EVENT, scrollToIndex);
    return () => {
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener(CHAT_SCROLL_TO_INDEX_EVENT, scrollToIndex);
    };
  }, [currentOffsets, scrollRef, setWindowRange, updateWindow]);

  useEffect(() => {
    void observedWindow;
    if (typeof ResizeObserver === "undefined") return;
    const element = scrollRef.current;
    if (!element) return;
    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      let anchorDelta = 0;
      const offsetsBefore = currentOffsets();
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
        if (!nearBottomRef.current && (offsetsBefore[index + 1] ?? 0) <= element.scrollTop) {
          anchorDelta += height - previous;
        }
      }
      if (!changed) return;
      heightsVersionRef.current += 1;
      if (anchorDelta) element.scrollTop += anchorDelta;
      if (nearBottomRef.current) setScrollTop(element, element.scrollHeight);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => updateWindow());
    });
    const rows = element.querySelectorAll<HTMLElement>("[data-chat-message-row]");
    rows.forEach((row) => {
      observer.observe(row);
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [currentOffsets, scrollRef, nearBottomRef, observedWindow, updateWindow]);

  const start = Math.max(0, Math.min(windowRange.start, count));
  const end = Math.max(start, Math.min(windowRange.end, count));
  const top = offsets[start] ?? 0;
  const total = offsets[count] ?? 0;
  const bottom = Math.max(0, total - (offsets[end] ?? total));

  return (
    <div data-testid="message-window" className="min-w-0">
      {top > 0 && <div data-message-spacer="top" aria-hidden style={{ height: top }} />}
      {messages.slice(start, end).map((entry) => (
        <MessageRow
          key={entry.key}
          entry={entry}
          isLast={entry.index === count - 1}
          chatId={chatId}
          actions={actions}
          renderExtras={renderExtras}
          live={live}
        />
      ))}
      {bottom > 0 && <div data-message-spacer="bottom" aria-hidden style={{ height: bottom }} />}
    </div>
  );
}
