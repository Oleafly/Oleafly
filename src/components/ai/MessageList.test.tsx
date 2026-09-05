// @vitest-environment jsdom

import { useRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/store/chats";
import {
  CHAT_SCROLL_TO_INDEX_EVENT,
  estimateMessageHeight,
  initialMountIndex,
  messageOffsets,
  MessageList,
  visibleRange,
  type RenderedMessage,
} from "./MessageList";

vi.mock("@/components/ai/chat-parts", () => ({
  MessageItem: ({ msg }: { msg: ChatMessage }) => <div data-testid="message-item">{msg.id}</div>,
}));

function conversation(count: number, chars = 100): RenderedMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `m-${index}`,
    index,
    live: index === count - 1,
    isLatestAssistant: index === count - 1,
    msg: {
      id: `m-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(chars),
    },
  }));
}

function geometry(element: HTMLElement, values: { top: number; height: number; scrollHeight: number }) {
  Object.defineProperties(element, {
    scrollTop: {
      configurable: true,
      get: () => values.top,
      set: (value: number) => { values.top = value; },
    },
    clientHeight: { configurable: true, get: () => values.height },
    scrollHeight: { configurable: true, get: () => values.scrollHeight },
    scrollTo: {
      configurable: true,
      value: ({ top }: ScrollToOptions) => { values.top = top ?? values.top; },
    },
  });
}

function Harness({ messages, chatId, nearBottom }: {
  messages: RenderedMessage[];
  chatId: string;
  nearBottom: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(nearBottom);
  nearBottomRef.current = nearBottom;
  return (
    <div ref={scrollRef} data-testid="scroll">
      <MessageList
        messages={messages}
        chatId={chatId}
        scrollRef={scrollRef}
        nearBottomRef={nearBottomRef}
        renderExtras={(entry) => <span data-testid="extras">{entry.index}</span>}
      />
    </div>
  );
}

let resizeObserver: {
  elements: Set<Element>;
  callback: ResizeObserverCallback;
  disconnected: boolean;
} | null = null;

describe("MessageList windowing", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("ResizeObserver", class {
      elements = new Set<Element>();
      disconnected = false;
      callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        resizeObserver = this;
      }

      observe = (element: Element) => { this.elements.add(element); };
      unobserve = (element: Element) => { this.elements.delete(element); };
      disconnect = () => {
        this.disconnected = true;
        this.elements.clear();
      };
    });
  });

  afterEach(() => {
    cleanup();
    resizeObserver = null;
    vi.unstubAllGlobals();
  });

  it("estimates rows and calculates a bounded visible range", () => {
    const messages = conversation(100);
    const offsets = messageOffsets(messages, new Map());
    const range = visibleRange(offsets, offsets[50], 500, 400);

    expect(initialMountIndex(messages)).toBe(90);
    expect(range.visible).toBe(50);
    expect(range.start).toBeLessThan(50);
    expect(range.end).toBeGreaterThan(50);
    expect(range.end - range.start).toBeLessThan(30);
    expect(estimateMessageHeight({ role: "assistant", content: "x".repeat(1_000_000) })).toBe(6000);
  });

  it("mounts only the newest window from a long history", () => {
    const { container } = render(<Harness messages={conversation(200)} chatId="chat-a" nearBottom />);

    expect(container.querySelectorAll('[data-testid="message-item"]')).toHaveLength(10);
    expect(container.querySelector('[data-message-spacer="top"]')).not.toBeNull();
    expect(container.querySelector('[data-mm-index="199"]')).not.toBeNull();
    expect(container.querySelector('[data-mm-index="0"]')).toBeNull();
  });

  it("mounts earlier rows when the reader scrolls back", () => {
    const view = render(<Harness messages={conversation(200)} chatId="chat-a" nearBottom={false} />);
    const scroll = view.getByTestId("scroll");
    const values = { top: 0, height: 500, scrollHeight: 30_000 };
    geometry(scroll, values);

    fireEvent.scroll(scroll);

    expect(view.container.querySelector('[data-mm-index="0"]')).not.toBeNull();
    expect(view.container.querySelector('[data-mm-index="199"]')).toBeNull();
    expect(view.container.querySelectorAll('[data-testid="message-item"]').length).toBeLessThan(30);
  });

  it("jumps to an unmounted row by index", () => {
    const messages = conversation(200);
    const view = render(<Harness messages={messages} chatId="chat-a" nearBottom={false} />);
    const scroll = view.getByTestId("scroll");
    const values = { top: 20_000, height: 500, scrollHeight: 30_000 };
    geometry(scroll, values);
    const offsets = messageOffsets(messages, new Map());

    act(() => {
      scroll.dispatchEvent(new CustomEvent(CHAT_SCROLL_TO_INDEX_EVENT, {
        detail: { index: 4 },
      }));
    });

    expect(values.top).toBe(Math.max(0, offsets[4] - 12));
    expect(view.container.querySelector('[data-mm-index="4"]')).not.toBeNull();
  });

  it("resets the window when the conversation changes", () => {
    const view = render(<Harness messages={conversation(80)} chatId="chat-a" nearBottom />);
    view.rerender(<Harness messages={conversation(35)} chatId="chat-b" nearBottom />);

    expect(view.container.querySelector('[data-mm-index="34"]')).not.toBeNull();
    expect(view.container.querySelector('[data-mm-index="79"]')).toBeNull();
    expect(view.container.querySelectorAll('[data-testid="message-item"]')).toHaveLength(10);
  });

  it("follows appended messages only while the reader is near the bottom", () => {
    const first = conversation(20);
    const view = render(<Harness messages={first} chatId="chat-a" nearBottom={false} />);
    const scroll = view.getByTestId("scroll");
    const values = { top: 250, height: 500, scrollHeight: 5_000 };
    geometry(scroll, values);
    view.rerender(<Harness messages={conversation(21)} chatId="chat-a" nearBottom={false} />);
    expect(values.top).toBe(250);

    values.scrollHeight = 5_400;
    view.rerender(<Harness messages={conversation(22)} chatId="chat-a" nearBottom />);
    expect(values.top).toBe(5_400);
  });

  it("remeasures a growing row, keeps the bottom pinned, and disconnects its observer", () => {
    const view = render(<Harness messages={conversation(20)} chatId="chat-a" nearBottom />);
    const scroll = view.getByTestId("scroll");
    const values = { top: 100, height: 500, scrollHeight: 8_000 };
    geometry(scroll, values);
    const current = resizeObserver;
    if (!current) throw new Error("missing resize observer");
    const row = [...current.elements].at(-1);
    if (!row) throw new Error("missing observed row");

    act(() => {
      current.callback([
        {
          target: row,
          contentRect: { height: 420 },
          borderBoxSize: [],
        } as unknown as ResizeObserverEntry,
      ], current as unknown as ResizeObserver);
    });

    expect(values.top).toBe(8_000);
    view.unmount();
    expect(current.disconnected).toBe(true);
  });
});
