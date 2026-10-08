// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ToolEntry } from "@/store/chats";

const cardRenders = vi.hoisted(() => new Map<string, number>());

vi.mock("@/components/ai/activity/ResearchToolCard", () => ({
  ResearchToolCard: ({ tc }: { tc: ToolEntry }) => {
    cardRenders.set(tc.id ?? "", (cardRenders.get(tc.id ?? "") ?? 0) + 1);
    return <div data-testid="tool-card">{tc.name}</div>;
  },
}));

import { MessageItem } from "./chat-parts";

beforeAll(async () => {
  await import("@/components/ui/markdown-renderer");
});

const read: ToolEntry = { id: "a", name: "read_file", status: "done", output: "contents" };
const search: ToolEntry = { id: "b", name: "search_project", status: "done", output: "matches" };

describe("tool cards in a streaming reply", () => {
  it("renders only the tool card whose entry changed while the reply text streams", () => {
    const toolCalls = [read, search];
    const first: ChatMessage = { id: "m", role: "assistant", content: "Reading", toolCalls };
    const view = render(<MessageItem msg={first} live />);
    expect(cardRenders.get("a")).toBe(1);
    expect(cardRenders.get("b")).toBe(1);

    view.rerender(<MessageItem msg={{ ...first, content: "Reading the files" }} live />);
    expect(cardRenders.get("a")).toBe(1);
    expect(cardRenders.get("b")).toBe(1);

    const rerun = { ...search, output: "more matches" };
    view.rerender(<MessageItem msg={{ ...first, content: "Reading the files now", toolCalls: [read, rerun] }} live />);
    expect(cardRenders.get("a")).toBe(1);
    expect(cardRenders.get("b")).toBe(2);
  });
});
