import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EyeOff, ExternalLink, Undo2 } from "lucide-react";
import type { CollabAdminPublishedNote } from "@oleafly/backend-port";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber, formatRelativeTimeFrom } from "@/lib/intl";
import { openInSystemBrowser } from "@/lib/system-browser";
import { collabAdminPublishedNotes, collabAdminSetNoteTakenDown } from "@/lib/tauri-collab";
import { useBusyRows } from "../busy-rows";
import { collabErrorText } from "../errors";
import { InactiveBadge, isInactive } from "../InactiveBadge";
import { InlineAlert, LoadFailed } from "../feedback";
import { collabPerson } from "../people";

const PUBLISHED_LIST_LIMIT = 1000;

type ListState =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly items: CollabAdminPublishedNote[] };

export function PublishedNotesSection({ serverId, now }: Readonly<{ serverId: string; now: number }>) {
  const { t } = useTranslation(["collab"]);
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [request, setRequest] = useState(0);
  const rows = useBusyRows();
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [confirming, setConfirming] = useState<CollabAdminPublishedNote | null>(null);
  const load = useMemo(() => ({ serverId, request }), [serverId, request]);

  useEffect(() => {
    let active = true;
    setList({ status: "loading" });
    collabAdminPublishedNotes(load.serverId).then(
      (items) => {
        if (active) setList({ status: "ready", items });
      },
      (error: unknown) => {
        if (active) setList({ status: "failed", message: collabErrorText(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  const change = (entry: CollabAdminPublishedNote, down: boolean) => {
    setConfirming(null);
    const { id } = entry.note;
    return rows.run(id, async () => {
      setRowError((current) => (current?.id === id ? null : current));
      try {
        const next = await collabAdminSetNoteTakenDown(serverId, id, down);
        setList((current) =>
          current.status === "ready"
            ? { ...current, items: current.items.map((item) => (item.note.id === id ? next : item)) }
            : current,
        );
      } catch (error) {
        setRowError({ id, message: collabErrorText(error) });
      }
    });
  };

  const renderAction = (entry: CollabAdminPublishedNote) => {
    const { note } = entry;
    const busy = rows.busy.has(note.id);
    if (note.taken_down) {
      return (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          aria-label={t(($) => $.collab.console.pages.restoreNamed, { title: note.title })}
          onClick={() => void change(entry, false)}
        >
          {busy ? <Spinner /> : <Undo2 aria-hidden />}
          {t(($) => $.collab.console.pages.restore)}
        </Button>
      );
    }
    return (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="hover:bg-destructive/10 hover:text-destructive"
        disabled={busy}
        aria-label={t(($) => $.collab.console.pages.takeDownNamed, { title: note.title })}
        onClick={() => setConfirming(entry)}
      >
        {busy ? <Spinner /> : <EyeOff aria-hidden />}
        {t(($) => $.collab.console.pages.takeDown)}
      </Button>
    );
  };

  const renderRow = ({ note, author }: CollabAdminPublishedNote) => (
    <TableRow key={note.id} data-testid={`console-published-${note.id}`}>
      <TableCell className="max-w-64">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{note.title}</span>
          {note.taken_down ? (
            <Badge variant="muted" size="sm">
              {t(($) => $.collab.console.pages.takenDown)}
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="max-w-48">
        {author ? (
          <div className="flex min-w-0 items-center gap-2">
            <Avatar person={collabPerson(author)} size="sm" />
            <span className="truncate">{author.display_name}</span>
            {isInactive(author) ? <InactiveBadge /> : null}
          </div>
        ) : (
          <span className="text-muted-foreground">{t(($) => $.collab.console.pages.noAuthor)}</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        <time dateTime={new Date(note.updated_at).toISOString()}>{formatRelativeTimeFrom(note.updated_at, now)}</time>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={t(($) => $.collab.console.pages.openNamed, { title: note.title })}
            onClick={() => void openInSystemBrowser(note.url)}
          >
            <ExternalLink aria-hidden />
            {t(($) => $.collab.publish.open)}
          </Button>
          {renderAction({ note, author })}
        </div>
      </TableCell>
    </TableRow>
  );

  const renderList = () => {
    if (list.status === "loading") {
      return <LoadingState size="compact" label={t(($) => $.collab.console.pages.loading)} />;
    }
    if (list.status === "failed") {
      return (
        <LoadFailed
          message={t(($) => $.collab.admin.loadFailed)}
          reason={list.message}
          onRetry={() => setRequest((count) => count + 1)}
        />
      );
    }
    if (list.items.length === 0) {
      return (
        <EmptyState
          size="compact"
          className="rounded-lg border border-dashed px-4 py-6"
          title={t(($) => $.collab.console.pages.empty)}
        />
      );
    }
    return (
      <>
        <Table containerClassName="rounded-lg border">
          <TableHeader>
            <TableRow>
              <TableHead>{t(($) => $.collab.console.pages.columns.title)}</TableHead>
              <TableHead>{t(($) => $.collab.console.pages.columns.author)}</TableHead>
              <TableHead>{t(($) => $.collab.console.pages.columns.updated)}</TableHead>
              <TableHead>
                <span className="sr-only">{t(($) => $.collab.console.pages.columns.actions)}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.flatMap((entry) => [
              renderRow(entry),
              rowError?.id === entry.note.id ? (
                <TableRow key={`${entry.note.id}-error`}>
                  <TableCell colSpan={4}>
                    <InlineAlert>{rowError.message}</InlineAlert>
                  </TableCell>
                </TableRow>
              ) : null,
            ])}
          </TableBody>
        </Table>
        {list.items.length >= PUBLISHED_LIST_LIMIT ? (
          <p className="text-xs text-muted-foreground">
            {t(($) => $.collab.console.pages.limit, { shown: formatNumber(PUBLISHED_LIST_LIMIT) })}
          </p>
        ) : null}
      </>
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t(($) => $.collab.console.pages.description)}</p>
      {renderList()}
      <ConfirmationDialog
        open={confirming !== null}
        title={t(($) => $.collab.console.pages.takeDownConfirm.title, { title: confirming?.note.title ?? "" })}
        description={t(($) => $.collab.console.pages.takeDownConfirm.description)}
        confirmLabel={t(($) => $.collab.console.pages.takeDownConfirm.confirm)}
        destructive
        onConfirm={() => {
          if (confirming) void change(confirming, true);
        }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
