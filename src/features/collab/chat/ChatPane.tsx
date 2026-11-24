import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eraser, MessagesSquare } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useChatRail } from "@/components/collab/chat-rail";
import { SidebarPanelHeader } from "@/components/layout/SidebarSection";
import { CommentScrollArea } from "@/components/ui/comments/comment-arrivals";
import { CommentComposer } from "@/components/ui/comments/comment-composer";
import { presenceText, TypingLine, useChatTyping } from "@/components/ui/comments/comment-presence";
import { chatGroups } from "@/components/ui/comments/comment-bubble";
import { CommentItem } from "@/components/ui/comments/comment-item";
import { Button } from "@/components/ui/button";
import type { CommentMessageActions } from "@/components/ui/comments/comment-entry";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { useNow } from "@/hooks/use-now";
import { formatNumber } from "@/lib/intl";
import type { CollabChatMessage } from "@/lib/tauri";
import { useComments } from "../comments/comments-store";
import { DesktopCommentKit, useMentionMembers } from "../comments/desktop-comment-kit";
import { commentFailure } from "../comments/refusals";
import { entryFor, useAuthorNames } from "../comments/ThreadCard";
import { collabErrorMessage } from "../errors";
import { InlineAlert, LoadFailed } from "../feedback";
import { liveSelfId, useCollabLiveStore } from "../live/live-store";
import { sendPresenceActivity } from "../live/peer-activity";
import { type ListedPerson, peopleById } from "../people";
import {
  chatDraft,
  clearChat,
  deleteChat,
  editChat,
  keepChatDraft,
  loadChat,
  loadOlderChat,
  pendingChat,
  reactToChat,
  sendChat,
  showPendingChat,
  useChat,
} from "./chat-store";

const TICK_MS = 60_000;
const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "]);
const PRESSED = "button, summary, [role='button']";
const CHAT_SCOPE = { kind: "chat" } as const;

function chatActivity(active: boolean): void {
  sendPresenceActivity(CHAT_SCOPE, active);
}

const CHAT_ACTIONS: CommentMessageActions = { remove: deleteChat, react: reactToChat };
const EDITABLE_CHAT_ACTIONS: CommentMessageActions = { ...CHAT_ACTIONS, edit: editChat };

const MessageRow = memo(function MessageRow({
  message,
  person,
  canPost,
  reactions,
  actions,
  continued,
}: Readonly<{
  message: CollabChatMessage;
  person: ListedPerson | undefined;
  canPost: boolean;
  reactions: boolean;
  actions: CommentMessageActions;
  continued: boolean;
}>) {
  const names = useAuthorNames();
  return (
    <CommentItem
      variant="bubble"
      continued={continued}
      entry={entryFor(message, person, names)}
      canWrite={canPost}
      canReact={canPost && reactions}
      actions={actions}
    />
  );
});

function ChatTypingLine() {
  const { t } = useTranslation(["collab"]);
  const typing = useChatTyping();
  return (
    <TypingLine
      people={typing}
      label={presenceText(
        {
          one: (name) => t(($) => $.collab.chat.typingOne, { name }),
          two: (first, second) => t(($) => $.collab.chat.typingTwo, { first, second }),
          many: (count) => t(($) => $.collab.chat.typingMany, { number: formatNumber(count) }),
        },
        typing.map((person) => person.name),
      )}
      className="px-3 pb-1"
    />
  );
}

function ChatEntry({
  projectId,
  canPost,
  connected,
  typing,
}: Readonly<{ projectId: string | null; canPost: boolean; connected: boolean; typing: boolean }>) {
  const { t } = useTranslation(["collab"]);
  if (!canPost) {
    return (
      <p className="text-xs text-muted-foreground">
        {connected ? t(($) => $.collab.chat.readOnly) : t(($) => $.collab.chat.offline)}
      </p>
    );
  }
  const pending = pendingChat(projectId);
  return (
    <CommentComposer
      compact
      initial={pending?.body ?? chatDraft(projectId)}
      sending={pending?.sent}
      label={t(($) => $.collab.chat.label)}
      placeholder={t(($) => $.collab.chat.placeholder)}
      submitLabel={t(($) => $.collab.chat.send)}
      onSubmit={sendChat}
      onActivity={typing ? chatActivity : undefined}
    />
  );
}

export function ChatPane() {
  const projectId = useChat((state) => state.projectId);
  return <ProjectChat key={projectId ?? ""} />;
}

function ProjectChat() {
  const { t } = useTranslation(["collab", "common"]);
  const chat = useChat(
    useShallow((state) => ({
      projectId: state.projectId,
      status: state.status,
      messages: state.messages,
      phase: state.phase,
      error: state.error,
      hasOlder: state.hasOlder,
      loadingOlder: state.loadingOlder,
      cursor: state.cursor,
    })),
  );
  const live = useCollabLiveStore(
    useShallow((state) => ({
      members: state.members,
      liveState: state.status?.state ?? null,
      self: liveSelfId(state),
    })),
  );
  const [clearing, setClearing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const asked = useRef<string | null>(null);
  const placed = useRef(0);
  const now = useNow(TICK_MS);
  const members = useMentionMembers();
  const people = useMemo(() => peopleById(live.members), [live.members]);
  const connected = live.liveState !== null && live.liveState !== "ended";
  const canPost = connected && chat.status?.post === true;
  const canClear = connected && chat.status?.clear === true && chat.messages.some((message) => !message.deleted);
  const title = t(($) => $.collab.chat.title);
  const clearLabel = t(($) => $.collab.chat.clear);
  const reactions = chat.status?.reactions === true;
  const typing = useComments((state) => state.status?.typing === true);
  const actions = chat.status?.edit ? EDITABLE_CHAT_ACTIONS : CHAT_ACTIONS;
  const chatLabels = useMemo(
    () => ({
      deleted: t(($) => $.collab.chat.deleted),
      messageActions: t(($) => $.collab.chat.messageActions),
      editLabel: t(($) => $.collab.chat.editLabel),
      deleteMessageConfirm: {
        title: t(($) => $.collab.chat.deleteConfirm.title),
        description: t(($) => $.collab.chat.deleteConfirm.description),
      },
    }),
    [t],
  );

  const arrivals = useMemo(
    () => chat.messages.map((message) => ({ id: message.id, mine: message.verified && message.author === live.self, at: message.at })),
    [chat.messages, live.self],
  );

  const groups = useMemo(() => chatGroups(chat.messages), [chat.messages]);
  const reveal = useChatRail((state) => state.reveal);
  const revealLoaded = reveal !== null && chat.messages.some((message) => message.id === reveal);
  const loadFailed = chat.phase === "failed" && chat.messages.length === 0;
  const listed = chat.phase === "ready" || (chat.phase === "failed" && !loadFailed);
  useEffect(() => {
    if (!reveal) asked.current = null;
    if (!reveal || !listed || chat.loadingOlder) return;
    const done = (problem: string | null) => {
      setFailure(problem);
      useChatRail.setState({ reveal: null });
    };
    if (revealLoaded) {
      document.querySelector(`[data-comment-entry="${CSS.escape(reveal)}"]`)?.scrollIntoView({ block: "center" });
      done(null);
    } else if (chat.hasOlder) {
      const ask = `${reveal}\n${chat.cursor}`;
      if (asked.current === ask) return;
      asked.current = ask;
      loadOlderChat().catch((error: unknown) => {
        if (useChatRail.getState().reveal === reveal) done(commentFailure(error));
      });
    } else {
      done(collabErrorMessage("not_found"));
    }
  }, [reveal, revealLoaded, listed, chat.loadingOlder, chat.hasOlder, chat.cursor]);

  const searching = reveal !== null && !revealLoaded;
  useLayoutEffect(() => {
    if (searching && scroller.current) placed.current = scroller.current.scrollTop;
  });
  useEffect(() => {
    const element = scroller.current;
    if (!searching || !element) return;
    let clicked = false;
    placed.current = element.scrollTop;
    const moved = () => {
      if (useChatRail.getState().reveal === reveal) useChatRail.setState({ reveal: null });
    };
    const pressed = (event: PointerEvent) => {
      clicked = event.target instanceof Node && element.contains(event.target);
      if (event.target === element) moved();
    };
    const keyed = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || event.defaultPrevented || !SCROLL_KEYS.has(event.key)) return;
      const here = element.contains(target) || (clicked && (target === document.body || target === document.documentElement));
      if (here && !(event.key === " " && target.closest(PRESSED))) moved();
    };
    const scrolled = () => {
      if (Math.abs(element.scrollTop - placed.current) > 1) moved();
    };
    const resized = new ResizeObserver(() => {
      placed.current = element.scrollTop;
    });
    resized.observe(element);
    if (element.firstElementChild) resized.observe(element.firstElementChild);
    document.addEventListener("pointerdown", pressed, true);
    document.addEventListener("keydown", keyed);
    element.addEventListener("scroll", scrolled, { passive: true });
    element.addEventListener("wheel", moved, { passive: true });
    element.addEventListener("touchmove", moved, { passive: true });
    return () => {
      resized.disconnect();
      document.removeEventListener("pointerdown", pressed, true);
      document.removeEventListener("keydown", keyed);
      element.removeEventListener("scroll", scrolled);
      element.removeEventListener("wheel", moved);
      element.removeEventListener("touchmove", moved);
    };
  }, [searching, reveal]);

  useEffect(() => {
    const field = canPost ? composer.current?.querySelector("textarea") : null;
    if (!field) return;
    const projectId = chat.projectId;
    const hidden = showPendingChat(projectId);
    return () => {
      hidden();
      keepChatDraft(projectId, field.readOnly ? "" : field.value);
    };
  }, [canPost, chat.projectId]);

  const older = () => {
    setFailure(null);
    loadOlderChat().catch((error: unknown) => setFailure(commentFailure(error)));
  };

  const body = () => {
    if (loadFailed) {
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
      <div className="space-y-2 px-3 py-3">
        {chat.hasOlder ? (
          <div className="flex justify-center">
            <Button type="button" variant="ghost" size="xs" disabled={chat.loadingOlder} onClick={older}>
              {t(($) => $.collab.chat.loadOlder)}
            </Button>
          </div>
        ) : null}
        <ol aria-label={t(($) => $.collab.chat.list)}>
          {chat.messages.map((message, index) => (
            <MessageRow
              key={message.id}
              message={message}
              person={message.verified ? people.get(message.author) : undefined}
              canPost={canPost}
              reactions={reactions}
              actions={actions}
              continued={groups[index]}
            />
          ))}
        </ol>
      </div>
    );
  };

  return (
    <DesktopCommentKit
      now={now}
      self={live.self}
      members={members}
      people={people}
      reactions={reactions}
      typing={typing}
      math={chat.status?.math === true}
      markdown={chat.status?.markdown !== false}
      labels={chatLabels}
      maxLength={chat.status?.maxLength}
    >
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
        <CommentScrollArea
          items={arrivals}
          ready={chat.phase === "ready"}
          scope={chat.projectId ?? ""}
          scrollRef={scroller}
          stickToBottom
          label={(count) =>
            count === 1 ? t(($) => $.collab.chat.newOne) : t(($) => $.collab.chat.newMany, { number: formatNumber(count) })
          }
        >
          {body()}
        </CommentScrollArea>
        {typing ? <ChatTypingLine /> : null}
        {reveal !== null && !revealLoaded && !loadFailed ? (
          <output className="flex items-center gap-2 px-3 pb-2 text-xs text-muted-foreground">
            <Spinner size="xs" />
            {t(($) => $.common.state.loading)}
          </output>
        ) : null}
        {failure ? (
          <div className="px-3 pb-2">
            <InlineAlert>{failure}</InlineAlert>
          </div>
        ) : null}
        <div ref={composer} className="shrink-0 border-t border-sidebar-border px-3 py-2">
          <ChatEntry projectId={chat.projectId} canPost={canPost} connected={connected} typing={typing} />
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
    </DesktopCommentKit>
  );
}
