// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useSettingsStore } from "@/store/settings";

const loaded = vi.hoisted(() => ({ pane: vi.fn(), keeper: vi.fn(), activity: vi.fn() }));

vi.mock("@/features/collab/comments/CommentsPane", () => ({
  CommentsPane: () => {
    loaded.pane();
    return <span>{"comments pane"}</span>;
  },
}));
vi.mock("@/features/collab/comments/CommentsKeeper", () => ({
  CommentsKeeper: () => {
    loaded.keeper();
    return null;
  },
}));
vi.mock("@/features/collab/sharing/CollabActivityKeeper", () => ({
  CollabActivityKeeper: () => {
    loaded.activity();
    return null;
  },
}));

import { useCollabRail } from "./collab-rail";
import { CollabActivitySlot, CommentsPanel, CommentsRailIcon, commentsRailLabel } from "./CollabSlots";
import { useCommentsRail } from "./comments-rail";

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
});

afterEach(() => {
  useSettingsStore.setState({ liveCollaboration: false });
  useCollabRail.setState({ visible: false, unread: false });
  useCommentsRail.setState({ visible: false, unread: false });
});

describe("comment slots", () => {
  it("load nothing while live collaboration is off", async () => {
    useCollabRail.setState({ visible: true });
    const { container } = render(
      <>
        <CollabActivitySlot />
        <CommentsPanel />
      </>,
    );
    await settle();
    expect(container).toBeEmptyDOMElement();
    expect(loaded.pane).not.toHaveBeenCalled();
    expect(loaded.keeper).not.toHaveBeenCalled();
  });

  it("start the comment keeper only for a shared project", async () => {
    useSettingsStore.setState({ liveCollaboration: true });
    render(<CollabActivitySlot />);
    await vi.waitFor(() => expect(loaded.activity).toHaveBeenCalled());
    await settle();
    expect(loaded.keeper).not.toHaveBeenCalled();
    act(() => useCollabRail.setState({ visible: true }));
    await vi.waitFor(() => expect(loaded.keeper).toHaveBeenCalled());
  });

  it("load the Comments tab on demand", async () => {
    useSettingsStore.setState({ liveCollaboration: true });
    render(<CommentsPanel />);
    expect(await screen.findByText("comments pane")).toBeInTheDocument();
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
