import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link2, MailOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { isOverleafError, type OverleafLinkGrants, type OverleafLinkPreview } from "@/lib/overleaf";
import { importAndRefresh, openLiveAndRefresh } from "@/lib/overleaf-open";
import { useOverleafImportStore } from "@/store/overleaf-import";
import { useSettingsStore } from "@/store/settings";

const LINK_PAUSE_MS = 400;

type LibraryTranslate = ReturnType<typeof useTranslation<["library"]>>["t"];

function grantsLabel(t: LibraryTranslate, grants: OverleafLinkGrants): string {
  const labels: Record<OverleafLinkGrants, string> = {
    edit: t(($) => $.library.import.overleaf.link.grants.edit),
    view: t(($) => $.library.import.overleaf.link.grants.view),
    already: t(($) => $.library.import.overleaf.link.grants.already),
    invite: t(($) => $.library.import.overleaf.link.grants.invite),
  };
  return labels[grants];
}

function expected(error: unknown): boolean {
  return isOverleafError(error, "link_invalid") || isOverleafError(error, "link_unavailable");
}

function JoinedActions({
  remoteId,
  onOpenProject,
}: Readonly<{ remoteId: string; onOpenProject: (projectId: string) => void }>) {
  const { t } = useTranslation(["library"]);
  const live = useSettingsStore((state) => state.overleafLive);
  const importedAs = useOverleafImportStore(
    (state) => state.projects.find((project) => project.id === remoteId)?.importedAs ?? null,
  );
  const busy = useOverleafImportStore((state) => state.importing || state.progress[remoteId]?.phase === "opening");
  if (importedAs) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => onOpenProject(importedAs)}>
        {t(($) => $.library.import.overleaf.open)}
      </Button>
    );
  }
  if (live) {
    return (
      <Button
        type="button"
        size="sm"
        data-testid={`overleaf-joined-open-live-${remoteId}`}
        disabled={busy}
        onClick={() => void openLiveAndRefresh(remoteId, onOpenProject)}
      >
        {busy ? <Spinner size="sm" /> : null}
        {t(($) => $.library.import.overleaf.openLive)}
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      data-testid={`overleaf-joined-import-${remoteId}`}
      disabled={busy}
      onClick={() => void importAndRefresh([remoteId])}
    >
      {t(($) => $.library.import.overleaf.link.importInstead)}
    </Button>
  );
}

type Joined = Readonly<{ remoteId: string; name: string }>;

export function OverleafInvitations({ onOpenProject }: Readonly<{ onOpenProject: (projectId: string) => void }>) {
  const { t } = useTranslation(["library"]);
  const invites = useOverleafImportStore((state) => state.invites);
  const accepting = useOverleafImportStore((state) => state.accepting);
  const failed = useOverleafImportStore((state) => state.inviteFailed);
  const acceptInvite = useOverleafImportStore((state) => state.acceptInvite);
  const [joined, setJoined] = useState<Joined[]>([]);
  if (invites.length === 0 && joined.length === 0) return null;
  const join = async (inviteId: string, name: string) => {
    const remoteId = await acceptInvite(inviteId);
    if (remoteId) setJoined((done) => [...done.filter((entry) => entry.remoteId !== remoteId), { remoteId, name }]);
  };
  return (
    <section
      data-testid="overleaf-invitations"
      aria-label={t(($) => $.library.import.overleaf.invitations.title)}
      className="overflow-hidden rounded-lg border"
    >
      <h3 className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
        <MailOpen aria-hidden className="size-3.5" />
        {t(($) => $.library.import.overleaf.invitations.title)}
      </h3>
      <ul className="divide-y">
        {invites.map((invite) => (
          <li key={invite.id} data-testid={`overleaf-invite-${invite.id}`} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{invite.projectName}</span>
              {invite.inviter ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {t(($) => $.library.import.overleaf.invitations.from, { name: invite.inviter })}
                </span>
              ) : null}
              {failed?.id === invite.id ? (
                <span role="alert" className="block select-text text-xs text-destructive">
                  {describeError(failed.error)}
                </span>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid={`overleaf-invite-join-${invite.id}`}
              disabled={accepting !== null}
              onClick={() => void join(invite.id, invite.projectName)}
            >
              {accepting === invite.id ? <Spinner size="sm" /> : null}
              {t(($) => $.library.import.overleaf.invitations.join)}
            </Button>
          </li>
        ))}
        {joined.map((entry) => (
          <li key={entry.remoteId} data-testid={`overleaf-joined-${entry.remoteId}`} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{entry.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {t(($) => $.library.import.overleaf.invitations.joined)}
              </span>
            </div>
            <JoinedActions remoteId={entry.remoteId} onOpenProject={onOpenProject} />
          </li>
        ))}
      </ul>
    </section>
  );
}

type Checked =
  | { link: string; phase: "checking" }
  | { link: string; phase: "ready"; preview: OverleafLinkPreview }
  | { link: string; phase: "failed"; error: unknown };

export function OverleafLinkCard({
  link,
  onOpenProject,
}: Readonly<{ link: string; onOpenProject: (projectId: string) => void }>) {
  const { t } = useTranslation(["library"]);
  const previewLink = useOverleafImportStore((state) => state.previewLink);
  const joinLink = useOverleafImportStore((state) => state.joinLink);
  const [checked, setChecked] = useState<Checked>({ link, phase: "checking" });
  const [joining, setJoining] = useState(false);
  const [joinFailed, setJoinFailed] = useState<unknown>(null);
  const [joined, setJoined] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setChecked({ link, phase: "checking" });
    setJoined(null);
    setJoinFailed(null);
    const timer = setTimeout(() => {
      previewLink(link).then(
        (preview) => {
          if (!cancelled) setChecked({ link, phase: "ready", preview });
        },
        (error: unknown) => {
          if (!expected(error)) void logError("overleaf link preview", error);
          if (!cancelled) setChecked({ link, phase: "failed", error });
        },
      );
    }, LINK_PAUSE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [link, previewLink]);

  const join = async () => {
    setJoining(true);
    setJoinFailed(null);
    try {
      const result = await joinLink(link);
      setJoined(result.projectId);
    } catch (error) {
      if (!expected(error)) void logError("overleaf link join", error);
      setJoinFailed(error);
    } finally {
      setJoining(false);
    }
  };

  let body: ReactNode;
  if (checked.phase === "checking") {
    body = (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner size="sm" />
        {t(($) => $.library.import.overleaf.link.checking)}
      </span>
    );
  } else if (checked.phase === "failed") {
    body = (
      <p role="alert" className="select-text text-xs text-destructive">
        {describeError(checked.error)}
      </p>
    );
  } else {
    const { preview } = checked;
    const remoteId = joined ?? (preview.grants === "already" ? preview.projectId : null);
    body = (
      <>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {preview.projectName ?? t(($) => $.library.import.overleaf.link.unnamed)}
          </span>
          <span data-testid="overleaf-link-grants" className="block text-xs text-muted-foreground">
            {joined ? t(($) => $.library.import.overleaf.invitations.joined) : grantsLabel(t, preview.grants)}
          </span>
          {joinFailed ? (
            <span role="alert" className="block select-text text-xs text-destructive">
              {describeError(joinFailed)}
            </span>
          ) : null}
        </div>
        {remoteId ? (
          <JoinedActions remoteId={remoteId} onOpenProject={onOpenProject} />
        ) : (
          <Button type="button" size="sm" data-testid="overleaf-link-join" disabled={joining} onClick={() => void join()}>
            {joining ? <Spinner size="sm" /> : null}
            {t(($) => $.library.import.overleaf.link.join)}
          </Button>
        )}
      </>
    );
  }
  return (
    <div data-testid="overleaf-link-preview" className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
      <Link2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      {body}
    </div>
  );
}
