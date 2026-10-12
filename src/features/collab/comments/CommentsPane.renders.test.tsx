// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import type { CollabCommentThread } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "../live/live-store";
import { ALICE_ID, BOB, BOB_ID, person, projectMember, shareInfo } from "../tests/fixtures";
import { commentMessage, commentsStatus, commentThread, threadList } from "../tests/comment-fixtures";

const mocks = vi.hoisted(() => ({
  collabCommentThreadList: vi.fn(),
  rows: 0,
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabCommentThreadList: mocks.collabCommentThreadList,
}));

vi.mock("@/lib/intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intl")>();
  return {
    ...actual,
    formatRelativeTimeFrom: (...args: Parameters<typeof actual.formatRelativeTimeFrom>) => {
      mocks.rows += 1;
      return actual.formatRelativeTimeFrom(...args);
    },
  };
});

import { byDocument, reloadThreads, useComments } from "./comments-store";
import { CommentsPane } from "./CommentsPane";

const THREADS = 40;
const MESSAGES = 3;

let commits = 0;
const onRender: ProfilerOnRenderCallback = () => {
  commits += 1;
};

function threads(): CollabCommentThread[] {
  return byDocument(
    Array.from({ length: THREADS }, (_, index) =>
      commentThread(`t${index}`, index % 10 === 9 ? null : { from: index * 50, to: index * 50 + 10 }, {
        messages: Array.from({ length: MESSAGES }, (_, at) => commentMessage(`t${index}-m${at}`)),
      }),
    ),
  );
}

function copies(list: readonly CollabCommentThread[]): CollabCommentThread[] {
  return JSON.parse(JSON.stringify(list)) as CollabCommentThread[];
}

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

async function reload(list: CollabCommentThread[]): Promise<void> {
  mocks.collabCommentThreadList.mockResolvedValueOnce(threadList(list));
  await act(async () => {
    reloadThreads();
    await flush();
  });
}

function renderPane(list: CollabCommentThread[]) {
  useComments.setState({
    projectId: "grant",
    status: commentsStatus(),
    path: "main.tex",
    threads: list,
    phase: "ready",
    error: null,
    selectedId: null,
    showResolved: false,
    draft: null,
  });
  const screen = render(
    <Profiler id="comments" onRender={onRender}>
      <CommentsPane />
    </Profiler>,
  );
  commits = 0;
  mocks.rows = 0;
  return screen;
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  useFilesStore.setState({ projectId: "grant", activePath: "main.tex" });
  useCollabLiveStore.setState({
    projectId: "grant",
    role: "editor",
    status: { state: "online" },
    pending: 0,
    members: [projectMember(person(), "editor"), projectMember(BOB, "owner")],
    share: shareInfo({ project_id: "grant", role: "editor", account_id: ALICE_ID }),
  });
});

afterEach(() => {
  useComments.setState({ projectId: null, status: null, path: null, threads: [], phase: "idle", selectedId: null });
  useCollabLiveStore.setState({ projectId: null, share: null, role: null, status: null, pending: 0, members: [] });
  useFilesStore.setState({ projectId: null, activePath: null });
});

describe("Comments tab redraws", () => {
  it("stays still while the sync status flips on every keystroke", async () => {
    const screen = renderPane(threads());
    for (let flip = 0; flip < 50; flip += 1) {
      await act(async () => {
        useCollabLiveStore.setState({ status: { state: "online" }, pending: flip % 2 });
      });
    }
    expect(commits).toBe(0);
    expect(mocks.rows).toBe(0);
    await act(async () => {
      useCollabLiveStore.setState({ status: { state: "ended", reason: "removed" } });
    });
    expect(commits).toBe(1);
    screen.unmount();
  });

  it("redraws nothing when a reload brings the same threads and only the changed thread otherwise", async () => {
    const first = threads();
    const screen = renderPane(first);
    await reload(copies(first));
    expect(commits).toBe(0);
    expect(mocks.rows).toBe(0);
    expect(useComments.getState().threads).toBe(first);

    const next = copies(first);
    next[3] = { ...next[3], messages: [...next[3].messages, commentMessage("t3-new", BOB_ID, "Fixed it")] };
    await reload(next);
    const after = useComments.getState().threads;
    expect(commits).toBe(1);
    expect(mocks.rows).toBe(MESSAGES + 1);
    expect(after[3]).not.toBe(first[3]);
    expect(after.filter((thread, index) => thread === first[index])).toHaveLength(THREADS - 1);
    expect(screen.getByText("Fixed it")).toBeInTheDocument();
    screen.unmount();
  });
});
