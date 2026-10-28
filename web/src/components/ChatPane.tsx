import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CollabChatMessage } from "../protocol";
import { abilitiesFor } from "../roles";
import { useWeb } from "../store";
import { Composer } from "./Composer";
import { ConfirmDialog } from "./ConfirmDialog";
import { useActions } from "./context";
import { type ErrorKey, failureKey } from "./errors";
import { dateTime, isoTime, relativeTime, useNow } from "./format";
import { PersonAvatar, usePersonName } from "./people";

export const CHAT_LIMIT = 4_000;

function ChatRow({
  message,
  canDelete,
  now,
  onDelete,
}: Readonly<{ message: CollabChatMessage; canDelete: boolean; now: number; onDelete: () => void }>) {
  const { t } = useTranslation(["web"]);
  const nameOf = usePersonName();
  const name = nameOf(message.author, message.verified);
  return (
    <li className="group flex gap-2 px-2 py-1.5">
      <PersonAvatar accountId={message.author} name={name} verified={message.verified} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className={cn("truncate font-medium", !message.verified && "italic text-muted-foreground")}>{name}</span>
          {message.at ? (
            <Tooltip label={dateTime(message.at)} className="shrink-0">
              <time dateTime={isoTime(message.at)} className="text-[0.6875rem] text-muted-foreground">
                {relativeTime(message.at, now)}
              </time>
            </Tooltip>
          ) : null}
          {canDelete ? (
            <Tooltip label={t(($) => $.web.chat.delete)} className="ml-auto">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t(($) => $.web.chat.delete)}
                className="size-5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                onClick={onDelete}
              >
                <Trash2 aria-hidden className="size-3.5" />
              </Button>
            </Tooltip>
          ) : null}
        </div>
        <p className="select-text whitespace-pre-wrap break-words text-xs">{message.body}</p>
      </div>
    </li>
  );
}

export function ChatPane() {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const now = useNow();
  const messages = useWeb((state) => state.chat);
  const role = useWeb((state) => state.role);
  const features = useWeb((state) => state.features);
  const self = useWeb((state) => state.me?.accountId ?? null);
  const abilities = abilitiesFor(role, features);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const visible = messages.filter((message) => !message.deleted);
  const last = visible.at(-1)?.id;

  useEffect(() => {
    if (!last) return;
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [last]);

  const run = (action: () => Promise<void>) => {
    setError(null);
    action().catch((failure: unknown) => setError(failureKey(failure)));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {abilities.clearChat && visible.length > 0 ? (
        <div className="flex justify-end border-b px-2 py-1">
          <Button type="button" size="xs" variant="ghost" onClick={() => setConfirming(true)}>
            {t(($) => $.web.chat.clear)}
          </Button>
        </div>
      ) : null}
      {visible.length === 0 ? (
        <EmptyState
          size="compact"
          className="flex-1 px-6 py-10"
          title={t(($) => $.web.chat.emptyTitle)}
          description={t(($) => $.web.chat.emptyDescription)}
        />
      ) : (
        <ol ref={list} aria-label={t(($) => $.web.chat.messages)} className="min-h-0 flex-1 overflow-y-auto py-1">
          {visible.map((message) => (
            <ChatRow
              key={message.id}
              message={message}
              now={now}
              canDelete={abilities.chat && message.verified && message.author === self}
              onDelete={() => run(() => actions.deleteChat(message.id))}
            />
          ))}
        </ol>
      )}
      {error ? (
        <p role="alert" className="px-2 text-[0.6875rem] text-destructive">
          {t(($) => $.web.errors[error])}
        </p>
      ) : null}
      <div className="border-t px-2 py-2">
        {abilities.chat ? (
          <Composer
            compact
            label={t(($) => $.web.chat.label)}
            placeholder={t(($) => $.web.chat.placeholder)}
            submitLabel={t(($) => $.web.chat.send)}
            maxLength={CHAT_LIMIT}
            onSubmit={(body) => actions.sendChat(body)}
          />
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
  );
}
