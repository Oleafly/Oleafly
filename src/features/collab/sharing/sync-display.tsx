import type { ComponentType, SVGProps } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Ban,
  CirclePause,
  CloudCheck,
  CloudOff,
  CloudUpload,
  LogOut,
  RefreshCw,
  UserLock,
  UserX,
} from "lucide-react";
import { formatNumber } from "@/lib/intl";
import { cn } from "@/lib/utils";
import type { SyncState } from "./sync-state";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const SYNC_ICONS: Readonly<Record<SyncState, Icon>> = {
  upToDate: CloudCheck,
  syncing: CloudUpload,
  offline: CloudOff,
  reconnecting: RefreshCw,
  signedOut: LogOut,
  suspended: UserLock,
  accessEnded: Ban,
  removed: UserX,
  archived: Archive,
  paused: CirclePause,
};

const SYNC_TONES: Readonly<Record<SyncState, string>> = {
  upToDate: "text-muted-foreground",
  syncing: "text-primary",
  offline: "text-amber-600 dark:text-amber-400",
  reconnecting: "text-amber-600 dark:text-amber-400",
  signedOut: "text-destructive",
  suspended: "text-destructive",
  accessEnded: "text-destructive",
  removed: "text-destructive",
  archived: "text-muted-foreground",
  paused: "text-muted-foreground",
};

export function SyncStateIcon({ state, className }: Readonly<{ state: SyncState; className?: string }>) {
  const Glyph = SYNC_ICONS[state];
  return <Glyph aria-hidden className={cn("size-4 shrink-0", SYNC_TONES[state], className)} />;
}

export function useSyncWords(state: SyncState, pending: number): string {
  const { t } = useTranslation(["collab"]);
  if (state === "offline") return t(($) => $.collab.sync.offline, { number: formatNumber(pending) });
  return t(($) => $.collab.sync[state]);
}

