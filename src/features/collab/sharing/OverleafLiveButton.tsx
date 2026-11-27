import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardCopy, ExternalLink, LogIn, Pause, Play, RefreshCw, RotateCcw, UserPlus } from "lucide-react";
import { PauseLiveDialog } from "@/components/layout/overleaf-sync/PauseLiveDialog";
import { resumeLive, usePauseLive } from "@/components/layout/overleaf-sync/use-pause-live";
import { OverleafBrandIcon } from "@/components/settings/IntegrationBrandIcons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useNow } from "@/hooks/use-now";
import { writeClipboardText } from "@/lib/clipboard";
import { logError } from "@/lib/log";
import { openOverleafProject, overleafLiveConnectionDetails } from "@/lib/overleaf-live";
import { collabLiveReconnectNow } from "@/lib/tauri-collab";
import { notifyError, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { ToolbarAction } from "@/components/layout/ToolbarAction";
import { useSettingsStore } from "@/store/settings";
import { collabErrorMessage } from "../errors";
import { type CollabLiveStoreState, useCollabLiveStore } from "../live/live-store";
import { useOverleafNotices } from "../live/overleaf-notices";
import { SyncStateDot, SyncStateIcon, useQuietDrop, useSyncWords } from "./sync-display";
import { type SyncState, syncState } from "./sync-state";

function overleafSyncState(state: CollabLiveStoreState): SyncState {
  if (state.overleaf?.paused) return "paused";
  if (state.backend !== "overleaf" && !state.overleaf?.signedIn) return "signedOut";
  return syncState(state.status, state.pending);
}

function useRetryUntil(): number | null {
  const status = useCollabLiveStore((live) => live.status);
  const [until, setUntil] = useState<number | null>(null);
  useEffect(() => {
    setUntil(status?.state === "offline" ? Date.now() + status.retry_in_ms : null);
  }, [status]);
  return until;
}

function useOverleafWords(state: SyncState): { words: string; plain: string; notes: string[]; retryUntil: number | null } {
  const { t } = useTranslation(["shell"]);
  const pending = useCollabLiveStore((live) => live.pending);
  const refused = useCollabLiveStore((live) => live.refused);
  const refusedParams = useCollabLiveStore((live) => live.refusedParams);
  const slowAck = useOverleafNotices((notices) => notices.slowAck);
  const until = useRetryUntil();
  const plain = useSyncWords(state, pending);
  const words = useLiveWords(state, plain);
  const notes: string[] = [];
  if (refused) notes.push(collabErrorMessage(refused, undefined, refusedParams));
  if (slowAck) notes.push(t(($) => $.shell.overleafLive.notConfirmed));
  const dropped = state === "offline" || state === "reconnecting";
  return { words, plain, notes, retryUntil: dropped ? until : null };
}

function RetryNote({ until }: Readonly<{ until: number }>) {
  const { t } = useTranslation(["shell"]);
  const now = useNow(1_000);
  const seconds = Math.round((until - now) / 1_000);
  if (seconds <= 0) return null;
  return (
    <span data-testid="overleaf-live-status-note" className="block">
      {t(($) => $.shell.overleafLive.reconnectingIn, { seconds })}
    </span>
  );
}

function StatusNotes({ notes, retryUntil }: Readonly<{ notes: string[]; retryUntil: number | null }>) {
  return (
    <>
      {retryUntil === null ? null : <RetryNote until={retryUntil} />}
      {notes.map((note) => (
        <span key={note} data-testid="overleaf-live-status-note" className="block">
          {note}
        </span>
      ))}
    </>
  );
}

function copyDetails(projectId: string, copied: string, failed: string) {
  overleafLiveConnectionDetails(projectId)
    .then((details) => writeClipboardText(JSON.stringify(details, null, 2)))
    .then(
      () => toast.success(copied),
      (error: unknown) => notifyError("copy overleaf connection details", error, failed),
    );
}

function useLiveWords(state: SyncState, words: string): string {
  const { t } = useTranslation(["shell"]);
  const connecting = useCollabLiveStore((live) => live.status === null || live.status.state === "connecting");
  if (state === "upToDate") return t(($) => $.shell.overleafLive.live);
  if (state === "syncing") return connecting ? t(($) => $.shell.overleafLive.connecting) : t(($) => $.shell.overleafLive.sending);
  if (state === "reconnecting") return t(($) => $.shell.overleafLive.reconnecting);
  return words;
}

export function OverleafLiveButton() {
  const { t } = useTranslation(["shell", "collab"]);
  const projectId = useCollabLiveStore((state) => state.projectId);
  const link = useCollabLiveStore((state) => (state.share === null ? state.overleaf : null));
  const live = useCollabLiveStore((state) => state.backend === "overleaf" && state.status?.state !== "ended");
  const failed = useCollabLiveStore((state) => state.backend === "overleaf" && state.ended === "failed");
  const state = useQuietDrop(useCollabLiveStore(overleafSyncState));
  const { words, plain, notes, retryUntil } = useOverleafWords(state);
  const { unsent, busy, pause, keepLive } = usePauseLive();
  if (!projectId || !link) return null;

  return (
    <>
      <ToolbarAction name="overleaf-live">
        <DropdownMenu>
          <Tooltip
            label={
              <>
                {words}
                <StatusNotes notes={notes} retryUntil={retryUntil} />
              </>
            }
            side="bottom"
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                data-testid="overleaf-live-button"
                data-sync-state={state}
                aria-label={`${t(($) => $.shell.overleafLive.title)}: ${words}`}
                className="relative size-7 text-muted-foreground hover:text-foreground"
              >
                <OverleafBrandIcon
                  className={cn("text-[#47A141]", state === "syncing" && "motion-safe:animate-pulse")}
                />
                <SyncStateDot state={state} className="right-1 top-1" />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="flex select-text items-start gap-2 py-1.5 text-xs font-normal text-muted-foreground">
              <SyncStateIcon state={state} className="mt-px size-3.5" />
              <span className="min-w-0">
                <span data-testid="overleaf-live-status" className="block">
                  {state === "upToDate" ? plain : words}
                </span>
                <StatusNotes notes={notes} retryUntil={retryUntil} />
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {link.paused ? (
              <DropdownMenuItem data-testid="overleaf-live-resume" onSelect={() => resumeLive(projectId)}>
                <Play className="size-4 text-muted-foreground" />
                {t(($) => $.shell.overleafLive.resume)}
              </DropdownMenuItem>
            ) : null}
            {failed && !link.paused ? (
              <DropdownMenuItem
                data-testid="overleaf-live-again"
                onSelect={() => useCollabLiveStore.getState().goLiveAgain()}
              >
                <RotateCcw className="size-4 text-muted-foreground" />
                {t(($) => $.collab.activity.goLiveAgain)}
              </DropdownMenuItem>
            ) : null}
            {live ? (
              <DropdownMenuItem data-testid="overleaf-live-pause" disabled={busy} onSelect={() => void pause(projectId)}>
                <Pause className="size-4 text-muted-foreground" />
                {t(($) => $.shell.overleafLive.pause)}
              </DropdownMenuItem>
            ) : null}
            {live && (state === "offline" || state === "reconnecting") ? (
              <DropdownMenuItem
                data-testid="overleaf-live-reconnect"
                onSelect={() => {
                  collabLiveReconnectNow().catch((error) => void logError("reconnect to overleaf", error));
                }}
              >
                <RefreshCw className="size-4 text-muted-foreground" />
                {t(($) => $.shell.overleafLive.reconnectNow)}
              </DropdownMenuItem>
            ) : null}
            {live ? (
              <DropdownMenuItem
                data-testid="overleaf-live-copy-details"
                onSelect={() =>
                  copyDetails(
                    projectId,
                    t(($) => $.shell.overleafLive.detailsCopied),
                    t(($) => $.shell.overleafLive.copyDetailsFailed),
                  )
                }
              >
                <ClipboardCopy className="size-4 text-muted-foreground" />
                {t(($) => $.shell.overleafLive.copyDetails)}
              </DropdownMenuItem>
            ) : null}
            {state === "signedOut" ? (
              <DropdownMenuItem
                data-testid="overleaf-live-sign-in"
                onSelect={() => useSettingsStore.getState().openSettingsAt("integrations")}
              >
                <LogIn className="size-4 text-muted-foreground" />
                {link.account?.email
                  ? t(($) => $.shell.overleafLive.signInAs, { email: link.account.email })
                  : t(($) => $.shell.overleafLive.signIn)}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem data-testid="overleaf-live-open" onSelect={() => void openOverleafProject(link)}>
              <ExternalLink className="size-4 text-muted-foreground" />
              {t(($) => $.shell.overleafLive.open)}
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="overleaf-live-share" onSelect={() => void openOverleafProject(link)}>
              <UserPlus className="size-4 text-muted-foreground" />
              {t(($) => $.shell.overleafLive.share)}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ToolbarAction>
      <PauseLiveDialog
        unsent={unsent}
        busy={busy}
        onKeepLive={keepLive}
        onPauseAnyway={() => void pause(projectId, true)}
      />
    </>
  );
}
