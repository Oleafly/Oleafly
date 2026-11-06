import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { GitBranch, GitFork, LogOut, Trash2 } from "@/components/icons/pack";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { acpFork, acpLogout, acpSessionRename, type AcpSession } from "@/lib/acp";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { DeleteConversationDialog, RenameInput, deleteConversation } from "./AcpHistoryDialog";

export function AcpSessionHeader({
  projectId,
  session,
  agentName,
  busy,
  perform,
}: Readonly<{
  projectId: string;
  session: AcpSession;
  agentName: string;
  busy: boolean;
  perform(action: () => Promise<void>): void;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const running = session.status === "running" || session.status === "cancelling";
  const canFork = !!session.capabilities.fork;
  const revision = session.startRevision?.slice(0, 7);

  const save = (value: string) => {
    setEditing(false);
    const title = value.trim();
    if (!title || title === session.title) return;
    perform(async () => {
      const saved = await acpSessionRename(projectId, session.id, title);
      useAcpSessionsStore.setState((state) => state.sessions[saved.id]
        ? { sessions: { ...state.sessions, [saved.id]: { ...state.sessions[saved.id], title: saved.title, titleLocked: true } } }
        : state);
    });
  };

  return (
    <div data-testid="acp-session-header" className="flex min-w-0 items-center gap-1.5 border-b px-3 py-1.5 text-xs">
      {editing ? (
        <RenameInput
          initial={session.title}
          className="h-6 min-w-0 flex-1 text-xs"
          onSave={save}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <Tooltip label={t(($) => $.ai.acp.history.rename)}>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid="acp-session-title"
            className="h-6 min-w-0 flex-1 justify-start rounded px-1 text-xs font-medium"
            onClick={() => setEditing(true)}
          >
            <span className="truncate">{session.title || t(($) => $.ai.acp.untitledConversation)}</span>
          </Button>
        </Tooltip>
      )}
      {revision && (
        <Badge variant="secondary" size="sm" className="shrink-0 gap-1 font-mono" data-testid="acp-start-revision">
          <GitBranch className="size-3" />
          {session.startDirty
            ? t(($) => $.ai.acp.header.startedDirty, { revision })
            : t(($) => $.ai.acp.header.startedAt, { revision })}
        </Badge>
      )}
      {session.capabilities.protocol === 2 && (
        <Badge variant="outline" size="sm" className="shrink-0">{t(($) => $.ai.acp.header.v2)}</Badge>
      )}
      {session.remote && (
        <Badge variant="outline" size="sm" className="shrink-0">{t(($) => $.ai.acp.header.remote)}</Badge>
      )}
      <DropdownMenu>
        <Tooltip label={t(($) => $.ai.acp.header.menu)}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t(($) => $.ai.acp.header.menu)}
              data-testid="acp-session-menu"
              className="size-6 shrink-0 text-muted-foreground [&_svg]:size-3.5"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align="end" className="z-[100] w-56">
          <DropdownMenuItem
            data-testid="acp-fork"
            disabled={busy || !canFork || running || session.status !== "ready"}
            onSelect={() => perform(async () => {
              const snapshot = await acpFork(projectId, session.id);
              const store = useAcpSessionsStore.getState();
              store.setSnapshot(snapshot);
              await store.open(projectId, snapshot.session.id);
            })}
          >
            <GitFork className="size-3.5" />
            <span className="min-w-0 flex-1">
              {t(($) => $.ai.acp.header.fork)}
              {!canFork && <span className="block text-[0.625rem] text-muted-foreground">{t(($) => $.ai.acp.header.forkUnsupported)}</span>}
              {canFork && running && <span className="block text-[0.625rem] text-muted-foreground">{t(($) => $.ai.acp.header.forkBusy)}</span>}
            </span>
          </DropdownMenuItem>
          {session.capabilities.logout && (
            <DropdownMenuItem
              data-testid="acp-sign-out"
              disabled={busy || running}
              onSelect={() => setSigningOut(true)}
            >
              <LogOut className="size-3.5" />
              {t(($) => $.ai.acp.signIn.signOut)}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={busy || running}
            className="text-destructive"
            onSelect={() => setDeleting(true)}
          >
            <Trash2 className="size-3.5" />
            {t(($) => $.ai.acp.history.delete)}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmationDialog
        open={signingOut}
        destructive
        title={t(($) => $.ai.acp.header.signOutTitle, { agent: agentName })}
        description={t(($) => $.ai.acp.header.signOutDescription, { agent: agentName })}
        confirmLabel={t(($) => $.ai.acp.signIn.signOut)}
        onCancel={() => setSigningOut(false)}
        onConfirm={() => {
          setSigningOut(false);
          perform(async () => {
            useAcpSessionsStore.getState().setSnapshot(await acpLogout(projectId, session.id));
          });
        }}
      >
        {session.usage?.auth?.label && (
          <p className="mt-2 select-text text-xs font-medium">
            {t(($) => $.ai.acp.header.signOutAccount, { account: session.usage.auth.label })}
          </p>
        )}
      </ConfirmationDialog>
      <DeleteConversationDialog
        session={session}
        agentName={agentName}
        open={deleting}
        onCancel={() => setDeleting(false)}
        onConfirm={(fromAgent) => {
          setDeleting(false);
          perform(() => deleteConversation(projectId, session, fromAgent, agentName));
        }}
      />
    </div>
  );
}
