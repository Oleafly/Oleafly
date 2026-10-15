import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/intl";
import {
  collabAdminGuestApprove,
  collabAdminGuestDecline,
  collabAdminGuestInvitations,
  collabAdminGuestRevoke,
  type CollabGuestInvitation,
} from "@/lib/tauri";
import { collabErrorText } from "./errors";
import { InlineAlert, LoadFailed } from "./feedback";
import { GuestBadge } from "./GuestBadge";

function stillPending(entry: CollabGuestInvitation): boolean {
  return entry.status === "awaiting_approval" || entry.status === "invited";
}

// `onChanged` hears about each approval, decline or withdrawal, so a count of
// invitations shown elsewhere can be read again.
export function PendingGuests({ serverId, onChanged }: Readonly<{ serverId: string; onChanged?: () => void }>) {
  const { t } = useTranslation(["collab"]);
  const [pending, setPending] = useState<CollabGuestInvitation[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    void request;
    collabAdminGuestInvitations(serverId).then(
      (next) => {
        if (!active) return;
        setPending(next.filter(stillPending));
        setFailure(null);
      },
      (error: unknown) => {
        if (!active) return;
        setPending(null);
        setFailure(collabErrorText(error));
      },
    );
    return () => {
      active = false;
    };
  }, [serverId, request]);

  const run = async (entry: CollabGuestInvitation, action: () => Promise<CollabGuestInvitation | null>) => {
    setBusyId(entry.id);
    setRowError(null);
    try {
      const next = await action();
      setPending((current) => {
        if (!current) return current;
        if (next && stillPending(next)) return current.map((item) => (item.id === next.id ? next : item));
        return current.filter((item) => item.id !== entry.id);
      });
      onChanged?.();
    } catch (error) {
      setRowError({ id: entry.id, message: collabErrorText(error) });
    } finally {
      setBusyId(null);
    }
  };

  const title = t(($) => $.collab.guests.pending.title);
  if (failure !== null) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <LoadFailed
          message={t(($) => $.collab.guests.pending.loadFailed)}
          reason={failure}
          onRetry={() => setRequest((count) => count + 1)}
        />
      </section>
    );
  }
  if (!pending || pending.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-xs text-muted-foreground">{t(($) => $.collab.guests.pending.description)}</p>
      <ul aria-label={title} className="divide-y rounded-lg border bg-card">
        {pending.map((entry) => {
          const busy = busyId === entry.id;
          const waiting = entry.status === "awaiting_approval";
          return (
            <li key={entry.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <Avatar person={{ id: entry.email, name: entry.email }} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">{entry.email}</span>
                  <GuestBadge />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {t(($) => $.collab.guests.pending.invitedBy, {
                    inviter: entry.invited_by.display_name,
                    project: entry.project_title,
                  })}
                  {" · "}
                  {t(($) => $.collab.guests.list.expires, { date: formatDate(entry.expires_at) })}
                </p>
              </div>
              <Badge variant="muted" size="sm">
                {t(($) => $.collab.projectRoles[entry.role])}
              </Badge>
              <Badge variant={waiting ? "warning" : "info"} size="sm">
                {waiting
                  ? t(($) => $.collab.guests.list.status.awaiting_approval)
                  : t(($) => $.collab.guests.list.status.invited)}
              </Badge>
              {waiting ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={t(($) => $.collab.guests.pending.approveNamed, { email: entry.email })}
                    onClick={() => void run(entry, () => collabAdminGuestApprove(serverId, entry.id))}
                  >
                    <Check aria-hidden />
                    {t(($) => $.collab.guests.pending.approve)}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy}
                    aria-label={t(($) => $.collab.guests.pending.declineNamed, { email: entry.email })}
                    onClick={() => void run(entry, () => collabAdminGuestDecline(serverId, entry.id))}
                  >
                    <X aria-hidden />
                    {t(($) => $.collab.guests.pending.decline)}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="hover:bg-destructive/10 hover:text-destructive"
                  disabled={busy}
                  aria-label={t(($) => $.collab.guests.list.withdrawNamed, { email: entry.email })}
                  onClick={() =>
                    void run(entry, async () => {
                      await collabAdminGuestRevoke(serverId, entry.id);
                      return null;
                    })
                  }
                >
                  <Trash2 aria-hidden />
                  {t(($) => $.collab.guests.list.withdraw)}
                </Button>
              )}
              {rowError?.id === entry.id ? (
                <div className="basis-full">
                  <InlineAlert>{rowError.message}</InlineAlert>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
