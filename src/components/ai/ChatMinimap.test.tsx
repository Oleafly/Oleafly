// @vitest-environment jsdom

import { useRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatMinimap } from "./ChatMinimap";
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
        {messages.map((_, index) => (
          <div key={index} data-mm-index={index} />
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

  it("renders nothing with fewer than two messages", () => {
    const { container } = render(<Harness visible count={1} />);
    expect(ticks(container)).toHaveLength(0);
  });

  it("renders one tick per message when visible with a conversation", () => {
    const { container } = render(<Harness visible count={4} />);
    expect(ticks(container)).toHaveLength(4);
  });

  it("previews the turn on hover: the user prompt and its assistant reply", () => {
    const { container, getByText } = render(<Harness visible count={4} />);
    // Hovering the first user tick shows that prompt and the reply paired with it.
    fireEvent.mouseEnter(ticks(container)[0]);
    expect(getByText("Question number 0")).toBeInTheDocument();
    expect(getByText("Answer number 1")).toBeInTheDocument();
  });
});
