import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Folder, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { SidebarSection } from "@/components/layout/SidebarSection";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRelativeTimeFrom } from "@/lib/intl";
import { logError } from "@/lib/log";
import { collabTrashList, collabTrashRestore, type CollabTrashEntry } from "@/lib/tauri";
import { collabErrorCode, collabErrorMessage } from "../errors";
import { InlineAlert } from "../feedback";
import { useCollabLiveStore } from "../live/live-store";
import { useLiveTree } from "./tree-version";

const NONE: readonly CollabTrashEntry[] = [];
const TICK_MS = 60_000;

function sameEntries(left: readonly CollabTrashEntry[], right: readonly CollabTrashEntry[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function useTrash(): readonly [readonly CollabTrashEntry[], () => Promise<void>, string | null] {
  const tree = useLiveTree();
  const projectId = tree?.projectId ?? null;
  const [state, setState] = useState<{ projectId: string | null; entries: readonly CollabTrashEntry[] }>({
    projectId: null,
    entries: NONE,
  });
  const latest = useRef(projectId);
  latest.current = projectId;
  const request = useRef(0);
  const refresh = useCallback(async () => {
    if (!tree) return;
    const { projectId } = tree;
    const ticket = ++request.current;
    let entries: CollabTrashEntry[];
    try {
      entries = await collabTrashList(projectId);
    } catch (error) {
      void logError("collab trash list", error);
      return;
    }
    if (ticket !== request.current || latest.current !== projectId) return;
    setState((current) =>
      current.projectId === projectId && sameEntries(current.entries, entries) ? current : { projectId, entries },
    );
  }, [tree]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const entries = state.projectId === projectId ? state.entries : NONE;
  return [entries, refresh, projectId] as const;
}

const DeletedRow = memo(function DeletedRow({
  entry,
  now,
  selfId,
  names,
  canRestore,
  onRestore,
}: Readonly<{
  entry: CollabTrashEntry;
  now: number;
  selfId: string | null;
  names: ReadonlyMap<string, string>;
  canRestore: boolean;
  onRestore: (entry: CollabTrashEntry) => void;
}>) {
  const { t } = useTranslation(["collab"]);
  const Glyph = entry.kind === "dir" ? Folder : FileText;
  const folder = entry.folder
    ? t(($) => $.collab.deleted.inFolder, { folder: entry.folder })
    : t(($) => $.collab.deleted.inProject);
  let who: string | null = null;
  if (entry.deletedBy && entry.deletedBy === selfId) {
    who = t(($) => $.collab.deleted.byYou);
  } else if (entry.deletedBy) {
    who = t(($) => $.collab.deleted.by, {
      name: names.get(entry.deletedBy) || t(($) => $.collab.toolbar.unknownPerson),
    });
  }
  return (
    <li className="flex items-start gap-2 rounded-md px-1 py-1.5 text-xs">
      <Glyph aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="select-text truncate font-medium">{entry.name}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
          <span className="min-w-0 truncate">{folder}</span>
          {who ? <span>{who}</span> : null}
          {entry.deletedAt === null ? null : (
            <time dateTime={new Date(entry.deletedAt).toISOString()} title={formatDateTime(entry.deletedAt)}>
              {formatRelativeTimeFrom(entry.deletedAt, now)}
            </time>
          )}
        </p>
      </div>
      {canRestore ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-1.5 text-xs"
          aria-label={t(($) => $.collab.deleted.restoreLabel, { name: entry.name })}
          onClick={() => onRestore(entry)}
        >
          {t(($) => $.collab.deleted.restore)}
        </Button>
      ) : null}
    </li>
  );
});

const DeletedList = memo(function DeletedList({
  title,
  entries,
  canRestore,
  onRestore,
}: Readonly<{
  title: string;
  entries: readonly CollabTrashEntry[];
  canRestore: boolean;
  onRestore: (entry: CollabTrashEntry) => void;
}>) {
  const { t } = useTranslation(["collab"]);
  const [now, setNow] = useState(() => Date.now());
  const people = useCollabLiveStore(
    useShallow((state) => ({ members: state.members, selfId: state.share?.account_id ?? null })),
  );
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const names = useMemo(
    () => new Map(people.members.map((member) => [member.person.account_id, member.person.display_name])),
    [people.members],
  );
  if (entries.length === 0) {
    return <p className="px-1 text-xs text-muted-foreground">{t(($) => $.collab.pane.deletedEmpty)}</p>;
  }
  return (
    <ul aria-label={title} className="space-y-0.5">
      {entries.map((entry) => (
        <DeletedRow
          key={entry.id}
          entry={entry}
          now={now}
          selfId={people.selfId}
          names={names}
          canRestore={canRestore}
          onRestore={onRestore}
        />
      ))}
    </ul>
  );
});

export function RecentlyDeleted({
  open,
  onOpenChange,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const { t } = useTranslation(["collab"]);
  const [entries, refresh, projectId] = useTrash();
  const canRestore = useCollabLiveStore((state) => (state.role ?? state.share?.role ?? "viewer") !== "viewer");
  const [failure, setFailure] = useState<string | null>(null);
  const title = t(($) => $.collab.pane.deleted);
  const restore = useCallback(
    async (entry: CollabTrashEntry) => {
      if (!projectId) return;
      setFailure(null);
      try {
        await collabTrashRestore(projectId, entry.id);
      } catch (error) {
        setFailure(collabErrorMessage(collabErrorCode(error)));
        return;
      }
      await refresh();
    },
    [projectId, refresh],
  );
  const onRestore = useCallback((entry: CollabTrashEntry) => void restore(entry), [restore]);
  return (
    <SidebarSection
      id="collab-deleted"
      title={title}
      icon={<Trash2 aria-hidden className="size-3.5" />}
      count={entries.length}
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="space-y-1 px-2 py-1"
    >
      <DeletedList title={title} entries={entries} canRestore={canRestore} onRestore={onRestore} />
      {failure ? <InlineAlert>{failure}</InlineAlert> : null}
    </SidebarSection>
  );
}
