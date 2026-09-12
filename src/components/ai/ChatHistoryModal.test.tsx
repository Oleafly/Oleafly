// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
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

const history = enAi.history;
const MINUTE = 60_000;

function renderChats(chats: StoredChat[], props: Record<string, unknown> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onOpen: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    <QueryClientProvider client={createAppQueryClient()}>
      <ChatHistoryModal
        open
        chats={chats}
        activeId={null}
        currentHead={null}
        {...handlers}
        {...props}
      />
    </QueryClientProvider>,
  );
  return handlers;
}

const chat = (over: Partial<StoredChat> = {}): StoredChat =>
  ({
    id: "c1",
    title: "Bibliography fixes",
    messages: [],
    updatedAt: Date.now(),
    ...over,
  }) as StoredChat;

describe("ChatHistoryModal list", () => {
  beforeEach(() => {
    mockSearch.mockReset().mockResolvedValue([]);
  });

  it("renders nothing while closed", () => {
    const { container } = render(
      <QueryClientProvider client={createAppQueryClient()}>
        <ChatHistoryModal
          open={false}
          chats={CHATS}
          activeId={null}
          currentHead={null}
          onClose={() => {}}
          onOpen={() => {}}
          onDelete={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says the project has no saved chats", () => {
    renderChats([]);
    expect(screen.getByText(history.emptyProject)).toBeInTheDocument();
  });

  it("says nothing matched the search", async () => {
    renderChats(CHATS);
    fireEvent.change(screen.getByLabelText(history.searchLabel), {
      target: { value: "nothing at all" },
    });
    expect(await screen.findByText(history.emptySearch)).toBeInTheDocument();
  });

  it("dates each chat by how long ago it was touched", () => {
    renderChats([
      chat({ id: "a", title: "Now", updatedAt: Date.now() }),
      chat({ id: "b", title: "Minutes", updatedAt: Date.now() - 5 * MINUTE }),
      chat({ id: "c", title: "Hours", updatedAt: Date.now() - 3 * 60 * MINUTE }),
      chat({ id: "d", title: "Days", updatedAt: Date.now() - 3 * 24 * 60 * MINUTE }),
      chat({ id: "e", title: "Old", updatedAt: Date.now() - 40 * 24 * 60 * MINUTE }),
    ]);

    expect(screen.getByText(new RegExp(history.relative.justNow))).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(history.relative.minutes.replace("{{count}}", "5"))),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(history.relative.hours.replace("{{count}}", "3"))),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(history.relative.days.replace("{{count}}", "3"))),
    ).toBeInTheDocument();
  });

  it("labels an untitled chat, its message count, and a stale head", () => {
    renderChats(
      [
        chat({
          id: "a",
          title: "",
          headOid: "old",
          messages: [{ role: "user", content: "hi" }] as StoredChat["messages"],
          usage: {
            inputTokens: 100,
            outputTokens: 40,
            steps: 1,
            runs: 1,
            estimatedUsd: 0.12,
          },
        }),
      ],
      { currentHead: "new" },
    );

    expect(screen.getByText(history.untitled)).toBeInTheDocument();
    expect(screen.getByText(history.staleBadge)).toBeInTheDocument();
    const line = screen.getByText(new RegExp(history.tokens.replace("{{amount}}", "140")));
    expect(line).toHaveTextContent(history.messages_one.replace("{{count}}", "1"));
  });

  it("opens a chat and confirms a delete", () => {
    const handlers = renderChats([chat()]);

    fireEvent.click(screen.getByText("Bibliography fixes"));
    expect(handlers.onOpen).toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: history.deleteAriaLabel.replace("{{title}}", "Bibliography fixes"),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.cancel }));
    expect(handlers.onDelete).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: history.deleteAriaLabel.replace("{{title}}", "Bibliography fixes"),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.delete }));
    expect(handlers.onDelete).toHaveBeenCalledWith("c1");
  });

  it("names the delete action of an untitled chat", () => {
    renderChats([chat({ title: "" })]);

    expect(
      screen.getByRole("button", {
        name: history.deleteAriaLabel.replace(
          "{{title}}",
          history.deleteFallbackTitle,
        ),
      }),
    ).toBeInTheDocument();
  });
});
