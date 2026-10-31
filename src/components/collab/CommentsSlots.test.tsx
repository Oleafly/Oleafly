// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";

const loaded = vi.hoisted(() => ({ pane: vi.fn(), keeper: vi.fn(), activity: vi.fn(), personal: vi.fn() }));

vi.mock("@/features/personal-comments/PersonalComments", () => ({
  PersonalCommentsKeeper: () => {
    loaded.personal();
    return null;
  },
  PersonalCommentsPane: () => <span>{"personal comments pane"}</span>,
}));

vi.mock("@/features/collab/comments", () => ({
  CommentsPane: () => {
    loaded.pane();
    return <span>{"comments pane"}</span>;
  },
  CommentsKeeper: () => {
    loaded.keeper();
    return null;
  },
}));
vi.mock("@/features/collab/sharing/surfaces", () => ({
  CollabActivityKeeper: () => {
    loaded.activity();
    return null;
  },
}));
vi.mock("@/features/collab/suggestions", () => ({ SuggestionsKeeper: () => null }));
vi.mock("@/features/collab/chat", () => ({ ChatKeeper: () => null }));

import { useCollabRail } from "./collab-rail";
import { CollabActivitySlot, CommentsPanel, CommentsRailIcon, commentsRailLabel } from "./CollabSlots";
import { useCommentsRail } from "./comments-rail";
import { useFilesStore } from "@/store/files";

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  useFilesStore.setState({ projectId: null });
});

afterEach(() => {
  useCollabRail.setState({ visible: false, unread: false });
  useCommentsRail.setState({ visible: false, unread: false });
});

describe("comment slots", () => {
  it("start the comment keeper only for a shared project", async () => {
    render(<CollabActivitySlot />);
    await vi.waitFor(() => expect(loaded.activity).toHaveBeenCalled());
    await settle();
    expect(loaded.keeper).not.toHaveBeenCalled();
    act(() => useCollabRail.setState({ visible: true }));
    await vi.waitFor(() => expect(loaded.keeper).toHaveBeenCalled());
  });

  it("load the Comments tab on demand", async () => {
    useCollabRail.setState({ visible: true });
    render(<CommentsPanel />);
    expect(await screen.findByText("comments pane")).toBeInTheDocument();
  });

  it("starts personal comments without sharing or an account", async () => {
    useFilesStore.setState({ projectId: "paper" });
    render(<CollabActivitySlot />);
    await vi.waitFor(() => expect(loaded.personal).toHaveBeenCalled());
    expect(loaded.keeper).not.toHaveBeenCalled();
  });

  it("opens the personal pane for an unshared project", async () => {
    render(<CommentsPanel />);
    expect(await screen.findByText("personal comments pane")).toBeInTheDocument();
  });

  it("dot the rail icon and name the unseen activity", () => {
    const { container } = render(<CommentsRailIcon className="size-4" />);
    expect(container.querySelector("svg.lucide-message-square")).toBeInTheDocument();
    expect(screen.queryByTestId("comments-rail-dot")).not.toBeInTheDocument();
    expect(commentsRailLabel()).toBe(enCollab.comments.title);
    act(() => useCommentsRail.setState({ unread: true }));
    expect(screen.getByTestId("comments-rail-dot")).toBeInTheDocument();
    expect(commentsRailLabel()).toBe(enCollab.comments.titleUnread);
  });
});
