// @vitest-environment jsdom

import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/store/chats";
import {
  estimateMessageHeight,
  initialMountIndex,
  MessageList,
  nextMountIndex,
  type RenderedMessage,
} from "./MessageList";

vi.mock("@/components/ai/chat-parts", () => ({
  MessageItem: ({ msg }: { msg: ChatMessage }) => (
    <div data-testid="message-item">{msg.id}</div>
  ),
}));

const idleCallbacks = new Map<number, IdleRequestCallback>();
let idleHandle = 0;

function flushIdle() {
  act(() => {
    const pending = [...idleCallbacks.entries()];
    idleCallbacks.clear();
    for (const [, callback] of pending) {
      callback({ didTimeout: false, timeRemaining: () => 50 });
    }
  });
}

function conversation(count: number, chars = 5_000): RenderedMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `m-${index}`,
    index,
    live: false,
    isLatestAssistant: index === count - 1,
    msg: {
      id: `m-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(chars),
    } as ChatMessage,
  }));
}

function Harness({
  messages,
  chatId,
  nearBottom,
}: {
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

function pendingCount(container: HTMLElement) {
  return container.querySelectorAll('[data-message-pending="true"]').length;
}

function mountedCount(container: HTMLElement) {
  return container.querySelectorAll('[data-testid="message-item"]').length;
}

function fakeScrollGeometry(el: HTMLElement, scrollHeight: number, initialTop: number) {
  let top = initialTop;
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(value, scrollHeight));
    },
  });
  return () => top;
}

describe("MessageList progressive mount", () => {
  const offsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");

  beforeEach(() => {
    idleCallbacks.clear();
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      writable: true,
      value: (callback: IdleRequestCallback) => {
        idleHandle += 1;
        idleCallbacks.set(idleHandle, callback);
        return idleHandle;
      },
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      writable: true,
      value: (handle: number) => {
        idleCallbacks.delete(handle);
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as { requestIdleCallback?: unknown }).requestIdleCallback;
    delete (window as { cancelIdleCallback?: unknown }).cancelIdleCallback;
    if (offsetTop) Object.defineProperty(HTMLElement.prototype, "offsetTop", offsetTop);
  });

  it("budgets the first window by content size and never below two messages", () => {
    expect(initialMountIndex(conversation(30))).toBe(26);
    expect(initialMountIndex(conversation(30, 50_000))).toBe(28);
    expect(initialMountIndex(conversation(1))).toBe(0);
    expect(initialMountIndex([])).toBe(0);
    expect(nextMountIndex(conversation(30), 26)).toBe(23);
    expect(nextMountIndex(conversation(30, 100), 26)).toBe(18);
    expect(nextMountIndex(conversation(30), 1)).toBe(0);
  });

  it("estimates placeholder heights from the message size within bounds", () => {
    expect(estimateMessageHeight({ role: "user", content: "hi" })).toBe(68);
    expect(
      estimateMessageHeight({ role: "assistant", content: "line\n".repeat(400) }),
    ).toBeGreaterThan(1000);
    expect(
      estimateMessageHeight({ role: "assistant", content: "x".repeat(1_000_000) }),
    ).toBe(6000);
  });

  it("mounts the newest messages first and the rest in idle chunks", () => {
    const messages = conversation(30);
    const { container } = render(
      <Harness messages={messages} chatId="chat-a" nearBottom={true} />,
    );

    expect(mountedCount(container)).toBe(4);
    expect(pendingCount(container)).toBe(26);
    expect(container.querySelectorAll("[data-mm-index]")).toHaveLength(30);
    expect(container.querySelectorAll('[data-testid="extras"]')).toHaveLength(4);
    const placeholder = container.querySelector<HTMLElement>('[data-message-pending="true"]');
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(placeholder?.style.height).toBe(`${estimateMessageHeight(messages[0].msg)}px`);
    const mounted = container.querySelector<HTMLElement>('[data-mm-index="29"]');
    expect(mounted).toHaveClass("[content-visibility:auto]");
    expect(mounted?.style.containIntrinsicSize).toContain("auto");

    flushIdle();
    expect(mountedCount(container)).toBe(7);
    while (pendingCount(container) > 0) flushIdle();
    expect(mountedCount(container)).toBe(30);
    expect(idleCallbacks.size).toBe(0);
  });

  it("keeps an appended message inside the mounted window", () => {
    const messages = conversation(30);
    const view = render(<Harness messages={messages} chatId="chat-a" nearBottom={true} />);
    expect(mountedCount(view.container)).toBe(4);

    const appended = [
      ...messages,
      {
        key: "m-30",
        index: 30,
        live: true,
        isLatestAssistant: true,
        msg: { id: "m-30", role: "assistant", content: "streaming" } as ChatMessage,
      },
    ];
    view.rerender(<Harness messages={appended} chatId="chat-a" nearBottom={true} />);

    expect(mountedCount(view.container)).toBe(5);
    expect(pendingCount(view.container)).toBe(26);
  });

  it("resets the window when the active chat changes", () => {
    const view = render(
      <Harness messages={conversation(30)} chatId="chat-a" nearBottom={true} />,
    );
    while (pendingCount(view.container) > 0) flushIdle();
    expect(mountedCount(view.container)).toBe(30);

    view.rerender(<Harness messages={conversation(12)} chatId="chat-b" nearBottom={true} />);

    expect(mountedCount(view.container)).toBe(4);
    expect(pendingCount(view.container)).toBe(8);
  });

  it("keeps the view pinned to the bottom while older messages mount", () => {
    const { container } = render(
      <Harness messages={conversation(30)} chatId="chat-a" nearBottom={true} />,
    );
    const scroll = container.querySelector<HTMLElement>('[data-testid="scroll"]');
    if (!scroll) throw new Error("missing scroll container");
    const readTop = fakeScrollGeometry(scroll, 12_000, 4_000);

    flushIdle();

    expect(readTop()).toBe(12_000);
  });

  it("compensates the scroll offset when a chunk above the viewport changes height", () => {
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get(this: HTMLElement) {
        const index = this.getAttribute("data-mm-index");
        return index === null ? 0 : Number(index) * 100;
      },
    });
    const messages = conversation(30, 10);
    const { container } = render(
      <Harness messages={messages} chatId="chat-a" nearBottom={false} />,
    );
    const scroll = container.querySelector<HTMLElement>('[data-testid="scroll"]');
    if (!scroll) throw new Error("missing scroll container");
    const readTop = fakeScrollGeometry(scroll, 100_000, 50_000);
    const before = 22;
    const after = 14;
    expect(pendingCount(container)).toBe(before);

    flushIdle();

    expect(pendingCount(container)).toBe(after);
    const estimated = (before - after) * estimateMessageHeight(messages[0].msg);
    const rendered = (before - after) * 100;
    expect(readTop()).toBe(50_000 + rendered - estimated);
  });

  it("leaves the scroll offset alone when the mounted chunk is inside the viewport", () => {
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get(this: HTMLElement) {
        const index = this.getAttribute("data-mm-index");
        return index === null ? 0 : Number(index) * 100;
      },
    });
    const { container } = render(
      <Harness messages={conversation(30, 10)} chatId="chat-a" nearBottom={false} />,
    );
    const scroll = container.querySelector<HTMLElement>('[data-testid="scroll"]');
    if (!scroll) throw new Error("missing scroll container");
    const readTop = fakeScrollGeometry(scroll, 100_000, 0);

    flushIdle();

    expect(readTop()).toBe(0);
  });
});
