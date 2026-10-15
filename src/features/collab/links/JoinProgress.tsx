import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { formatNumber } from "@/lib/intl";
import { logError } from "@/lib/log";
import type { CollabJoinProgress } from "@/lib/tauri";
import { COLLAB_JOIN_PROGRESS_EVENT, collabJoinCancel } from "@/lib/tauri-collab";

export interface JoinTarget {
  serverId: string;
  sharedProjectId: string;
}

interface Counted {
  key: string;
  done: number;
  total: number;
}

function keyOf(target: { serverId: string; sharedProjectId: string }): string {
  return `${target.serverId}:${target.sharedProjectId}`;
}

// How far the download of `target` has got, or null before the first report.
export function useJoinProgress(target: JoinTarget | null): { done: number; total: number } | null {
  const key = target ? keyOf(target) : null;
  const [counted, setCounted] = useState<Counted | null>(null);
  useTauriEvent<CollabJoinProgress>(
    COLLAB_JOIN_PROGRESS_EVENT,
    (payload) => {
      const reported = keyOf(payload);
      if (reported === key) setCounted({ key: reported, done: payload.done, total: payload.total });
    },
    key !== null,
  );
  return counted !== null && counted.key === key ? { done: counted.done, total: counted.total } : null;
}

// Shows how a join is going, with a Cancel that stops it. Until the first
// report, or while there is nothing to count, the bar just shows activity.
export function JoinProgress({
  target,
  name,
  onCancel,
}: Readonly<{ target: JoinTarget; name: string | null; onCancel?: () => void }>) {
  const { t } = useTranslation(["collab", "common"]);
  const progress = useJoinProgress(target);
  const [stopping, setStopping] = useState<string | null>(null);
  const key = keyOf(target);
  const counting = progress !== null && progress.total > 0;
  const cancelling = stopping === key;
  let status = t(($) => $.collab.links.opening);
  if (cancelling) status = t(($) => $.collab.links.cancelling);
  else if (counting) {
    status = t(($) => $.collab.links.downloading, {
      done: formatNumber(progress.done),
      total: formatNumber(progress.total),
    });
  }
  const cancel = () => {
    setStopping(key);
    onCancel?.();
    collabJoinCancel(target.serverId, target.sharedProjectId).catch((error: unknown) => {
      setStopping(null);
      void logError("collab join cancel", error);
    });
  };
  return (
    <div className="space-y-1.5" data-testid="collab-join-progress">
      <Progress
        value={counting ? (progress.done / progress.total) * 100 : 0}
        indeterminate={!counting || cancelling}
        label={status}
      />
      <div className="flex items-center gap-2">
        <output className="min-w-0 flex-1 text-xs text-muted-foreground">{status}</output>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={cancelling}
          aria-label={name === null ? undefined : t(($) => $.collab.links.cancelNamed, { name })}
          onClick={cancel}
        >
          {t(($) => $.common.actions.cancel)}
        </Button>
      </div>
    </div>
  );
}
