import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CommentScrollArea } from "@/components/ui/comments/comment-arrivals";
import { CommentComposer } from "@/components/ui/comments/comment-composer";
import { presenceText, TypingLine, useChatTyping } from "@/components/ui/comments/comment-presence";
import { chatGroups } from "@/components/ui/comments/comment-bubble";
import { type CommentMessageActions, messageEntry } from "@/components/ui/comments/comment-entry";
import { CommentItem } from "@/components/ui/comments/comment-item";
import { EmptyState } from "@/components/ui/empty";
import type { CollabChatMessage } from "../protocol";
import { abilitiesFor } from "../roles";
import { useWeb } from "../store";
import { useOutboxEntry } from "./CommentsPane";
import { WebCommentKit } from "./comment-kit";
import { ConfirmDialog } from "./ConfirmDialog";
import { useActions } from "./context";
import { type ErrorKey, failureKey } from "./errors";
import { useMessageAuthor } from "./people";

export const CHAT_LIMIT = 4_000;
const CHAT_SCOPE = { kind: "chat" } as const;
const NO_ACTIONS = {};

function ChatTyping() {
  const { t } = useTranslation(["web"]);
  const typing = useChatTyping();
  if (typing.length === 0) return null;
  const label = presenceText(
    {
      one: (name) => t(($) => $.web.chat.typingOne, { name }),
      two: (first, second) => t(($) => $.web.chat.typingTwo, { first, second }),
      many: (count) => t(($) => $.web.chat.typingMany, { number: count }),
    },
    typing.map((person) => person.name),
  );
  return <TypingLine people={typing} label={label} className="px-3 pb-1" />;
}

const ChatRow = memo(function ChatRow({
  message,
  canWrite,
  canReact,
  continued,
}: Readonly<{ message: CollabChatMessage; canWrite: boolean; canReact: boolean; continued: boolean }>) {
  const actions = useActions();
  const authorOf = useMessageAuthor();
  const chatActions = useMemo<CommentMessageActions>(
    () => ({
      remove: (id) => actions.deleteChat(id),
      react: (id, emoji, on) => actions.reactChat(id, emoji, on),
    }),
    [actions],
  );
  return (
    <CommentItem
      variant="bubble"
      continued={continued}
      entry={messageEntry(message, authorOf(message))}
      canWrite={canWrite}
      canReact={canReact}
      actions={chatActions}
    />
  );
});

function ChatComposer() {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  return (
    <CommentComposer
      compact
      label={t(($) => $.web.chat.label)}
      placeholder={t(($) => $.web.chat.placeholder)}
      submitLabel={t(($) => $.web.chat.send)}
      onSubmit={(body) => actions.sendChat(body)}
      onActivity={(active) => actions.setActivity(CHAT_SCOPE, active)}
    />
  );
}

export function ChatPane() {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const messages = useWeb((state) => state.chat);
  const loaded = useWeb((state) => state.chatLoaded);
  const role = useWeb((state) => state.role);
  const features = useWeb((state) => state.features);
  const abilities = abilitiesFor(role, features);
  const chatLabels = useMemo(
    () => ({
      messageActions: t(($) => $.web.chat.messageActions),
      deleteMessageConfirm: {
        title: t(($) => $.web.chat.deleteTitle),
        description: t(($) => $.web.chat.deleteDescription),
      },
    }),
    [t],
  );
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const self = useWeb((state) => state.me?.accountId ?? null);
  const outbox = useWeb((state) => state.outbox);
  const outboxEntry = useOutboxEntry();
  const queued = useMemo(() => outbox.filter((item) => item.kind === "chat"), [outbox]);
  const visible = useMemo(() => messages.filter((message) => !message.deleted), [messages]);
  const grouped = useMemo(
    () =>
      chatGroups([
        ...visible,
        ...queued.map((item) => ({ author: self ?? "", verified: self !== null, at: item.at, deleted: false })),
      ]),
    [visible, queued, self],
  );
  const arrivals = useMemo(
    () => visible.map((message) => ({ id: message.id, mine: message.verified && message.author === self, at: message.at })),
    [visible, self],
  );

  const run = (action: () => Promise<void>) => {
    setError(null);
    action().catch((failure: unknown) => setError(failureKey(failure)));
  };

  return (
    <WebCommentKit labels={chatLabels} maxLength={CHAT_LIMIT}>
      <div className="flex min-h-0 flex-1 flex-col">
        {abilities.clearChat && visible.length > 0 ? (
          <div className="flex justify-end border-b px-2 py-1">
            <Button type="button" size="xs" variant="ghost" onClick={() => setConfirming(true)}>
              {t(($) => $.web.chat.clear)}
            </Button>
          </div>
        ) : null}
        <CommentScrollArea
          items={arrivals}
          ready={loaded}
          stickToBottom
          className="px-3 py-3"
          label={(count) => t(($) => $.web.chat.newMessages, { count })}
        >
          {visible.length === 0 && queued.length === 0 ? (
            <EmptyState
              size="compact"
              className="px-3 py-7"
              title={t(($) => $.web.chat.emptyTitle)}
              description={t(($) => $.web.chat.emptyDescription)}
            />
          ) : (
            <ol aria-label={t(($) => $.web.chat.messages)}>
              {visible.map((message, index) => (
                <ChatRow
                  key={message.id}
                  message={message}
                  canWrite={abilities.chat}
                  canReact={abilities.chat}
                  continued={grouped[index] ?? false}
                />
              ))}
              {queued.map((item, index) => (
                <CommentItem
                  key={item.id}
                  variant="bubble"
                  continued={grouped[visible.length + index] ?? false}
                  entry={outboxEntry(item)}
                  canWrite={false}
                  actions={NO_ACTIONS}
                />
              ))}
            </ol>
          )}
        </CommentScrollArea>
        <ChatTyping />
        {error ? (
          <p role="alert" className="px-3 text-[0.6875rem] text-destructive">
            {t(($) => $.web.errors[error])}
          </p>
        ) : null}
        <div className="border-t px-3 py-2">
          {abilities.chat ? (
            <ChatComposer />
          ) : (
            <p className="text-[0.6875rem] text-muted-foreground">{t(($) => $.web.chat.readOnly)}</p>
          )}
        </div>
        <ConfirmDialog
          open={confirming}
          title={t(($) => $.web.chat.clearTitle)}
          description={t(($) => $.web.chat.clearDescription)}
          confirmLabel={t(($) => $.web.chat.clear)}
          onConfirm={() => {
            setConfirming(false);
            run(() => actions.clearChat());
          }}
          onCancel={() => setConfirming(false)}
        />
      </div>
    </WebCommentKit>
  );
}
