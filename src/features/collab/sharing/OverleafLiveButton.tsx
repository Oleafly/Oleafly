import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { ClipboardCopy, ExternalLink, LogIn, Pause, Play, RefreshCw, UserPlus } from "lucide-react";
import { PauseLiveDialog } from "@/components/layout/overleaf-sync/PauseLiveDialog";
import { usePauseLive } from "@/components/layout/overleaf-sync/use-pause-live";
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
import { overleafLiveActions } from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import { overleafLiveConnectionDetails, overleafProjectPage, type OverleafLiveProject } from "@/lib/overleaf-live";
import { collabLiveReconnectNow } from "@/lib/tauri-collab";
import { notifyError, toast } from "@/lib/toast";
import { useSettingsStore } from "@/store/settings";
import { type CollabLiveStoreState, useCollabLiveStore } from "../live/live-store";
import { useOverleafNotices } from "../live/overleaf-notices";
import { SyncStateIcon, useQuietDrop, useSyncWords } from "./sync-display";
import { type SyncState, syncState } from "./sync-state";

export function overleafSyncState(state: CollabLiveStoreState): SyncState {
  if (state.overleaf?.paused) return "paused";
  if (state.backend !== "overleaf" && !state.overleaf?.signedIn) return "signedOut";
  return syncState(state.status, state.pending);
}

function useRetryIn(): number | null {
  const status = useCollabLiveStore((live) => live.status);
  const [until, setUntil] = useState<number | null>(null);
  const now = useNow(1_000);
  useEffect(() => {
    setUntil(status?.state === "offline" ? Date.now() + status.retry_in_ms : null);
  }, [status]);
  if (until === null) return null;
  const seconds = Math.round((until - now) / 1_000);
  return seconds > 0 ? seconds : null;
}

function useOverleafWords(state: SyncState): { words: string; plain: string; notes: string[] } {
  const { t } = useTranslation(["shell"]);
  const pending = useCollabLiveStore((live) => live.pending);
  const slowAck = useOverleafNotices((notices) => notices.slowAck);
  const retryIn = useRetryIn();
  const plain = useSyncWords(state, pending);
  const words = useLiveWords(state, plain);
  const notes: string[] = [];
  const dropped = state === "offline" || state === "reconnecting";
  if (dropped && retryIn !== null) notes.push(t(($) => $.shell.overleafLive.reconnectingIn, { seconds: retryIn }));
  if (slowAck) notes.push(t(($) => $.shell.overleafLive.notConfirmed));
  return { words, plain, notes };
}

function StatusNotes({ notes }: Readonly<{ notes: string[] }>) {
  return notes.map((note) => (
    <span key={note} data-testid="overleaf-live-status-note" className="block">
      {note}
    </span>
  ));
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

function openPage(link: OverleafLiveProject) {
  openExternal(overleafProjectPage(link)).catch((error) => void logError("open overleaf project page", error));
}

export function OverleafLiveButton() {
  const { t } = useTranslation(["shell"]);
  const projectId = useCollabLiveStore((state) => state.projectId);
  const link = useCollabLiveStore((state) => state.overleaf);
  const live = useCollabLiveStore((state) => state.backend === "overleaf" && state.status?.state !== "ended");
  const state = useQuietDrop(useCollabLiveStore(overleafSyncState));
  const { words, plain, notes } = useOverleafWords(state);
  const { unsent, busy, pause, keepLive } = usePauseLive();
  if (!projectId || !link) return null;

  const resume = () => {
    overleafLiveActions()
      ?.resume(projectId)
      .catch((error) => void logError("resume overleaf live editing", error));
  };

  return (
    <>
      <DropdownMenu>
        <Tooltip
          label={
            <>
              {words}
              <StatusNotes notes={notes} />
            </>
          }
          side="bottom"
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              data-testid="overleaf-live-button"
              data-sync-state={state}
              aria-label={`${t(($) => $.shell.overleafLive.title)}: ${words}`}
              className="h-7 gap-1 px-1.5 text-muted-foreground hover:text-foreground"
            >
              <OverleafBrandIcon className="size-4 text-[#47A141]" />
              <SyncStateIcon state={state} className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="space-y-0.5">
            <span className="block text-sm">{t(($) => $.shell.overleafLive.title)}</span>
            <span className="block select-text text-xs font-normal text-muted-foreground">
              <span data-testid="overleaf-live-status" className="block">
                {state === "upToDate" ? plain : words}
              </span>
              <StatusNotes notes={notes} />
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {link.paused ? (
            <DropdownMenuItem data-testid="overleaf-live-resume" onSelect={resume}>
              <Play className="size-4 text-muted-foreground" />
              {t(($) => $.shell.overleafLive.resume)}
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
              {t(($) => $.shell.overleafLive.signIn)}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem data-testid="overleaf-live-open" onSelect={() => openPage(link)}>
            <ExternalLink className="size-4 text-muted-foreground" />
            {t(($) => $.shell.overleafLive.open)}
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="overleaf-live-share" onSelect={() => openPage(link)}>
            <UserPlus className="size-4 text-muted-foreground" />
            {t(($) => $.shell.overleafLive.share)}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PauseLiveDialog
        unsent={unsent}
        busy={busy}
        onKeepLive={keepLive}
        onPauseAnyway={() => void pause(projectId, true)}
      />
    </>
  );
}
