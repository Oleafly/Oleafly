import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eraser, MessagesSquare, ShieldQuestion, Trash2 } from "@/components/icons/pack";
import { useShallow } from "zustand/react/shallow";
import { SidebarPanelHeader } from "@/components/layout/SidebarSection";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDateTime, formatRelativeTimeFrom } from "@/lib/intl";
import type { CollabChatMessage, CollabPerson } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { CommentComposer } from "../comments/CommentComposer";
import { commentFailure } from "../comments/refusals";
import { collabErrorMessage } from "../errors";
import { InlineAlert, LoadFailed } from "../feedback";
import { useCollabLiveStore } from "../live/live-store";
import { peerHue } from "../live/peer-hue";
import { canChatProjectRole } from "../roles";
import { clearChat, deleteChat, loadChat, loadOlderChat, sendChat, useChat } from "./chat-store";

const TICK_MS = 60_000;
const NO_MEMBERS: readonly never[] = [];

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

const MessageRow = memo(function MessageRow({
  message,
  person,
  self,
  now,
  canDelete,
}: Readonly<{
  message: CollabChatMessage;
  person: CollabPerson | undefined;
  self: string | null;
  now: number;
  canDelete: boolean;
}>) {
  const { t } = useTranslation(["collab", "common"]);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = message.verified
    ? person?.display_name || t(($) => $.collab.toolbar.unknownPerson)
    : t(($) => $.collab.comments.unverifiedAuthor);
  const own = message.verified && message.author === self;
  const deleteLabel = t(($) => $.collab.chat.delete);
  return (
    <li className="group/message flex gap-2 rounded-md px-1 py-1">
      <Avatar
        person={{ id: message.author, name, imageUrl: person?.avatar_url, hue: peerHue(message.author, self) }}
        size="sm"
        fallbackIcon={message.verified ? undefined : <ShieldQuestion />}
        className={cn("mt-0.5", !message.verified && "bg-muted text-muted-foreground")}
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className={cn("truncate font-medium", !message.verified && "italic text-muted-foreground")}>
            {name}
          </span>
          <Tooltip label={formatDateTime(message.at)} className="shrink-0">
            <time dateTime={new Date(message.at).toISOString()} className="text-[0.6875rem] text-muted-foreground">
              {formatRelativeTimeFrom(message.at, now)}
            </time>
          </Tooltip>
          {own && canDelete && !message.deleted ? (
            <Tooltip label={deleteLabel} className="ml-auto shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={deleteLabel}
                className="size-5 text-muted-foreground hover:text-foreground"
                onClick={() => setConfirming(true)}
              >
                <Trash2 aria-hidden className="size-3" />
              </Button>
            </Tooltip>
          ) : null}
        </div>
        {message.deleted ? (
          <p className="text-xs italic text-muted-foreground">{t(($) => $.collab.chat.deleted)}</p>
        ) : (
          <p className="select-text whitespace-pre-wrap break-words text-xs">{message.body}</p>
        )}
        {error ? <InlineAlert>{error}</InlineAlert> : null}
      </div>
      <ConfirmationDialog
        open={confirming}
        title={t(($) => $.collab.chat.deleteConfirm.title)}
        description={t(($) => $.collab.chat.deleteConfirm.description)}
        confirmLabel={t(($) => $.common.actions.delete)}
        destructive
        onConfirm={() => {
          setConfirming(false);
          setError(null);
          deleteChat(message.id).catch((error_: unknown) => setError(commentFailure(error_)));
        }}
        onCancel={() => setConfirming(false)}
      />
    </li>
  );
});

export function ChatPane() {
  const { t } = useTranslation(["collab"]);
  const chat = useChat(
    useShallow((state) => ({
      projectId: state.projectId,
      messages: state.messages,
      phase: state.phase,
      error: state.error,
      hasOlder: state.hasOlder,
      loadingOlder: state.loadingOlder,
    })),
  );
  const live = useCollabLiveStore(
    useShallow((state) => ({
      members: state.members,
      role: state.role,
      liveState: state.status?.state ?? null,
      self: state.share?.account_id ?? null,
    })),
  );
  const [clearing, setClearing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const now = useNow();
  const list = useRef<HTMLDivElement>(null);
  const lastId = chat.messages.at(-1)?.id ?? null;
  const people = useMemo(
    () => new Map(live.members.map((member) => [member.person.account_id, member.person])),
    [live.members],
  );
  const connected = live.liveState !== null && live.liveState !== "ended";
  const canPost = connected && canChatProjectRole(live.role);
  const canClear = connected && live.role === "owner" && chat.messages.some((message) => !message.deleted);
  const title = t(($) => $.collab.chat.title);
  const clearLabel = t(($) => $.collab.chat.clear);

  useLayoutEffect(() => {
    const element = list.current;
    if (element && lastId !== null) element.scrollTop = element.scrollHeight;
  }, [lastId]);

  const older = () => {
    setFailure(null);
    loadOlderChat().catch((error: unknown) => setFailure(commentFailure(error)));
  };

  const body = () => {
    if (chat.phase === "failed" && chat.messages.length === 0) {
      return (
        <div className="px-3 py-4">
          <LoadFailed
            message={t(($) => $.collab.chat.loadFailed)}
            reason={collabErrorMessage(chat.error ?? "internal")}
            onRetry={() => void loadChat()}
          />
        </div>
      );
    }
    if (chat.messages.length === 0 && (chat.phase === "loading" || chat.phase === "idle")) {
      return (
        <div className="flex justify-center py-6">
          <Spinner className="text-muted-foreground" />
        </div>
      );
    }
    if (chat.messages.length === 0) {
      return <p className="px-3 py-2 text-xs text-muted-foreground">{t(($) => $.collab.chat.empty)}</p>;
    }
    return (
      <div className="space-y-1 px-2 py-1">
        {chat.hasOlder ? (
          <div className="flex justify-center">
            <Button type="button" variant="ghost" size="xs" disabled={chat.loadingOlder} onClick={older}>
              {t(($) => $.collab.chat.loadOlder)}
            </Button>
          </div>
        ) : null}
        <ol aria-label={t(($) => $.collab.chat.list)} className="space-y-0.5">
          {chat.messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              person={message.verified ? people.get(message.author) : undefined}
              self={live.self}
              now={now}
              canDelete={canPost}
            />
          ))}
        </ol>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chat-pane">
      <SidebarPanelHeader icon={MessagesSquare} title={title}>
        {canClear ? (
          <Tooltip label={clearLabel}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={clearLabel}
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={() => setClearing(true)}
            >
              <Eraser aria-hidden className="size-3.5" />
            </Button>
          </Tooltip>
        ) : null}
      </SidebarPanelHeader>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto">
        {body()}
      </div>
      {failure ? (
        <div className="px-3 pb-2">
          <InlineAlert>{failure}</InlineAlert>
        </div>
      ) : null}
      <div className="shrink-0 border-t border-sidebar-border px-3 py-2">
        {canPost ? (
          <CommentComposer
            compact
            label={t(($) => $.collab.chat.label)}
            placeholder={t(($) => $.collab.chat.placeholder)}
            submitLabel={t(($) => $.collab.chat.send)}
            members={NO_MEMBERS}
            self={live.self}
            onSubmit={sendChat}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            {connected ? t(($) => $.collab.chat.readOnly) : t(($) => $.collab.chat.offline)}
          </p>
        )}
      </div>
      <ConfirmationDialog
        open={clearing}
        title={t(($) => $.collab.chat.clearConfirm.title)}
        description={t(($) => $.collab.chat.clearConfirm.description)}
        confirmLabel={t(($) => $.collab.chat.clearConfirm.confirm)}
        destructive
        onConfirm={() => {
          setClearing(false);
          setFailure(null);
          clearChat().catch((error: unknown) => setFailure(commentFailure(error)));
        }}
        onCancel={() => setClearing(false)}
      />
    </div>
  );
}
