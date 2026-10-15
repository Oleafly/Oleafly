import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Mail, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopyStatus } from "@/components/ui/use-copy-status";
import { formatDate } from "@/lib/intl";
import {
  collabGuestInvitationRevoke,
  collabGuestInvitations,
  collabGuestInvite,
  type CollabGuestInvitation,
  type CollabGuestInviteResult,
  type CollabProjectGuestInvitations,
} from "@/lib/tauri";
import { useBusyRows } from "../busy-rows";
import { collabErrorCode, collabErrorText } from "../errors";
import { InlineAlert } from "../feedback";
import { GuestBadge } from "../GuestBadge";
import type { GrantableRole } from "./ProjectRolePicker";


type ListedStatus = "awaiting_approval" | "invited" | "declined";

const STATUS_BADGE = {
  awaiting_approval: "warning",
  invited: "info",
  declined: "muted",
} as const satisfies Record<ListedStatus, BadgeVariant>;

function listedStatus(status: CollabGuestInvitation["status"]): ListedStatus | null {
  return status === "awaiting_approval" || status === "invited" || status === "declined" ? status : null;
}

export interface ProjectGuests {
  readonly info: CollabProjectGuestInvitations | null;
  // The guest settings couldn't be loaded, so nobody knows whether guests
  // can be invited. Callers say so with a retry instead of hiding the offer.
  readonly failed: boolean;
  readonly reload: () => void;
  readonly remove: (id: string) => void;
}

export function useProjectGuests(projectId: string, enabled: boolean): ProjectGuests {
  const [info, setInfo] = useState<CollabProjectGuestInvitations | null>(null);
  const [failed, setFailed] = useState(false);
  const [request, setRequest] = useState(0);

  const load = useMemo(() => ({ projectId, enabled, request }), [projectId, enabled, request]);

  useEffect(() => {
    if (!load.enabled) return;
    let active = true;
    setFailed(false);
    collabGuestInvitations(load.projectId).then(
      (next) => {
        if (active) setInfo(next);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  const reload = useCallback(() => setRequest((count) => count + 1), []);
  const remove = useCallback(
    (id: string) =>
      setInfo((current) =>
        current ? { ...current, invitations: current.invitations.filter((entry) => entry.id !== id) } : current,
      ),
    [],
  );
  return { info, failed, reload, remove };
}

function inviteError(error: unknown, t: ReturnType<typeof useTranslation<["collab"]>>["t"]): string {
  const code = collabErrorCode(error);
  if (code === "conflict") return t(($) => $.collab.guests.invite.duplicate);
  if (code === "rate_limited") return t(($) => $.collab.guests.invite.tooMany);
  return collabErrorText(error);
}

export interface InviteOutcome {
  readonly email: string;
  readonly result: CollabGuestInviteResult;
}

export function GuestInviteOffer({
  projectId,
  server,
  email,
  role,
  onInvited,
}: Readonly<{
  projectId: string;
  server: string;
  email: string;
  role: GrantableRole;
  onInvited: (outcome: InviteOutcome) => void;
}>) {
  const { t } = useTranslation(["collab"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invite = async () => {
    setBusy(true);
    setError(null);
    try {
      onInvited({ email, result: await collabGuestInvite(projectId, email, role) });
    } catch (error_) {
      setError(inviteError(error_, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border bg-card px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{t(($) => $.collab.guests.invite.noAccount, { server, email })}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        aria-label={t(($) => $.collab.guests.invite.buttonNamed, { email })}
        onClick={() => void invite()}
      >
        <Mail aria-hidden />
        {t(($) => $.collab.guests.invite.button)}
      </Button>
      {error ? <InlineAlert>{error}</InlineAlert> : null}
    </div>
  );
}

function CopyLinkButton({ link }: Readonly<{ link: string }>) {
  const { t } = useTranslation(["collab"]);
  const copy = useCopyStatus();
  const label = () => {
    if (copy.status === "copied") return t(($) => $.collab.manage.link.copied);
    if (copy.status === "failed") return t(($) => $.collab.manage.link.copyFailed);
    return t(($) => $.collab.manage.link.copy);
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void copy.copy(link)}>
      {copy.copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {label()}
    </Button>
  );
}

function outcomeText(
  outcome: InviteOutcome,
  server: string,
  t: ReturnType<typeof useTranslation<["collab"]>>["t"],
): string {
  const { email, result } = outcome;
  const status = result.invitation.status;
  if (status === "accepted") return t(($) => $.collab.guests.sent.added, { email, server });
  const waiting = status === "awaiting_approval";
  if (result.emailed) {
    return waiting
      ? t(($) => $.collab.guests.sent.emailedAfterApproval, { email })
      : t(($) => $.collab.guests.sent.emailed, { email });
  }
  return waiting
    ? t(($) => $.collab.guests.sent.sendLinkAfterApproval, { email, server })
    : t(($) => $.collab.guests.sent.sendLink, { email, server });
}

export function InviteOutcomeNote({ outcome, server }: Readonly<{ outcome: InviteOutcome; server: string }>) {
  const { t } = useTranslation(["collab"]);
  const linkId = useId();
  const showLink = !outcome.result.emailed && outcome.result.invitation.status !== "accepted";
  return (
    <output className="block space-y-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
      <p>{outcomeText(outcome, server, t)}</p>
      {showLink ? (
        <div className="flex items-center gap-2">
          <Input
            id={linkId}
            readOnly
            value={outcome.result.add_link}
            aria-label={t(($) => $.collab.guests.sent.linkLabel, { server })}
            className="h-8 flex-1 select-all font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <CopyLinkButton link={outcome.result.add_link} />
        </div>
      ) : null}
    </output>
  );
}

export function GuestInvitationList({
  projectId,
  info,
  onWithdrawn,
}: Readonly<{
  projectId: string;
  info: CollabProjectGuestInvitations;
  onWithdrawn: (id: string) => void;
}>) {
  const { t } = useTranslation(["collab"]);
  const rows = useBusyRows();
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const listed = info.invitations.flatMap((entry) => {
    const status = listedStatus(entry.status);
    return status ? [{ entry, status }] : [];
  });
  if (listed.length === 0) return null;

  const withdraw = (entry: CollabGuestInvitation) => {
    setRowError((current) => (current?.id === entry.id ? null : current));
    return rows.run(entry.id, async () => {
      try {
        await collabGuestInvitationRevoke(projectId, entry.id);
        onWithdrawn(entry.id);
      } catch (error_) {
        setRowError({ id: entry.id, message: collabErrorText(error_) });
      }
    });
  };

  const title = t(($) => $.collab.guests.list.title);
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul aria-label={title} className="divide-y rounded-lg border bg-card">
        {listed.map(({ entry, status }) => {
          const open = status !== "declined";
          return (
            <li key={entry.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <Avatar person={{ id: entry.email, name: entry.email }} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">{entry.email}</span>
                  <GuestBadge />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {t(($) => $.collab.guests.list.expires, { date: formatDate(entry.expires_at) })}
                </p>
              </div>
              <Badge variant="muted" size="sm">
                {t(($) => $.collab.projectRoles[entry.role])}
              </Badge>
              <Badge variant={STATUS_BADGE[status]} size="sm">
                {t(($) => $.collab.guests.list.status[status])}
              </Badge>
              {open && !info.sends_email ? <CopyLinkButton link={info.add_link} /> : null}
              {open ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="hover:bg-destructive/10 hover:text-destructive"
                  disabled={rows.busy.has(entry.id)}
                  aria-label={t(($) => $.collab.guests.list.withdrawNamed, { email: entry.email })}
                  onClick={() => void withdraw(entry)}
                >
                  <Trash2 aria-hidden />
                  {t(($) => $.collab.guests.list.withdraw)}
                </Button>
              ) : null}
              {rowError?.id === entry.id ? (
                <div className="basis-full">
                  <InlineAlert>{rowError.message}</InlineAlert>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
