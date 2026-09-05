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
