// @vitest-environment jsdom

import { useRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatMinimap } from "./ChatMinimap";
import { CHAT_SCROLL_TO_INDEX_EVENT } from "./MessageList";
import type { ChatMessage } from "@/store/chats";

function Harness({ visible, count }: { visible: boolean; count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const messages: ChatMessage[] = Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: i % 2 === 0 ? `Question number ${i}` : `Answer number ${i}`,
  }));
  return (
    <div>
      <div ref={ref} data-testid="scroll">
        {/* Empty nodes: the minimap only needs their data-mm-index and
            geometry, so the preview text appears solely in the hover card. */}
        {messages.map((message, index) => (
          <div key={`${message.role}:${message.content}`} data-mm-index={index} />
        ))}
      </div>
      <ChatMinimap scrollRef={ref} messages={messages} visible={visible} />
    </div>
  );
}

function ticks(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("button"));
}

describe("ChatMinimap", () => {
  it("renders nothing when not in the full-width layout", () => {
    const { container } = render(<Harness visible={false} count={6} />);
    expect(ticks(container)).toHaveLength(0);
  });

  it("renders nothing with fewer than two prompts", () => {
    // count 2 is one user prompt plus one reply.
    const { container } = render(<Harness visible count={2} />);
    expect(ticks(container)).toHaveLength(0);
  });

  it("renders one tick per user prompt, not per message", () => {
    // count 6 is three user prompts interleaved with three replies.
    const { container } = render(<Harness visible count={6} />);
    expect(ticks(container)).toHaveLength(3);
  });

  it("previews the turn on hover: the user prompt and its assistant reply", () => {
    const { container, getByText } = render(<Harness visible count={4} />);
    fireEvent.mouseEnter(ticks(container)[0]);
    expect(getByText("Question number 0")).toBeInTheDocument();
    expect(getByText("Answer number 1")).toBeInTheDocument();
  });

  it("requests an index jump when a virtualized row is not mounted", () => {
    const ref = { current: document.createElement("div") };
    const listener = vi.fn();
    ref.current.addEventListener(CHAT_SCROLL_TO_INDEX_EVENT, listener);
    const messages: ChatMessage[] = [
      { role: "user", content: "First" },
      { role: "assistant", content: "Answer" },
      { role: "user", content: "Second" },
    ];
    const { container } = render(
      <div>
        <ChatMinimap scrollRef={ref} messages={messages} visible />
      </div>,
    );

    fireEvent.click(ticks(container)[1]);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ index: 2, behavior: "smooth" });
  });
});

function activeTick(container: HTMLElement): number {
  return ticks(container).findIndex((tick) => tick.querySelector("span")?.classList.contains("bg-foreground"));
}

function scroller(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-testid="scroll"]') as HTMLElement;
}

describe("ChatMinimap navigation", () => {
  it("scrolls a mounted prompt into view just below the top edge", () => {
    const { container } = render(<Harness visible count={6} />);
    const scroll = scroller(container);
    const scrollTo = vi.fn();
    scroll.scrollTo = scrollTo as never;
    Object.defineProperty(scroll.querySelector('[data-mm-index="4"]'), "offsetTop", { configurable: true, value: 500 });

    fireEvent.click(ticks(container)[2]);

    expect(scrollTo).toHaveBeenCalledWith({ top: 488, behavior: "smooth" });
  });

  it("highlights the prompt whose turn the virtual list reports on screen", async () => {
    const { container } = render(<Harness visible count={6} />);
    const scroll = scroller(container);
    expect(activeTick(container)).toBe(2);

    scroll.dataset.chatVisibleIndex = "3";
    fireEvent(scroll, new Event("oleafly:chat-visible-index"));

    await vi.waitFor(() => expect(activeTick(container)).toBe(1));
  });

  it("highlights the last prompt above the middle of the viewport while scrolling", async () => {
    const { container } = render(<Harness visible count={6} />);
    const scroll = scroller(container);
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 400 });
    for (const [index, top] of [[0, 0], [2, 300], [4, 900]] as const) {
      Object.defineProperty(scroll.querySelector(`[data-mm-index="${index}"]`), "offsetTop", { configurable: true, value: top });
    }
    scroll.scrollTop = 200;

    fireEvent.scroll(scroll);

    await vi.waitFor(() => expect(activeTick(container)).toBe(1));
  });

  it("names a multi-line prompt by its first line and drops the card when the pointer leaves", () => {
    const ref = { current: document.createElement("div") };
    const messages: ChatMessage[] = [
      { role: "user", content: "Fix the abstract\nand tighten the intro" },
      { role: "assistant", content: "Done." },
      { role: "user", content: "Now the conclusion" },
    ];
    const { container, getByRole, queryByText } = render(
      <ChatMinimap scrollRef={ref} messages={messages} visible />,
    );
    const first = getByRole("button", { name: /Fix the abstract$/u });

    fireEvent.mouseEnter(ticks(container)[1]);
    expect(queryByText("Now the conclusion", { selector: "p" })).toBeInTheDocument();
    expect(container.querySelectorAll("p")).toHaveLength(1);
    fireEvent.mouseLeave(first);
    expect(queryByText("Now the conclusion", { selector: "p" })).toBeInTheDocument();
    fireEvent.mouseLeave(ticks(container)[1]);
    expect(queryByText("Now the conclusion", { selector: "p" })).toBeNull();
  });

  it("shows no card for an empty prompt with no reply", () => {
    const ref = { current: document.createElement("div") };
    const messages: ChatMessage[] = [
      { role: "user", content: "First" },
      { role: "user", content: "" },
    ];
    const { container } = render(<ChatMinimap scrollRef={ref} messages={messages} visible />);

    fireEvent.mouseEnter(ticks(container)[1]);

    expect(container.querySelector("p")).toBeNull();
  });
});
