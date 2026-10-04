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
  nextMountIndex,
  visibleRange,
  type RenderedMessage,
} from "./MessageList";

vi.mock("@/components/ai/chat-parts", () => ({
  MessageItem: ({ msg, expansionScope }: { msg: ChatMessage; expansionScope?: string }) => (
    <div data-testid="message-item" data-scope={expansionScope}>{msg.id}</div>
  ),
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
  chatId: string | null;
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

  it("keeps the reader's place when switching chats away from the bottom", () => {
    const view = render(<Harness messages={conversation(30)} chatId="chat-a" nearBottom={false} />);
    const scroll = view.getByTestId("scroll");
    const values = { top: 300, height: 500, scrollHeight: 4_000 };
    geometry(scroll, values);

    view.rerender(<Harness messages={conversation(12)} chatId="chat-b" nearBottom={false} />);

    expect(values.top).toBe(300);
    const expected = visibleRange(messageOffsets(conversation(12), new Map()), 300, 500).visible;
    expect(scroll.dataset.chatVisibleIndex).toBe(String(expected));
  });

  it("marks the last row visible when a new chat has not laid out yet", () => {
    const view = render(<Harness messages={conversation(5)} chatId="chat-a" nearBottom />);
    const scroll = view.getByTestId("scroll");
    geometry(scroll, { top: 0, height: 0, scrollHeight: 0 });

    view.rerender(<Harness messages={conversation(7)} chatId="chat-b" nearBottom />);

    expect(scroll.dataset.chatVisibleIndex).toBe("6");
  });

  it("jumps to the first row when the request names no index, and sets scrollTop without scrollTo", () => {
    const view = render(<Harness messages={conversation(40)} chatId="chat-a" nearBottom={false} />);
    const scroll = view.getByTestId("scroll");
    const values = { top: 3_000, height: 500 };
    Object.defineProperties(scroll, {
      scrollTop: { configurable: true, get: () => values.top, set: (value: number) => { values.top = value; } },
      clientHeight: { configurable: true, get: () => values.height },
      scrollTo: { configurable: true, value: undefined },
    });

    act(() => {
      scroll.dispatchEvent(new CustomEvent(CHAT_SCROLL_TO_INDEX_EVENT));
    });

    expect(values.top).toBe(0);
    expect(scroll.dataset.chatVisibleIndex).toBe("0");
    expect(view.container.querySelector('[data-mm-index="0"]')).not.toBeNull();
  });

  it("keeps rows above the viewport from shifting what the reader sees", () => {
    const view = render(<Harness messages={conversation(12)} chatId="chat-a" nearBottom={false} />);
    const scroll = view.getByTestId("scroll");
    const values = { top: 2_000, height: 500, scrollHeight: 9_000 };
    geometry(scroll, values);
    const current = resizeObserver;
    if (!current) throw new Error("missing resize observer");
    const rows = [...current.elements] as HTMLElement[];
    const firstRow = rows.find((row) => row.dataset.mmIndex === "2") as HTMLElement;
    const estimate = estimateMessageHeight(conversation(12)[2].msg);

    act(() => {
      current.callback([
        { target: firstRow, contentRect: { height: 0 }, borderBoxSize: [{ blockSize: estimate + 100 }] },
      ] as unknown as ResizeObserverEntry[], current as unknown as ResizeObserver);
    });

    expect(values.top).toBe(2_100);
  });

  it("ignores resize notices for unknown rows and unchanged heights", () => {
    const view = render(<Harness messages={conversation(4)} chatId="chat-a" nearBottom />);
    const scroll = view.getByTestId("scroll");
    const values = { top: 100, height: 500, scrollHeight: 2_000 };
    geometry(scroll, values);
    const current = resizeObserver;
    if (!current) throw new Error("missing resize observer");
    const row = [...current.elements][1] as HTMLElement;
    const stranger = document.createElement("div");
    const orphan = document.createElement("div");
    orphan.dataset.messageKey = "gone";
    orphan.dataset.mmIndex = "99";
    const same = estimateMessageHeight(conversation(4)[1].msg);

    act(() => {
      current.callback([
        { target: stranger, contentRect: { height: 500 }, borderBoxSize: [] },
        { target: orphan, contentRect: { height: 500 }, borderBoxSize: [] },
        { target: row, contentRect: { height: same }, borderBoxSize: [] },
      ] as unknown as ResizeObserverEntry[], current as unknown as ResizeObserver);
    });

    expect(values.top).toBe(100);
  });

  it("renders without a ResizeObserver and scopes rows to an unnamed chat", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { container } = render(<Harness messages={conversation(3)} chatId={null} nearBottom />);

    expect(container.querySelectorAll('[data-testid="message-item"]')).toHaveLength(3);
    expect(container.querySelector('[data-testid="message-item"]')).toHaveAttribute("data-scope", "chat:m-0");
  });

  it("mounts the previous page of rows above a mounted index", () => {
    const messages = conversation(25);

    expect(nextMountIndex(messages, 18)).toBe(8);
    expect(nextMountIndex(messages, 4)).toBe(0);
    expect(nextMountIndex(messages, 99)).toBe(15);
  });
});
