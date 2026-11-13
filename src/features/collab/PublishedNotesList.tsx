import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Globe, Trash2 } from "lucide-react";
import type { CollabPublishedNote } from "@oleafly/backend-port";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { EmptyState } from "@/components/ui/empty";
import { formatDateTime } from "@/lib/intl";
import { openInSystemBrowser } from "@/lib/system-browser";
import { collabUnpublishNote } from "@/lib/tauri-collab";
import { useBusyRows } from "./busy-rows";
import { collabErrorText } from "./errors";
import { InlineAlert, LoadFailed } from "./feedback";
import { usePublishedNotes } from "./sharing/use-published-notes";

export function PublishedNotesList({ serverId }: Readonly<{ serverId: string }>) {
  const { t } = useTranslation(["collab"]);
  const titleId = useId();
  const published = usePublishedNotes(serverId);
  const rows = useBusyRows();
  const [confirming, setConfirming] = useState<CollabPublishedNote | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { state } = published;

  if (state.kind === "loading" || state.kind === "unsupported") return null;
  if (state.kind === "ready" && state.listing.notes.length === 0 && !state.listing.allowed) return null;

  const unpublish = (note: CollabPublishedNote) => {
    setConfirming(null);
    setActionError(null);
    return rows.run(note.id, async () => {
      try {
        await collabUnpublishNote(serverId, note.id);
        published.drop(note.id);
      } catch (error) {
        setActionError(collabErrorText(error));
      }
    });
  };

  const renderNotes = () => {
    if (state.kind === "failed") {
      return (
        <LoadFailed message={t(($) => $.collab.publish.list.loadFailed)} reason={state.message} onRetry={published.reload} />
      );
    }
    if (state.listing.notes.length === 0) {
      return (
        <EmptyState
          size="compact"
          className="rounded-md border border-dashed px-3 py-4"
          title={t(($) => $.collab.publish.list.empty)}
        />
      );
    }
    return (
      <ul className="divide-y rounded-md border bg-background">
        {state.listing.notes.map((note) => (
          <li key={note.id} data-testid={`collab-published-${note.id}`} className="flex items-center gap-3 px-3 py-2">
            <Globe aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-center gap-2 text-xs font-medium">
                <span className="truncate">{note.title}</span>
                {note.taken_down ? (
                  <Badge variant="muted" size="sm">
                    {t(($) => $.collab.console.pages.takenDown)}
                  </Badge>
                ) : null}
              </p>
              <p className="truncate text-[0.6875rem] text-muted-foreground">
                {t(($) => $.collab.publish.list.updated, { date: formatDateTime(note.updated_at) })}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t(($) => $.collab.publish.list.openNamed, { name: note.title })}
              onClick={() => void openInSystemBrowser(note.url)}
            >
              <ExternalLink aria-hidden />
              {t(($) => $.collab.publish.open)}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t(($) => $.collab.publish.list.unpublishNamed, { name: note.title })}
              disabled={rows.busy.has(note.id)}
              onClick={() => setConfirming(note)}
            >
              <Trash2 aria-hidden />
              {t(($) => $.collab.publish.unpublish)}
            </Button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <section aria-labelledby={titleId} className="space-y-2">
      <div>
        <h4 id={titleId} className="text-xs font-medium">
          {t(($) => $.collab.publish.list.title)}
        </h4>
        <p className="text-[0.6875rem] text-muted-foreground">{t(($) => $.collab.publish.list.description)}</p>
      </div>
      {renderNotes()}
      {actionError ? <InlineAlert>{actionError}</InlineAlert> : null}
      <ConfirmationDialog
        open={confirming !== null}
        title={t(($) => $.collab.publish.unpublishConfirm.title, { name: confirming?.title ?? "" })}
        description={t(($) => $.collab.publish.unpublishConfirm.description)}
        confirmLabel={t(($) => $.collab.publish.unpublishConfirm.confirm)}
        destructive
        onConfirm={() => {
          if (confirming) void unpublish(confirming);
        }}
        onCancel={() => setConfirming(null)}
      />
    </section>
  );
}
