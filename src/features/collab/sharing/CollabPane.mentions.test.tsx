// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useChatRail } from "@/components/collab/chat-rail";
import { useCommentsRail } from "@/components/collab/comments-rail";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "../live/live-store";
import { BOB_ID, fill, shareInfo } from "../tests/fixtures";
import { useCollabActivity, type ActivityEntry } from "./activity-store";

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabTrashList: vi.fn(async () => []),
}));

import { CollabPane } from "./CollabPane";

const openFile = vi.fn(async (_path: string) => undefined);

function mentioned(path: string | null, name = "Bob Smith"): ActivityEntry {
  return {
    id: `mention-${path}`,
    count: 1,
    kind: "mentioned",
    at: Date.now() - 60_000,
    accountId: BOB_ID,
    name,
    path,
    threadId: "t1",
    messageId: "m1",
  };
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  openFile.mockClear();
  useFilesStore.setState({ projectId: "grant", activePath: "main.tex", openFile });
  useSettingsStore.setState({ railTab: "collab", showTree: true });
  useCollabLiveStore.setState({ projectId: "grant", share: shareInfo(), status: { state: "online" }, members: [] });
});

afterEach(() => {
  useCollabActivity.setState({ projectId: null, entries: [], unread: false });
  useCollabLiveStore.setState({ projectId: null, share: null, status: null, members: [] });
  useCommentsRail.setState({ reveal: null });
});

describe("mention entries in Activity", () => {
  it("says who mentioned the person and where, and opens the comment", () => {
    useCollabActivity.setState({
      projectId: "grant",
      entries: [mentioned("chapters/intro.tex"), mentioned(null, "")],
      unread: false,
    });
    render(<CollabPane />);
    const list = screen.getByRole("list", { name: enCollab.pane.activity });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(first).toHaveTextContent(fill(enCollab.activity.mentioned, { name: "Bob Smith", path: "chapters/intro.tex" }));
    expect(second).toHaveTextContent(
      fill(enCollab.activity.mentionedHere, { name: enCollab.toolbar.unknownPerson }),
    );
    expect(within(second).queryByRole("button", { name: enCollab.activity.showComment })).not.toBeInTheDocument();
    fireEvent.click(within(first).getByRole("button", { name: enCollab.activity.showComment }));
    expect(openFile).toHaveBeenCalledWith("chapters/intro.tex");
    expect(useCommentsRail.getState().reveal).toEqual({ path: "chapters/intro.tex", threadId: "t1" });
    expect(useSettingsStore.getState().railTab).toBe("comments");
  });

  it("opens the chat at the message a chat mention points to", () => {
    useCollabActivity.setState({
      projectId: "grant",
      entries: [{ id: "chat-c9", count: 1, kind: "chatMentioned", at: 1, accountId: BOB_ID, name: "Bob Smith", messageId: "c9" }],
      unread: false,
    });
    render(<CollabPane />);
    fireEvent.click(screen.getByRole("button", { name: enCollab.activity.showMessage }));
    expect(useSettingsStore.getState().railTab).toBe("chat");
    expect(useChatRail.getState().reveal).toBe("c9");
  });
});
