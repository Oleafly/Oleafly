// @vitest-environment jsdom

import { useLayoutEffect, useRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/store/chats";
import { createLiveMessageStore, type LiveMessageStore } from "./live-message";
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

const itemRenders = vi.hoisted(() => new Map<string, number>());

vi.mock("@/components/ai/chat-parts", async () => {
  const { memo } = await import("react");
  return {
    MessageItem: memo(function MessageItem({ msg, expansionScope }: { msg: ChatMessage; expansionScope?: string }) {
      itemRenders.set(msg.id ?? "", (itemRenders.get(msg.id ?? "") ?? 0) + 1);
      return (
        <div data-testid="message-item" data-scope={expansionScope} data-content={msg.content}>
          {msg.id}
        </div>
      );
    }),
  };
});

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

let extrasRenders = 0;

function Harness({ messages, chatId, nearBottom, live, onCommit }: {
  messages: RenderedMessage[];
  chatId: string | null;
  nearBottom: boolean;
  live?: LiveMessageStore;
  onCommit?: (container: HTMLDivElement | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(nearBottom);
  nearBottomRef.current = nearBottom;
  useLayoutEffect(() => {
    onCommit?.(scrollRef.current);
  });
  return (
    <div ref={scrollRef} data-testid="scroll">
      <MessageList
        messages={messages}
        chatId={chatId}
        scrollRef={scrollRef}
        nearBottomRef={nearBottomRef}
        live={live}
        renderExtras={(entry) => {
          extrasRenders += 1;
          return <span data-testid="extras">{entry.index}</span>;
        }}
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
    itemRenders.clear();
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

  it("estimates each message once while its content stays the same", () => {
    let reads = 0;
    const messages = conversation(60).map((entry) => {
      const content = entry.msg.content;
      const msg = { ...entry.msg } as ChatMessage;
      Object.defineProperty(msg, "content", {
        get: () => {
          if (entry.index < 40) reads += 1;
          return content;
        },
      });
      return { ...entry, msg };
    });
    const view = render(<Harness messages={messages} chatId="chat-a" nearBottom />);
    const afterMount = reads;

    view.rerender(<Harness messages={[...messages]} chatId="chat-a" nearBottom />);
    view.rerender(<Harness messages={messages.map((entry) => ({ ...entry }))} chatId="chat-a" nearBottom />);

    expect(afterMount).toBeGreaterThan(0);
    expect(reads).toBe(afterMount);
  });

  it("renders streamed text into the newest row without rendering the other rows", () => {
    const messages = conversation(8);
    const live = createLiveMessageStore();
    const view = render(<Harness messages={messages} chatId="chat-a" nearBottom live={live} />);
    const newest = messages[7].msg;
    const before = new Map(itemRenders);

    act(() => live.set({ base: newest, message: { ...newest, content: "Streamed so far" } }));

    expect(view.container.querySelector('[data-mm-index="7"] [data-testid="message-item"]'))
      .toHaveAttribute("data-content", "Streamed so far");
    expect(itemRenders.get("m-7")).toBe((before.get("m-7") ?? 0) + 1);
    for (const index of [0, 1, 2, 3, 4, 5, 6]) {
      expect(itemRenders.get(`m-${index}`)).toBe(before.get(`m-${index}`));
    }
  });

  it("renders a streamed change into the one row it belongs to and skips the extras of every other row", () => {
    const messages = conversation(8);
    const live = createLiveMessageStore();
    const view = render(<Harness messages={messages} chatId="chat-a" nearBottom live={live} />);
    const tool = messages[5].msg;
    const before = new Map(itemRenders);
    const extrasBefore = extrasRenders;

    act(() => live.set({ base: tool, message: { ...tool, content: "Tool output so far" } }));

    expect(view.container.querySelector('[data-mm-index="5"] [data-testid="message-item"]'))
      .toHaveAttribute("data-content", "Tool output so far");
    expect(itemRenders.get("m-5")).toBe((before.get("m-5") ?? 0) + 1);
    for (const index of [0, 1, 2, 3, 4, 6, 7]) {
      expect(itemRenders.get(`m-${index}`)).toBe(before.get(`m-${index}`));
    }
    expect(extrasRenders).toBe(extrasBefore + 1);

    act(() => live.set(null));

    expect(view.container.querySelector('[data-mm-index="5"] [data-testid="message-item"]'))
      .toHaveAttribute("data-content", tool.content);
    expect(extrasRenders).toBe(extrasBefore + 2);
  });

  it("drops streamed text once the conversation moves past the message it started from", () => {
    const messages = conversation(4);
    const live = createLiveMessageStore();
    const view = render(<Harness messages={messages} chatId="chat-a" nearBottom live={live} />);
    act(() => live.set({ base: messages[3].msg, message: { ...messages[3].msg, content: "stale" } }));

    const replaced = messages.map((entry, index) =>
      index === 3 ? { ...entry, msg: { ...entry.msg, content: "final" } } : entry,
    );
    view.rerender(<Harness messages={replaced} chatId="chat-a" nearBottom live={live} />);

    expect(view.container.querySelector('[data-mm-index="3"] [data-testid="message-item"]'))
      .toHaveAttribute("data-content", "final");
  });

  it("keeps the list from rendering again when a mounted row grows", () => {
    const view = render(<Harness messages={conversation(20)} chatId="chat-a" nearBottom />);
    const scroll = view.getByTestId("scroll");
    const values = { top: 100, height: 500, scrollHeight: 8_000 };
    geometry(scroll, values);
    const current = resizeObserver;
    if (!current) throw new Error("missing resize observer");
    const row = [...current.elements].at(-1) as HTMLElement;
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const before = extrasRenders;

    act(() => {
      current.callback([
        { target: row, contentRect: { height: 0 }, borderBoxSize: [{ blockSize: 900 }] },
      ] as unknown as ResizeObserverEntry[], current as unknown as ResizeObserver);
    });

    expect(values.top).toBe(8_000);
    expect(extrasRenders).toBe(before);
  });

  it("mounts the rows for a scroll position before the next frame", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const view = render(<Harness messages={conversation(200)} chatId="chat-a" nearBottom={false} />);
    const scroll = view.getByTestId("scroll");
    geometry(scroll, { top: 0, height: 500, scrollHeight: 30_000 });

    fireEvent.scroll(scroll);

    expect(view.container.querySelector('[data-mm-index="0"]')).not.toBeNull();
    expect(scroll.dataset.chatVisibleIndex).toBe("0");
  });

  it("announces the visible row only when it changes", () => {
    const view = render(<Harness messages={conversation(200)} chatId="chat-a" nearBottom={false} />);
    const scroll = view.getByTestId("scroll");
    const values = { top: 0, height: 500, scrollHeight: 30_000 };
    geometry(scroll, values);
    const announced: number[] = [];
    scroll.addEventListener("oleafly:chat-visible-index", (event) => {
      announced.push((event as CustomEvent<number>).detail);
    });

    values.top = 2;
    fireEvent.scroll(scroll);
    values.top = 15_000;
    fireEvent.scroll(scroll);
    fireEvent.scroll(scroll);

    const expected = visibleRange(messageOffsets(conversation(200), new Map()), 15_000, 500).visible;
    expect(announced).toEqual([expected]);
  });

  it("leaves the reader in place while a row they are reading grows below them", () => {
    const messages = conversation(12);
    const view = render(<Harness messages={messages} chatId="chat-a" nearBottom={false} />);
    const scroll = view.getByTestId("scroll");
    const offsets = messageOffsets(messages, new Map());
    const values = { top: offsets[11] + 40, height: 500, scrollHeight: 9_000 };
    geometry(scroll, values);
    fireEvent.scroll(scroll);
    const current = resizeObserver;
    if (!current) throw new Error("missing resize observer");
    const newest = [...current.elements].find((row) => (row as HTMLElement).dataset.mmIndex === "11");

    act(() => {
      current.callback([
        { target: newest, contentRect: { height: 0 }, borderBoxSize: [{ blockSize: 2_000 }] },
      ] as unknown as ResizeObserverEntry[], current as unknown as ResizeObserver);
    });

    expect(values.top).toBe(offsets[11] + 40);
  });

  it("mounts only enough of the newest long replies to fill the first screen", () => {
    const view = render(<Harness messages={conversation(50, 20_000)} chatId="chat-a" nearBottom />);

    expect(view.container.querySelectorAll('[data-testid="message-item"]')).toHaveLength(2);
    expect(view.container.querySelector('[data-mm-index="49"]')).not.toBeNull();
  });

  it("renders the newest rows of another conversation in the same commit as the switch", () => {
    const view = render(<Harness messages={conversation(80)} chatId="chat-a" nearBottom />);
    const next = conversation(35).map((entry) => ({
      ...entry,
      key: `b-${entry.index}`,
      msg: { ...entry.msg, id: `b-${entry.index}` },
    }));
    let newestAtCommit: boolean | null = null;

    view.rerender(
      <Harness
        messages={next}
        chatId="chat-b"
        nearBottom
        onCommit={(container) => {
          newestAtCommit ??= container?.querySelector('[data-mm-index="34"]') !== null;
        }}
      />,
    );

    expect(newestAtCommit).toBe(true);
    expect(itemRenders.get("b-34")).toBe(1);
  });

  it("mounts an appended message in the same commit when the window reaches the end", () => {
    const view = render(<Harness messages={conversation(20)} chatId="chat-a" nearBottom />);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });

    view.rerender(<Harness messages={conversation(21)} chatId="chat-a" nearBottom />);

    expect(view.container.querySelector('[data-mm-index="20"]')).not.toBeNull();
  });

  it("mounts the previous page of rows above a mounted index", () => {
    const messages = conversation(25);

    expect(nextMountIndex(messages, 18)).toBe(8);
    expect(nextMountIndex(messages, 4)).toBe(0);
    expect(nextMountIndex(messages, 99)).toBe(15);
  });
});
