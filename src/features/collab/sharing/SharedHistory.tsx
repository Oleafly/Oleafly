import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";
import { History } from "@/components/icons/pack";
import { useShallow } from "zustand/react/shallow";
import { SidebarSection } from "@/components/layout/SidebarSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDate, formatDateTime, formatNameList, formatNumber, formatTime } from "@/lib/intl";
import { logError } from "@/lib/log";
import type { CollabHistoryEntry } from "@/lib/tauri";
import { collabHistoryList, collabVersionName, collabVersionUnname } from "@/lib/tauri-collab";
import { useFilesStore } from "@/store/files";
import { collabErrorText } from "../errors";
import { InlineAlert, LoadFailed } from "../feedback";
import { useCollabLiveStore } from "../live/live-store";
import { canEditProjectRole } from "../roles";
import { HistoryCompareDialog } from "./HistoryCompareDialog";
import { historyDays, mergeHistory, olderFirst } from "./history-days";
import { HistoryVersionDialog } from "./HistoryVersionDialog";
import { middleEllipsisPath } from "./middle-ellipsis";

export const HISTORY_PAGE = 50;
const NAME_LIMIT = 120;
const PATH_CHARS = 34;

interface HistoryState {
  projectId: string | null;
  entries: CollabHistoryEntry[];
  nextBefore: string | null;
  phase: "idle" | "loading" | "ready" | "failed";
  failure: string | null;
  loadingMore: boolean;
}

const EMPTY: HistoryState = {
  projectId: null,
  entries: [],
  nextBefore: null,
  phase: "idle",
  failure: null,
  loadingMore: false,
};

function useSharedHistory(projectId: string | null, open: boolean) {
  const [state, setState] = useState<HistoryState>(EMPTY);
  const request = useRef(0);
  const latest = useRef(projectId);
  latest.current = projectId;
  const reload = useCallback(async () => {
    if (!projectId) return;
    const ticket = ++request.current;
    setState((current) =>
      current.projectId === projectId
        ? { ...current, phase: current.phase === "ready" ? "ready" : "loading", failure: null }
        : { ...EMPTY, projectId, phase: "loading" },
    );
    try {
      const page = await collabHistoryList(projectId, null, HISTORY_PAGE);
      if (ticket !== request.current || latest.current !== projectId) return;
      setState({
        projectId,
        entries: page.entries,
        nextBefore: page.nextBefore,
        phase: "ready",
        failure: null,
        loadingMore: false,
      });
    } catch (error) {
      void logError("collab history list", error);
      if (ticket !== request.current || latest.current !== projectId) return;
      setState((current) => ({ ...current, projectId, phase: "failed", failure: collabErrorText(error) }));
    }
  }, [projectId]);
  const loadMore = useCallback(async () => {
    const before = state.nextBefore;
    if (!projectId || !before || state.loadingMore) return;
    const ticket = request.current;
    setState((current) => ({ ...current, loadingMore: true, failure: null }));
    try {
      const page = await collabHistoryList(projectId, before, HISTORY_PAGE);
      if (ticket !== request.current || latest.current !== projectId) return;
      setState((current) => ({
        ...current,
        entries: mergeHistory(current.entries, page.entries),
        nextBefore: page.nextBefore,
        loadingMore: false,
      }));
    } catch (error) {
      void logError("collab history more", error);
      if (ticket !== request.current || latest.current !== projectId) return;
      setState((current) => ({ ...current, loadingMore: false, failure: collabErrorText(error) }));
    }
  }, [projectId, state.nextBefore, state.loadingMore]);
  useEffect(() => {
    if (open && projectId) void reload();
  }, [open, projectId, reload]);
  const shown = state.projectId === projectId ? state : EMPTY;
  return { ...shown, reload, loadMore };
}

function NameForm({
  initial,
  onSave,
  onCancel,
}: Readonly<{ initial: string; onSave: (name: string) => Promise<void>; onCancel: () => void }>) {
  const { t } = useTranslation(["collab", "common"]);
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    onSave(value)
      .catch((error_: unknown) => setError(collabErrorText(error_)))
      .finally(() => setBusy(false));
  };
  return (
    <form onSubmit={submit} className="mt-1 space-y-1.5">
      <Input
        autoFocus
        value={name}
        maxLength={NAME_LIMIT}
        aria-label={t(($) => $.collab.history.nameLabel)}
        placeholder={t(($) => $.collab.history.namePlaceholder)}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        className="h-7 text-xs"
      />
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
          {t(($) => $.common.actions.cancel)}
        </Button>
        <Button type="submit" size="xs" disabled={busy || name.trim() === ""}>
          {t(($) => $.common.actions.save)}
        </Button>
      </div>
      {error ? <InlineAlert>{error}</InlineAlert> : null}
    </form>
  );
}

function EntryTime({ entry }: Readonly<{ entry: CollabHistoryEntry }>) {
  const { t } = useTranslation(["collab"]);
  if (entry.at <= 0) return <span className="font-medium">{t(($) => $.collab.history.earlier)}</span>;
  const from = formatTime(entry.at);
  const to = formatTime(entry.until);
  const when = entry.until > entry.at && from !== to ? t(($) => $.collab.history.timeRange, { from, to }) : from;
  return (
    <Tooltip label={formatDateTime(entry.at)}>
      <time dateTime={new Date(entry.at).toISOString()} className="font-medium tabular-nums">
        {when}
      </time>
    </Tooltip>
  );
}

function EntryFiles({ files }: Readonly<{ files: readonly string[] }>) {
  const { t } = useTranslation(["collab"]);
  if (files.length === 1) {
    return (
      <Tooltip label={files[0]} wide className="block">
        <p className="truncate font-mono text-muted-foreground">{middleEllipsisPath(files[0], PATH_CHARS)}</p>
      </Tooltip>
    );
  }
  if (files.length === 0) return null;
  return (
    <p className="text-muted-foreground">
      {t(($) => $.collab.history.filesChanged, { number: formatNumber(files.length) })}
    </p>
  );
}

function EntryActions({
  entry,
  canEdit,
  picking,
  pickedHere,
  onOpen,
  onCompare,
  onPick,
  onRename,
  onUnname,
}: Readonly<{
  entry: CollabHistoryEntry;
  canEdit: boolean;
  picking: boolean;
  pickedHere: boolean;
  onOpen: (entry: CollabHistoryEntry) => void;
  onCompare: (entry: CollabHistoryEntry) => void;
  onPick: (entry: CollabHistoryEntry) => void;
  onRename: () => void;
  onUnname: () => void;
}>) {
  const { t } = useTranslation(["collab"]);
  if (picking && pickedHere) return null;
  if (picking) {
    return (
      <Button type="button" variant="outline" size="xs" onClick={() => onPick(entry)}>
        {t(($) => $.collab.history.compareWith)}
      </Button>
    );
  }
  const nameLabel = entry.name ? t(($) => $.collab.history.rename) : t(($) => $.collab.history.name);
  return (
    <>
      <Button type="button" variant="ghost" size="xs" onClick={() => onOpen(entry)}>
        {t(($) => $.collab.history.open)}
      </Button>
      <Button type="button" variant="ghost" size="xs" onClick={() => onCompare(entry)}>
        {t(($) => $.collab.history.compare)}
      </Button>
      {canEdit ? (
        <Button type="button" variant="ghost" size="xs" onClick={onRename}>
          {nameLabel}
        </Button>
      ) : null}
      {canEdit && entry.name && entry.versionId ? (
        <Button type="button" variant="ghost" size="xs" onClick={onUnname}>
          {t(($) => $.collab.history.unname)}
        </Button>
      ) : null}
    </>
  );
}

const EntryRow = memo(function EntryRow({
  entry,
  names,
  canEdit,
  picking,
  pickedHere,
  onOpen,
  onCompare,
  onPick,
  onNamed,
}: Readonly<{
  entry: CollabHistoryEntry;
  names: ReadonlyMap<string, string>;
  canEdit: boolean;
  picking: boolean;
  pickedHere: boolean;
  onOpen: (entry: CollabHistoryEntry) => void;
  onCompare: (entry: CollabHistoryEntry) => void;
  onPick: (entry: CollabHistoryEntry) => void;
  onNamed: () => void;
}>) {
  const { t } = useTranslation(["collab"]);
  const [naming, setNaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectId = useCollabLiveStore((state) => state.projectId);
  const unknown = t(($) => $.collab.toolbar.unknownPerson);
  const authors = formatNameList(
    entry.authors.map((accountId) => names.get(accountId) || unknown),
    (shown, rest) => t(($) => $.collab.history.authorsMore, { names: shown, number: formatNumber(rest) }),
    3,
  );
  const save = async (name: string) => {
    if (!projectId) return;
    await collabVersionName(projectId, entry.versionId ?? entry.id, name);
    setNaming(false);
    onNamed();
  };
  const unname = () => {
    if (!projectId || !entry.versionId) return;
    setError(null);
    collabVersionUnname(projectId, entry.versionId).then(onNamed, (error_: unknown) => {
      void logError("collab version unname", error_);
      setError(collabErrorText(error_));
    });
  };
  return (
    <li
      className={
        pickedHere
          ? "rounded-md border border-primary/30 bg-primary/5 px-1 py-1.5 text-xs"
          : "rounded-md border border-transparent px-1 py-1.5 text-xs"
      }
    >
      <div className="min-w-0 space-y-0.5">
        <p className="flex min-w-0 flex-wrap items-center gap-1.5">
          <EntryTime entry={entry} />
          {entry.name ? (
            <Badge variant="primaryGhost" size="sm" className="max-w-full truncate">
              {entry.name}
            </Badge>
          ) : null}
        </p>
        {entry.authors.length > 0 ? <p className="truncate text-muted-foreground">{authors}</p> : null}
        <EntryFiles files={entry.files} />
      </div>
      {naming ? (
        <NameForm initial={entry.name ?? ""} onSave={save} onCancel={() => setNaming(false)} />
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <EntryActions
            entry={entry}
            canEdit={canEdit}
            picking={picking}
            pickedHere={pickedHere}
            onOpen={onOpen}
            onCompare={onCompare}
            onPick={onPick}
            onRename={() => setNaming(true)}
            onUnname={unname}
          />
        </div>
      )}
      {error ? <InlineAlert>{error}</InlineAlert> : null}
    </li>
  );
});

export function SharedHistory({
  open,
  onOpenChange,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const { t } = useTranslation(["collab"]);
  const live = useCollabLiveStore(
    useShallow((state) => ({
      projectId: state.share ? state.projectId : null,
      members: state.members,
      role: state.role ?? state.share?.role ?? null,
      liveState: state.status?.state ?? null,
    })),
  );
  const activePath = useFilesStore((state) => state.activePath);
  const history = useSharedHistory(live.projectId, open);
  const [viewing, setViewing] = useState<CollabHistoryEntry | null>(null);
  const [first, setFirst] = useState<CollabHistoryEntry | null>(null);
  const [comparing, setComparing] = useState<[CollabHistoryEntry, CollabHistoryEntry] | null>(null);
  const names = useMemo(
    () => new Map(live.members.map((member) => [member.person.account_id, member.person.display_name])),
    [live.members],
  );
  const connected = live.liveState !== null && live.liveState !== "ended";
  const canEdit = connected && canEditProjectRole(live.role);
  const title = t(($) => $.collab.history.title);
  const refresh = t(($) => $.collab.history.refresh);
  const days = historyDays(history.entries);
  const reload = history.reload;
  const onNamed = useCallback(() => void reload(), [reload]);
  const onOpen = useCallback((entry: CollabHistoryEntry) => setViewing(entry), []);
  const onCompare = useCallback((entry: CollabHistoryEntry) => setFirst(entry), []);
  const entries = history.entries;
  const onPick = useCallback(
    (entry: CollabHistoryEntry) => {
      if (first) setComparing(olderFirst(first, entry, entries));
      setFirst(null);
    },
    [first, entries],
  );

  const body = () => {
    if (history.phase === "failed" && history.entries.length === 0) {
      return (
        <LoadFailed
          message={t(($) => $.collab.history.loadFailed)}
          reason={history.failure ?? ""}
          onRetry={() => void history.reload()}
        />
      );
    }
    if (history.entries.length === 0 && history.phase !== "ready") {
      return (
        <div className="flex justify-center py-3">
          <Spinner className="text-muted-foreground" />
        </div>
      );
    }
    if (history.entries.length === 0) {
      return <p className="px-1 text-xs text-muted-foreground">{t(($) => $.collab.history.empty)}</p>;
    }
    return (
      <>
        {first ? (
          <div className="flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5 text-xs">
            <p className="min-w-0 flex-1">{t(($) => $.collab.history.comparePick)}</p>
            <Button type="button" variant="ghost" size="xs" onClick={() => setFirst(null)}>
              {t(($) => $.collab.history.cancelCompare)}
            </Button>
          </div>
        ) : null}
        {days.map((day) => {
          const heading = day.at === null ? t(($) => $.collab.history.earlier) : formatDate(day.at, { dateStyle: "full" });
          return (
            <section key={day.key} aria-label={heading} className="space-y-0.5">
              <h4 className="px-1 pt-1 text-[0.6875rem] font-medium text-muted-foreground">{heading}</h4>
              <ul className="space-y-0.5">
                {day.entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    names={names}
                    canEdit={canEdit}
                    picking={first !== null}
                    pickedHere={first?.id === entry.id}
                    onOpen={onOpen}
                    onCompare={onCompare}
                    onPick={onPick}
                    onNamed={onNamed}
                  />
                ))}
              </ul>
            </section>
          );
        })}
        {history.nextBefore ? (
          <div className="flex justify-center py-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={history.loadingMore}
              onClick={() => void history.loadMore()}
            >
              {t(($) => $.collab.history.loadMore)}
            </Button>
          </div>
        ) : null}
        {history.failure && history.entries.length > 0 ? <InlineAlert>{history.failure}</InlineAlert> : null}
      </>
    );
  };

  return (
    <SidebarSection
      id="collab-history"
      title={title}
      icon={<History aria-hidden className="size-3.5" />}
      open={open}
      onOpenChange={onOpenChange}
      actions={
        open ? (
          <Tooltip label={refresh}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={refresh}
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={() => void history.reload()}
            >
              <RotateCw aria-hidden className="size-3.5" />
            </Button>
          </Tooltip>
        ) : undefined
      }
      className={open ? "h-full flex-1" : "shrink-0"}
      contentClassName="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-1"
    >
      {body()}
      {viewing && live.projectId ? (
        <HistoryVersionDialog
          projectId={live.projectId}
          entry={viewing}
          initialPath={activePath}
          canRestore={canEdit}
          onRestored={onNamed}
          onClose={() => setViewing(null)}
        />
      ) : null}
      {comparing && live.projectId ? (
        <HistoryCompareDialog
          projectId={live.projectId}
          older={comparing[0]}
          newer={comparing[1]}
          onClose={() => setComparing(null)}
        />
      ) : null}
    </SidebarSection>
  );
}
