// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatsSearch } from "@/lib/tauri";
import { createAppQueryClient } from "@/lib/query";
import type { StoredChat } from "@/store/chats";
import { ChatHistoryModal } from "./ChatHistoryModal";

vi.mock("@/lib/tauri", () => ({
  chatsSearch: vi.fn(),
}));

const mockSearch = vi.mocked(chatsSearch);

const CHATS = [
  { id: "c1", title: "Bibliography fixes", messages: [], updatedAt: Date.now() },
  { id: "c2", title: "Figure drawing", messages: [], updatedAt: Date.now() },
] as unknown as StoredChat[];

function renderModal() {
  render(
    <QueryClientProvider client={createAppQueryClient()}>
      <ChatHistoryModal
        open
        chats={CHATS}
        activeId={null}
        currentHead={null}
        onClose={() => {}}
        onOpen={() => {}}
        onDelete={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("ChatHistoryModal search", () => {
  beforeEach(() => {
    mockSearch.mockReset().mockResolvedValue([]);
  });

  it("filters the list by title as the user types", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Search chats"), {
      target: { value: "bibliography" },
    });

    expect(await screen.findByText("Bibliography fixes")).toBeInTheDocument();
    expect(screen.queryByText("Figure drawing")).not.toBeInTheDocument();
  });

  it("keeps chats whose message content matches via the session index", async () => {
    mockSearch.mockResolvedValue([
      { project_id: "p", chat_id: "c2", title: "Figure drawing", snippet: "tikz" },
    ]);
    renderModal();
    fireEvent.change(screen.getByLabelText("Search chats"), {
      target: { value: "tikz" },
    });

    expect(await screen.findByText("Figure drawing")).toBeInTheDocument();
    expect(screen.queryByText("Bibliography fixes")).not.toBeInTheDocument();
  });
});
