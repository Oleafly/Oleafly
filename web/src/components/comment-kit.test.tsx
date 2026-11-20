import type { CollabCommentThread } from "@oleafly/backend-port";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectActions } from "../controller";
import type { WebPeer } from "../protocol";
import { resetWebState, useWeb } from "../store";
import { ChatPane } from "./ChatPane";
import { CommentsPane } from "./CommentsPane";
import { ActionsContext } from "./context";

const counted = vi.hoisted(() => ({ times: 0 }));

vi.mock("./format", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./format")>();
  return {
    ...actual,
    relativeTime: (...args: Parameters<typeof actual.relativeTime>) => {
      counted.times += 1;
      return actual.relativeTime(...args);
    },
  };
});

const MAIN = { fileId: "f-main", path: "main.tex", kind: "text" as const, blob: null };
const AT = Date.now() - 60_000;

function thread(index: number): CollabCommentThread {
  return {
    id: `t${index}`,
    fileId: MAIN.fileId,
    anchor: { quote: `quote ${index}`, range: { from: index * 10, to: index * 10 + 5 } },
    createdBy: "ana",
    createdAt: AT,
    resolved: null,
    verified: true,
    messages: [0, 1].map((at) => ({
      id: `t${index}-m${at}`,
      author: "ana",
      at: AT + at,
      body: `Message ${at}`,
      editedAt: null,
      deleted: false,
      removed: false,
      mentions: [],
      reactions: [],
      pending: false,
      verified: true,
    })),
  };
}

function peer(seq: number, activity: WebPeer["activity"]): WebPeer {
  return { deviceId: "d-ana", accountId: "ana", name: "Ana", fileId: MAIN.fileId, anchor: seq, head: seq, activity, seq };
}

function frame(seq: number, activity: WebPeer["activity"]) {
  useWeb.setState({ peers: [peer(seq, activity)], activityAt: { "d-ana": Date.now() } });
}

function mount(node: ReactNode) {
  resetWebState({
    role: "commenter",
    me: { accountId: "me", name: "Me", avatarUrl: null, login: null, email: null },
    people: { ana: { accountId: "ana", name: "Ana", avatarUrl: null, login: null } },
    files: [MAIN],
    activeFileId: MAIN.fileId,
    activePath: MAIN.path,
    chatLoaded: true,
    threads: { [MAIN.fileId]: Array.from({ length: 12 }, (_, index) => thread(index)) },
    chat: Array.from({ length: 12 }, (_, index) => ({
      id: `c${index}`,
      author: "ana",
      at: AT + index,
      body: `Chat ${index}`,
      deleted: false,
      verified: true,
      reactions: [],
      mentions: [],
      pending: false,
    })),
    peers: [peer(0, null)],
  });
  const actions = { setActivity: vi.fn(), deleteChat: vi.fn(), reactChat: vi.fn() } as unknown as ProjectActions;
  render(<ActionsContext.Provider value={actions}>{node}</ActionsContext.Provider>);
  counted.times = 0;
}

describe("presence and the comment list", () => {
  it("redraws no comment while a peer replying to one thread moves their cursor", () => {
    mount(<CommentsPane />);
    for (let seq = 1; seq <= 20; seq += 1) act(() => frame(seq, { kind: "reply", threadId: "t3" }));
    expect(screen.getByRole("status")).toHaveTextContent("Ana is replying");
    expect(counted.times).toBe(0);
  });

  it("redraws no chat message while a peer types in the chat", () => {
    mount(<ChatPane />);
    for (let seq = 1; seq <= 20; seq += 1) act(() => frame(seq, { kind: "chat", threadId: null }));
    expect(screen.getByRole("status")).toHaveTextContent("Ana is typing");
    expect(counted.times).toBe(0);
  });
});
