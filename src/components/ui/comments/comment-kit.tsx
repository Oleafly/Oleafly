import { createContext, useContext, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { CommentComposerLabels } from "./comment-composer";
import type { CommentPresenceFeed, PresenceLabels } from "./comment-presence";
import type { CommentQuoteLabels } from "./comment-quote";
import type { CommentMember } from "./mentions";

export interface CommentConfirmProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface CommentKitLabels extends CommentComposerLabels, CommentQuoteLabels {
  edited: string;
  deleted: string;
  edit: string;
  editLabel: string;
  delete: string;
  save: string;
  reply: string;
  replyLabel: string;
  replyPlaceholder: string;
  replies: (count: number) => string;
  hideReplies: string;
  lastReply: (time: string) => string;
  messageActions: string;
  deleteThread?: string;
  resolve: string;
  reopen: string;
  send: string;
  copyLink?: string;
  copied?: string;
  addReaction: string;
  moreEmoji?: string;
  you: string;
  reactWith: (emoji: string) => string;
  reactedBy: (names: string, emoji: string) => string;
  deleteMessageConfirm: { title: string; description: string };
  deleteThreadConfirm?: { title: string; description: string };
  newBadge: string;
  waiting: string;
  copyText: string;
  discard: string;
  removed: string;
  remove?: string;
  removeConfirm?: { title: string; description: string; confirm?: string };
  replying: PresenceLabels;
}

export type CommentActivityScope = { kind: "reply"; threadId: string } | { kind: "chat" };

export interface CommentReactions {
  quick: readonly string[];
  more?: (pick: (emoji: string) => void) => ReactNode;
}

export type CommentErrorReport = (what: string, error: unknown) => void;

export interface CommentKit {
  labels: CommentKitLabels;
  now: number;
  relative: (at: number, now: number) => string;
  exact: (at: number) => string;
  members: readonly CommentMember[];
  self: string | null;
  hue: (accountId: string) => number;
  describeError: (error: unknown) => string;
  reportError?: CommentErrorReport;
  canRetry?: (error: unknown) => boolean;
  Confirm: ComponentType<CommentConfirmProps>;
  maxLength?: number;
  nameOf: (accountId: string) => string;
  listNames: (names: readonly string[]) => string;
  copyText?: (text: string) => Promise<void>;
  reactions?: CommentReactions;
  moderate?: boolean;
  math?: boolean;
  markdown?: boolean;
  activity?: (scope: CommentActivityScope, active: boolean) => void;
  presence?: CommentPresenceFeed;
}

export const QUICK_REACTIONS = ["👍", "🎉", "❤️", "😄", "👀", "🚀"] as const;

const CommentKitContext = createContext<CommentKit | null>(null);

export const CommentKitProvider = CommentKitContext.Provider;

export function useCommentKit(): CommentKit {
  const kit = useContext(CommentKitContext);
  if (!kit) throw new Error("Comment kit components need a CommentKitProvider");
  return kit;
}

export function useCommentErrorReport(): CommentErrorReport | undefined {
  return useContext(CommentKitContext)?.reportError;
}

export function isoTime(at: number): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function useCommentAction(describeError: (error: unknown) => string) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    action()
      .catch((failure: unknown) => setError(describeError(failure)))
      .finally(() => {
        running.current = false;
        setBusy(false);
      });
  };
  return { error, busy, run };
}
