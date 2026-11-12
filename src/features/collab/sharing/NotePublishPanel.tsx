import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, ExternalLink, Globe } from "lucide-react";
import type { CollabPublishedNote, ProjectInfo } from "@oleafly/backend-port";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { LoadingState } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useCopyStatus } from "@/components/ui/use-copy-status";
import { describeError } from "@/lib/app-error";
import { formatDateTime } from "@/lib/intl";
import { openInSystemBrowser } from "@/lib/system-browser";
import type { CollabServer, CollabShareInfo } from "@/lib/tauri";
import { collabPublishNote, collabUnpublishNote, isCollabCommandError } from "@/lib/tauri-collab";
import { collabErrorText } from "../errors";
import { InlineAlert, LoadFailed } from "../feedback";
import { NoServers, ServerField } from "./server-choice";
import { usePublishedNotes } from "./use-published-notes";

type Busy = "publishing" | "unpublishing" | null;

function failureText(error: unknown): string {
  return isCollabCommandError(error) ? collabErrorText(error) : describeError(error);
}

function PublicLink({ page }: Readonly<{ page: CollabPublishedNote }>) {
  const { t } = useTranslation(["collab"]);
  const copy = useCopyStatus();
  const copyLabel = () => {
    if (copy.status === "copied") return t(($) => $.collab.manage.link.copied);
    if (copy.status === "failed") return t(($) => $.collab.manage.link.copyFailed);
    return t(($) => $.collab.manage.link.copy);
  };
  return (
    <div className="space-y-2 rounded-md border bg-card px-3 py-3">
      <p className="text-xs text-muted-foreground">{t(($) => $.collab.publish.linkLabel)}</p>
      <p className="select-text break-all font-mono text-xs" data-testid="note-public-link">
        {page.url}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy.copy(page.url)}>
          {copy.copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copyLabel()}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void openInSystemBrowser(page.url)}>
          <ExternalLink aria-hidden />
          {t(($) => $.collab.publish.open)}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t(($) => $.collab.publish.publishedAt, { date: formatDateTime(page.updated_at) })}
        </span>
      </div>
    </div>
  );
}

function PublishActions({
  page,
  busy,
  publishDisabled,
  onUnpublish,
  onCancel,
  onPublish,
}: Readonly<{
  page: CollabPublishedNote | null;
  busy: Busy;
  publishDisabled: boolean;
  onUnpublish: () => void;
  onCancel: () => void;
  onPublish: () => void;
}>) {
  const { t } = useTranslation(["collab", "common"]);
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {page ? (
        <Button type="button" variant="ghost" disabled={busy !== null} onClick={onUnpublish}>
          {busy === "unpublishing" ? <Spinner aria-hidden /> : null}
          {t(($) => $.collab.publish.unpublish)}
        </Button>
      ) : (
        <Button type="button" variant="ghost" disabled={busy !== null} onClick={onCancel}>
          {t(($) => $.common.actions.cancel)}
        </Button>
      )}
      <Button type="button" disabled={publishDisabled} onClick={onPublish}>
        {busy === "publishing" ? <Spinner aria-hidden /> : <Globe aria-hidden />}
        {page ? t(($) => $.collab.publish.republish) : t(($) => $.collab.publish.publish)}
      </Button>
    </div>
  );
}

export function NotePublishPanel({
  project,
  share,
  servers,
  onAddOleafly,
  onClose,
}: Readonly<{
  project: ProjectInfo;
  share: CollabShareInfo | null;
  servers: CollabServer[];
  onAddOleafly: (() => void) | null;
  onClose: () => void;
}>) {
  const { t } = useTranslation(["collab", "common"]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const owner = share === null || share.role === "owner";
  const choices = share ? servers.filter((entry) => entry.server_id === share.server_id) : servers;
  const server = choices.find((entry) => entry.server_id === chosen) ?? choices[0] ?? null;
  const published = usePublishedNotes(owner && server ? server.server_id : null);

  useEffect(() => {
    let active = true;
    import("@/components/notes/note-publish")
      .then((module) => module.noteSourceId(project))
      .then(
        (id) => {
          if (active) setSource(id);
        },
        () => {
          if (active) setSource(project.id);
        },
      );
    return () => {
      active = false;
    };
  }, [project]);

  if (!owner) return <p className="text-sm text-muted-foreground">{t(($) => $.collab.publish.ownerOnly)}</p>;
  if (!server) return <NoServers onAddOleafly={share ? null : onAddOleafly} />;

  const listing = published.state.kind === "ready" ? published.state.listing : null;
  const page = listing && source ? (listing.notes.find((entry) => entry.source === source) ?? null) : null;
  const unsupported = published.state.kind === "unsupported";
  const allowed = listing?.allowed ?? false;
  const takenDown = page?.taken_down === true;
  const stale = page !== null && !takenDown && project.updated_at * 1000 > page.updated_at;

  const publish = async () => {
    if (busy) return;
    setBusy("publishing");
    setError(null);
    try {
      const { notePage } = await import("@/components/notes/note-publish");
      published.put(await collabPublishNote(server.server_id, await notePage(project)));
    } catch (error_) {
      setError(`${t(($) => $.collab.publish.failed)} ${failureText(error_)}`);
    } finally {
      setBusy(null);
    }
  };

  const unpublish = async () => {
    setConfirming(false);
    if (!page || busy) return;
    setBusy("unpublishing");
    setError(null);
    try {
      await collabUnpublishNote(server.server_id, page.id);
      published.drop(page.id);
    } catch (error_) {
      setError(failureText(error_));
    } finally {
      setBusy(null);
    }
  };

  const renderState = () => {
    if (published.state.kind === "failed") {
      return (
        <LoadFailed
          message={t(($) => $.collab.publish.loadFailed)}
          reason={published.state.message}
          onRetry={published.reload}
        />
      );
    }
    if (unsupported) return <InlineAlert>{t(($) => $.collab.publish.tooOld, { server: server.name })}</InlineAlert>;
    if (!listing || source === null) {
      return <LoadingState size="compact" label={t(($) => $.collab.publish.checking)} />;
    }
    return (
      <>
        {page ? <PublicLink page={page} /> : null}
        {takenDown ? <InlineAlert>{t(($) => $.collab.publish.takenDown)}</InlineAlert> : null}
        {page && stale ? (
          <p className="rounded-md bg-primary/5 px-3 py-2 text-xs text-foreground">{t(($) => $.collab.publish.stale)}</p>
        ) : null}
        {allowed ? null : <InlineAlert>{t(($) => $.collab.publish.notAllowed, { server: server.name })}</InlineAlert>}
        {!page && allowed ? (
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.publish.contents)}</p>
        ) : null}
      </>
    );
  };

  const ready = listing !== null && source !== null;
  return (
    <div className="space-y-4" data-testid="note-publish-panel">
      <p className="text-sm text-muted-foreground">{t(($) => $.collab.publish.intro)}</p>
      <ServerField servers={choices} value={server} disabled={busy !== null} onChange={setChosen} />
      {renderState()}
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      <PublishActions
        page={page}
        busy={busy}
        publishDisabled={!ready || !allowed || takenDown || busy !== null}
        onUnpublish={() => setConfirming(true)}
        onCancel={onClose}
        onPublish={() => void publish()}
      />
      <ConfirmationDialog
        open={confirming}
        title={t(($) => $.collab.publish.unpublishConfirm.title, { name: project.name })}
        description={t(($) => $.collab.publish.unpublishConfirm.description)}
        confirmLabel={t(($) => $.collab.publish.unpublishConfirm.confirm)}
        destructive
        onConfirm={() => void unpublish()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
