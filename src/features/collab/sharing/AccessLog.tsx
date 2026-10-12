import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollText } from "lucide-react";
import { SidebarSection } from "@/components/layout/SidebarSection";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/empty";
import { formatDateTime, formatRelativeTimeFrom } from "@/lib/intl";
import { collabAccessLogPage, type CollabAccessEntry } from "@/lib/tauri";
import { collabErrorCode, collabErrorMessage } from "../errors";
import { InlineAlert, LoadFailed } from "../feedback";
import { useCollabLiveStore } from "../live/live-store";
import { collabPerson } from "../people";
import { useAccessLogSwitches } from "./access-log-store";

const TICK_MS = 60_000;

type Translate = ReturnType<typeof useTranslation<["collab"]>>["t"];

interface Loaded {
  projectId: string;
  entries: readonly CollabAccessEntry[];
  cursor: string | null;
}

function sentence(entry: CollabAccessEntry, t: Translate): string {
  const name = entry.person.display_name || t(($) => $.collab.toolbar.unknownPerson);
  switch (entry.kind) {
    case "opened":
      return t(($) => $.collab.accessLog.opened, { name });
    case "downloaded":
      return t(($) => $.collab.accessLog.downloaded, { name });
    case "joined":
      return entry.via === "link"
        ? t(($) => $.collab.accessLog.joinedLink, { name })
        : t(($) => $.collab.accessLog.joinedShare, { name });
    default:
      return t(($) => $.collab.accessLog.unknown, { name });
  }
}

const AccessRow = memo(function AccessRow({ entry, now }: Readonly<{ entry: CollabAccessEntry; now: number }>) {
  const { t } = useTranslation(["collab"]);
  const span =
    entry.times > 1 && entry.last_at > entry.at
      ? t(($) => $.collab.accessLog.span, { from: formatDateTime(entry.at), to: formatDateTime(entry.last_at) })
      : formatDateTime(entry.at);
  return (
    <li className="flex items-start gap-2 rounded-md px-1 py-1.5 text-xs">
      <Avatar person={collabPerson(entry.person)} size="xs" className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="select-text break-words font-medium">{sentence(entry, t)}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
          <span className="min-w-0 truncate">{entry.device_name || t(($) => $.collab.accessLog.unknownDevice)}</span>
          <time dateTime={new Date(entry.at).toISOString()} title={span}>
            {formatRelativeTimeFrom(entry.at, now)}
          </time>
        </p>
      </div>
    </li>
  );
});

function AccessList({ projectId, title }: Readonly<{ projectId: string; title: string }>) {
  const { t } = useTranslation(["collab"]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(projectId);
  latest.current = projectId;

  const load = useCallback(
    async (cursor: string | null) => {
      setBusy(true);
      if (cursor === null) setLoadError(null);
      else setMoreError(null);
      try {
        const page = await collabAccessLogPage(projectId, cursor);
        if (latest.current !== projectId) return;
        setLoaded((current) => ({
          projectId,
          entries:
            cursor !== null && current?.projectId === projectId ? [...current.entries, ...page.items] : page.items,
          cursor: page.next_cursor,
        }));
      } catch (error) {
        if (latest.current !== projectId) return;
        const message = collabErrorMessage(collabErrorCode(error));
        if (cursor === null) setLoadError(message);
        else setMoreError(message);
      } finally {
        if (latest.current === projectId) setBusy(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    setLoaded(null);
    setMoreError(null);
    void load(null);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  if (loadError) {
    return (
      <LoadFailed
        message={t(($) => $.collab.accessLog.loadFailed)}
        reason={loadError}
        onRetry={() => void load(null)}
      />
    );
  }
  const current = loaded?.projectId === projectId ? loaded : null;
  if (!current) return <LoadingState size="compact" label={t(($) => $.collab.accessLog.loading)} />;
  if (current.entries.length === 0) {
    return <p className="px-1 text-xs text-muted-foreground">{t(($) => $.collab.accessLog.empty)}</p>;
  }
  return (
    <>
      <ul aria-label={title} className="space-y-0.5">
        {current.entries.map((entry) => (
          <AccessRow key={entry.id} entry={entry} now={now} />
        ))}
      </ul>
      {moreError ? <InlineAlert>{moreError}</InlineAlert> : null}
      {current.cursor ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-full text-xs"
          disabled={busy}
          onClick={() => void load(current.cursor)}
        >
          {t(($) => $.collab.accessLog.more)}
        </Button>
      ) : null}
    </>
  );
}

export function AccessLog({ open, onOpenChange }: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const { t } = useTranslation(["collab"]);
  const projectId = useCollabLiveStore((state) => state.projectId);
  const owner = useCollabLiveStore((state) => (state.role ?? state.share?.role) === "owner");
  const status = useAccessLogSwitches((state) => (projectId ? state.byProject[projectId] : undefined));

  useEffect(() => {
    if (owner && projectId) void useAccessLogSwitches.getState().load(projectId);
  }, [owner, projectId]);

  if (!owner || !projectId || !status?.serverAllowed || !status.enabled) return null;
  const title = t(($) => $.collab.pane.accessLog);
  return (
    <SidebarSection
      id="collab-access-log"
      title={title}
      icon={<ScrollText aria-hidden className="size-3.5" />}
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="space-y-1 px-2 py-1"
    >
      <AccessList projectId={projectId} title={title} />
    </SidebarSection>
  );
}
