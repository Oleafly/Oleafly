import { type ComponentType, type SVGProps, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Ban,
  CircleAlert,
  CircleArrowUp,
  CirclePause,
  CloudCheck,
  CloudOff,
  CloudUpload,
  LogOut,
  Moon,
  RefreshCw,
  Replace,
  RotateCcw,
  ServerCog,
  ServerOff,
  UserLock,
  UserX,
} from "lucide-react";
import { formatNumber } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { RECONNECTING_AFTER_MS, type SyncState } from "./sync-state";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const SYNC_ICONS: Readonly<Record<SyncState, Icon>> = {
  upToDate: CloudCheck,
  syncing: CloudUpload,
  offline: CloudOff,
  reconnecting: RefreshCw,
  signedOut: LogOut,
  idle: Moon,
  suspended: UserLock,
  accessEnded: Ban,
  removed: UserX,
  projectDeleted: Ban,
  archived: Archive,
  paused: CirclePause,
  serverRemoved: ServerOff,
  clientTooOld: CircleArrowUp,
  serverTooOld: ServerCog,
  serverChanged: Replace,
  failed: CircleAlert,
  engineSpent: RotateCcw,
};

const SYNC_TONES: Readonly<Record<SyncState, string>> = {
  upToDate: "text-muted-foreground",
  syncing: "text-primary",
  offline: "text-amber-600 dark:text-amber-400",
  reconnecting: "text-amber-600 dark:text-amber-400",
  signedOut: "text-destructive",
  idle: "text-muted-foreground",
  suspended: "text-destructive",
  accessEnded: "text-destructive",
  removed: "text-destructive",
  projectDeleted: "text-destructive",
  archived: "text-muted-foreground",
  paused: "text-muted-foreground",
  serverRemoved: "text-destructive",
  clientTooOld: "text-destructive",
  serverTooOld: "text-destructive",
  serverChanged: "text-destructive",
  failed: "text-destructive",
  engineSpent: "text-destructive",
};

const SYNC_DOTS: Readonly<Partial<Record<SyncState, string>>> = {
  syncing: "bg-primary motion-safe:animate-pulse",
  offline: "bg-amber-500",
  reconnecting: "bg-amber-500 motion-safe:animate-pulse",
  signedOut: "bg-destructive",
  suspended: "bg-destructive",
  accessEnded: "bg-destructive",
  removed: "bg-destructive",
  projectDeleted: "bg-destructive",
  archived: "bg-muted-foreground",
  paused: "bg-muted-foreground",
  serverRemoved: "bg-destructive",
  clientTooOld: "bg-destructive",
  serverTooOld: "bg-destructive",
  serverChanged: "bg-destructive",
  failed: "bg-destructive",
  engineSpent: "bg-destructive",
};

export function SyncStateDot({ state, className }: Readonly<{ state: SyncState; className?: string }>) {
  const tone = SYNC_DOTS[state];
  if (!tone) return null;
  return (
    <span
      aria-hidden
      data-sync-dot={state}
      className={cn("pointer-events-none absolute size-2 rounded-full border border-background", tone, className)}
    />
  );
}

export function SyncStateIcon({ state, className }: Readonly<{ state: SyncState; className?: string }>) {
  const Glyph = SYNC_ICONS[state];
  return <Glyph aria-hidden className={cn("size-4 shrink-0", SYNC_TONES[state], className)} />;
}

export function useSyncWords(state: SyncState, pending: number): string {
  const { t } = useTranslation(["collab"]);
  if (state === "offline") return t(($) => $.collab.sync.offline, { number: formatNumber(pending) });
  return t(($) => $.collab.sync[state]);
}


const DROPPED: ReadonlySet<SyncState> = new Set(["offline", "reconnecting"]);

export function useQuietDrop(state: SyncState): SyncState {
  const [shown, setShown] = useState(state);
  const dropped = DROPPED.has(state);
  useEffect(() => {
    if (!dropped) {
      setShown(state);
      return;
    }
    const timer = window.setTimeout(() => setShown(state), RECONNECTING_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [state, dropped]);
  return dropped && !DROPPED.has(shown) ? shown : state;
}
