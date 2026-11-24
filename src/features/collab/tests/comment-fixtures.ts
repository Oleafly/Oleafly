import { vi } from "vitest";
import type {
  CollabCommentMessage,
  CollabCommentsStatus,
  CollabCommentThread,
  CollabCommentThreadList,
} from "@/lib/tauri";
import { ALICE_ID, type LiveSeed, SERVER_SEED } from "./fixtures";

export const AT = 1_760_000_000_000;

export function commentFixtures(seed: LiveSeed) {
  const commentMessage = (
    id: string,
    author: string = seed.bob.account_id,
    body = "Is this right?",
    overrides: Partial<CollabCommentMessage> = {},
  ): CollabCommentMessage => ({
    id,
    author,
    at: AT,
    body,
    editedAt: null,
    deleted: false,
    mentions: [],
    verified: true,
    reactions: [],
    removed: false,
    pending: false,
    ...overrides,
  });
  const commentThread = (
    id: string,
    range: { from: number; to: number } | null,
    overrides: Partial<CollabCommentThread> = {},
  ): CollabCommentThread => ({
    id,
    fileId: seed.fileId,
    anchor: { quote: `quote of ${id}`, range },
    createdBy: seed.bob.account_id,
    createdAt: AT,
    resolved: null,
    messages: [commentMessage(`${id}-first`)],
    verified: true,
    ...overrides,
  });
  return { commentMessage, commentThread, INTRO_FILE: seed.fileId };
}

export const { commentMessage, commentThread, INTRO_FILE } = commentFixtures(SERVER_SEED);

export function threadList(threads: CollabCommentThread[], rev: number | null = null): CollabCommentThreadList {
  return { rev, threads };
}

export function commentsStatus(overrides: Partial<CollabCommentsStatus> = {}): CollabCommentsStatus {
  return {
    serverAllowed: true,
    projectEnabled: true,
    canComment: true,
    reactions: false,
    moderate: false,
    typing: true,
    suggestionThreads: true,
    ...overrides,
  };
}

export const SELF = ALICE_ID;

export function fakeSession(revision: number, synchronized = true) {
  const listeners = new Set<() => void>();
  let release: () => void = () => undefined;
  const session = {
    phase: "open",
    revision,
    synchronized,
    settled: vi.fn(() =>
      session.synchronized ? Promise.resolve() : new Promise<void>((resolve) => (release = resolve)),
    ),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    catchUp(next: number) {
      session.revision = next;
      for (const listener of [...listeners]) listener();
    },
    finishTyping(next: number) {
      session.synchronized = true;
      session.revision = next;
      release();
    },
  };
  return session;
}
