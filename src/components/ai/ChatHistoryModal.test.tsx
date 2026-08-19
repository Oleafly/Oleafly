// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoredChat } from "@/store/chats";
import { ChatHistoryModal } from "./ChatHistoryModal";

const chat: StoredChat = {
  id: "chat-1",
  projectId: "project-1",
  title: "Review the introduction",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messages: [{ role: "user", content: "Review this introduction." }],
  headOid: null,
};

describe("ChatHistoryModal", () => {
  it("uses the spacious history modal shell without a header divider", () => {
    render(
      <ChatHistoryModal
        open
        chats={[chat]}
        activeId={null}
        currentHead={null}
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Chat history" });
    expect(dialog).toHaveClass("h-[min(30rem,80vh)]", "bg-popover");

    const header = screen.getByRole("heading", { name: "Chat history" })
      .parentElement;
    expect(header).toHaveClass("p-4");
    expect(header).not.toHaveClass("border-b");
    expect(screen.getByText("Review the introduction")).toBeInTheDocument();
  });
});
