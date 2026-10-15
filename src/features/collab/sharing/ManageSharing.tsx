import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, DoorOpen, Link2, MessageSquare, ScrollText, Trash2, UserPlus } from "lucide-react";
import { useShareDialog } from "@/components/collab/share-dialog";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { LoadingState } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { useCopyStatus } from "@/components/ui/use-copy-status";
import {
  collabAccessLogSetEnabled,
  collabCommentsSetEnabled,
  collabCommentsStatus,
  collabLeaveProject,
  collabLinkSharingSet,
  collabMemberRemove,
  collabMemberSet,
  collabMembersList,
  collabPeopleSearch,
  collabProjectSummary,
  collabStopSharing,
  type CollabCommentsStatus,
  type CollabPerson,
  type CollabProjectMember,
  type CollabProjectSummary,
  type CollabShareInfo,
} from "@/lib/tauri";
import { useBusyRows } from "../busy-rows";
import { looksLikeEmailAddress } from "../address-checks";
import { collabErrorText } from "../errors";
import { InlineAlert, LoadFailed } from "../feedback";
import { collabPerson, personDetail } from "../people";
import { useAccessLogSwitches } from "./access-log-store";
import { GuestBadge } from "../GuestBadge";
import { InactiveBadge, isInactive } from "../InactiveBadge";
import { syncMembersChange, syncShareChange } from "./after-change";
import {
  GuestInvitationList,
  GuestInviteOffer,
  InviteOutcomeNote,
  useProjectGuests,
  type InviteOutcome,
  type ProjectGuests,
} from "./GuestInvitations";
import { ProjectRolePicker, toGrantableRole, type GrantableRole } from "./ProjectRolePicker";

const SEARCH_DELAY_MS = 250;
const SEARCH_MIN_LENGTH = 2;

type SearchState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "done"; people: CollabPerson[] }
  | { kind: "failed"; message: string };

function ownerFirst(members: readonly CollabProjectMember[]): CollabProjectMember[] {
  return [...members].sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
}

function upsertMember(members: readonly CollabProjectMember[], next: CollabProjectMember): CollabProjectMember[] {
  const id = next.person.account_id;
  return members.some((member) => member.person.account_id === id)
    ? members.map((member) => (member.person.account_id === id ? next : member))
    : [...members, next];
}

function AddPeople({
  projectId,
  server,
  members,
  guests,
  onAdded,
  onInvited,
}: Readonly<{
  projectId: string;
  server: string;
  members: readonly CollabProjectMember[];
  guests: ProjectGuests;
  onAdded: (member: CollabProjectMember) => void;
  onInvited: (outcome: InviteOutcome) => void;
}>) {
  const { t } = useTranslation(["collab", "common"]);
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<GrantableRole>("editor");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);
  const trimmed = query.trim();

  const invited = (next: InviteOutcome) => {
    setOutcome(next);
    setQuery("");
    onInvited(next);
  };

  useEffect(() => {
    if (trimmed.length < SEARCH_MIN_LENGTH) {
      setSearch({ kind: "idle" });
      return;
    }
    let active = true;
    setSearch({ kind: "searching" });
    const timer = window.setTimeout(() => {
      collabPeopleSearch(projectId, trimmed).then(
        (people) => {
          if (active) setSearch({ kind: "done", people });
        },
        (error_: unknown) => {
          if (active) setSearch({ kind: "failed", message: collabErrorText(error_) });
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [projectId, trimmed]);

  const add = async (person: CollabPerson) => {
    setAdding(person.account_id);
    setError(null);
    try {
      onAdded(await collabMemberSet(projectId, person.account_id, role));
      setQuery("");
    } catch (error_) {
      setError(collabErrorText(error_));
    } finally {
      setAdding(null);
    }
  };

  const present = new Set(members.map((member) => member.person.account_id));

  const quiet = (text: string) => <p className="text-xs text-muted-foreground">{text}</p>;

  // Nobody has that address on the server yet: invite them as a guest, or
  // say who can let them in when guests are off.
  const renderNewAddress = (email: string) => {
    if (guests.failed) {
      return (
        <div className="space-y-2">
          <InlineAlert>{t(($) => $.collab.manage.add.guestCheckFailed, { server })}</InlineAlert>
          <Button type="button" variant="outline" size="sm" onClick={guests.reload}>
            {t(($) => $.common.actions.retry)}
          </Button>
        </div>
      );
    }
    if (!guests.info) return quiet(t(($) => $.collab.manage.add.searching));
    if (!guests.info.guests_enabled) return quiet(t(($) => $.collab.manage.add.noAccountNoGuests, { server, email }));
    return <GuestInviteOffer projectId={projectId} server={server} email={email} role={role} onInvited={invited} />;
  };

  const renderResults = () => {
    if (search.kind === "searching") return quiet(t(($) => $.collab.manage.add.searching));
    if (search.kind === "failed") return <InlineAlert>{search.message}</InlineAlert>;
    if (search.kind !== "done") return null;
    const people = search.people.filter((person) => !present.has(person.account_id));
    if (people.length === 0 && search.people.length > 0) {
      const [only] = search.people;
      return search.people.length === 1
        ? quiet(t(($) => $.collab.manage.add.alreadyMember, { name: only.display_name }))
        : quiet(t(($) => $.collab.manage.add.allMembers));
    }
    if (people.length === 0 && looksLikeEmailAddress(trimmed)) return renderNewAddress(trimmed.toLowerCase());
    if (people.length === 0) {
      // Without the member directory the server matches only a whole email
      // address, so a name finds nobody.
      return quiet(t(($) => $.collab.manage.add.noResultsTryEmail, { server }));
    }
    return (
      <ul className="divide-y rounded-lg border bg-card">
        {people.map((person) => (
          <li key={person.account_id} className="flex items-center gap-3 px-3 py-2">
            <Avatar person={collabPerson(person)} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{person.display_name}</p>
              <p className="truncate text-xs text-muted-foreground">{personDetail(person)}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={adding !== null}
              aria-label={t(($) => $.collab.manage.add.addNamed, { name: person.display_name })}
              onClick={() => void add(person)}
            >
              <UserPlus aria-hidden />
              {t(($) => $.collab.manage.add.add)}
            </Button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        {t(($) => $.collab.manage.add.label)}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          value={query}
          autoComplete="off"
          placeholder={t(($) => $.collab.manage.add.placeholder)}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 flex-1 text-sm"
        />
        <ProjectRolePicker value={role} label={t(($) => $.collab.manage.add.roleLabel)} onChange={setRole} />
      </div>
      {renderResults()}
      {outcome && trimmed === "" ? <InviteOutcomeNote outcome={outcome} server={server} /> : null}
      {error ? <InlineAlert>{error}</InlineAlert> : null}
    </div>
  );
}

function LinkSharing({
  projectId,
  server,
  link,
  summary,
  isOwner,
  onSummary,
}: Readonly<{
  projectId: string;
  server: string;
  link: string;
  summary: CollabProjectSummary;
  isOwner: boolean;
  onSummary: (summary: CollabProjectSummary) => void;
}>) {
  const { t } = useTranslation(["collab"]);
  const copy = useCopyStatus();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkRole = toGrantableRole(summary.link_role) ?? "viewer";

  const save = async (enabled: boolean, role: GrantableRole) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      onSummary(await collabLinkSharingSet(projectId, enabled, role));
    } catch (error_) {
      setError(collabErrorText(error_));
    } finally {
      setSaving(false);
    }
  };

  const copyLabel = () => {
    if (copy.status === "copied") return t(($) => $.collab.manage.link.copied);
    if (copy.status === "failed") return t(($) => $.collab.manage.link.copyFailed);
    return t(($) => $.collab.manage.link.copy);
  };

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={() => void copy.copy(link)}>
        {copy.copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copyLabel()}
      </Button>
      {isOwner ? (
        <>
          <SettingsToggleRow
            label={t(($) => $.collab.manage.link.sharing)}
            description={t(($) => $.collab.manage.link.sharingDescription, { server })}
            checked={summary.link_sharing}
            disabled={saving}
            icon={<Link2 aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
            onChange={(enabled) => void save(enabled, linkRole)}
          />
          {summary.link_sharing ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{t(($) => $.collab.manage.link.roleLabel)}</span>
              <ProjectRolePicker
                value={linkRole}
                disabled={saving}
                label={t(($) => $.collab.manage.link.roleLabel)}
                onChange={(role) => void save(true, role)}
              />
            </div>
          ) : null}
        </>
      ) : null}
      {error ? <InlineAlert>{error}</InlineAlert> : null}
    </div>
  );
}

function CommentsSetting({
  projectId,
  server,
  summary,
  onSummary,
}: Readonly<{
  projectId: string;
  server: string;
  summary: CollabProjectSummary;
  onSummary: (summary: CollabProjectSummary) => void;
}>) {
  const { t } = useTranslation(["collab"]);
  const [status, setStatus] = useState<CollabCommentsStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serverOff = status !== null && !status.serverAllowed;
  const enabled = (summary.comments_enabled ?? true) && !serverOff;

  useEffect(() => {
    let active = true;
    collabCommentsStatus(projectId).then(
      (next) => {
        if (active) setStatus(next);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [projectId]);

  const save = async (next: boolean) => {
    if (saving || serverOff) return;
    setSaving(true);
    setError(null);
    try {
      onSummary(await collabCommentsSetEnabled(projectId, next));
    } catch (error_) {
      setError(collabErrorText(error_));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <SettingsToggleRow
        label={t(($) => $.collab.manage.comments.label)}
        description={
          serverOff
            ? t(($) => $.collab.manage.comments.serverOff, { server })
            : t(($) => $.collab.manage.comments.description)
        }
        checked={enabled}
        disabled={saving || serverOff}
        icon={<MessageSquare aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        onChange={(next) => void save(next)}
      />
      {error ? <InlineAlert>{error}</InlineAlert> : null}
    </div>
  );
}

function AccessLogSetting({
  projectId,
  summary,
  onSummary,
}: Readonly<{
  projectId: string;
  summary: CollabProjectSummary;
  onSummary: (summary: CollabProjectSummary) => void;
}>) {
  const { t } = useTranslation(["collab"]);
  const status = useAccessLogSwitches((state) => state.byProject[projectId]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void useAccessLogSwitches.getState().load(projectId);
  }, [projectId]);

  if (!status?.serverAllowed) return null;
  const enabled = summary.access_log ?? status.enabled;

  const save = async (next: boolean) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await collabAccessLogSetEnabled(projectId, next);
      onSummary(updated);
      useAccessLogSwitches.getState().set(projectId, { serverAllowed: true, enabled: updated.access_log ?? next });
    } catch (error_) {
      setError(collabErrorText(error_));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <SettingsToggleRow
        label={t(($) => $.collab.manage.accessLog.label)}
        description={t(($) => $.collab.manage.accessLog.description)}
        checked={enabled}
        disabled={saving}
        icon={<ScrollText aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        onChange={(next) => void save(next)}
      />
      {error ? <InlineAlert>{error}</InlineAlert> : null}
    </div>
  );
}

export function ManageSharing({
  projectId,
  name,
  share,
}: Readonly<{ projectId: string; name: string; share: CollabShareInfo }>) {
  const { t } = useTranslation(["collab"]);
  const close = useShareDialog((state) => state.close);
  const isOwner = share.role === "owner";
  const server = share.server_name;
  const [summary, setSummary] = useState<CollabProjectSummary | null>(null);
  const [members, setMembers] = useState<CollabProjectMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const rows = useBusyRows();
  const [rowError, setRowError] = useState<{ accountId: string; message: string } | null>(null);
  const [removing, setRemoving] = useState<CollabProjectMember | null>(null);
  const [ending, setEnding] = useState(false);
  const [endBusy, setEndBusy] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const guests = useProjectGuests(projectId, isOwner);

  const afterInvite = (outcome: InviteOutcome) => {
    if (outcome.result.invitation.status === "accepted") {
      setRequest((count) => count + 1);
      syncMembersChange(projectId);
    } else {
      guests.reload();
    }
  };

  const load = useMemo(() => ({ projectId, request }), [projectId, request]);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    Promise.all([collabProjectSummary(load.projectId), collabMembersList(load.projectId)]).then(
      ([nextSummary, nextMembers]) => {
        if (!active) return;
        setSummary(nextSummary);
        setMembers(ownerFirst(nextMembers));
      },
      (error: unknown) => {
        if (active) setLoadError(collabErrorText(error));
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  const runRow = (member: CollabProjectMember, action: () => Promise<void>) => {
    const accountId = member.person.account_id;
    return rows.run(accountId, async () => {
      setRowError((current) => (current?.accountId === accountId ? null : current));
      try {
        await action();
        syncMembersChange(projectId);
      } catch (error) {
        setRowError({ accountId, message: collabErrorText(error) });
      }
    });
  };

  const changeRole = (member: CollabProjectMember, role: GrantableRole) =>
    runRow(member, async () => {
      const next = await collabMemberSet(projectId, member.person.account_id, role);
      setMembers((current) => (current ? upsertMember(current, next) : current));
    });

  const remove = (member: CollabProjectMember) => {
    setRemoving(null);
    return runRow(member, async () => {
      await collabMemberRemove(projectId, member.person.account_id);
      setMembers((current) =>
        current ? current.filter((item) => item.person.account_id !== member.person.account_id) : current,
      );
    });
  };

  const end = async () => {
    setEnding(false);
    setEndBusy(true);
    setEndError(null);
    try {
      if (isOwner) await collabStopSharing(projectId);
      else await collabLeaveProject(projectId);
    } catch (error) {
      setEndError(collabErrorText(error));
      setEndBusy(false);
      return;
    }
    await syncShareChange(projectId);
    close();
  };

  const renderRow = (member: CollabProjectMember) => {
    const person = member.person;
    const accountId = person.account_id;
    const grantable = toGrantableRole(member.role);
    const editable = isOwner && grantable !== null;
    return (
      <li key={accountId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <Avatar person={collabPerson(person)} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{person.display_name}</span>
            {person.guest ? <GuestBadge /> : null}
            {isInactive(person) ? <InactiveBadge /> : null}
            {accountId === share.account_id ? (
              <Badge variant="primaryGhost" size="sm">
                {t(($) => $.collab.manage.you)}
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">{personDetail(person)}</p>
        </div>
        {editable ? (
          <>
            <ProjectRolePicker
              value={grantable}
              disabled={rows.busy.has(accountId)}
              label={t(($) => $.collab.manage.roleLabel, { name: person.display_name })}
              onChange={(role) => {
                if (role !== member.role) void changeRole(member, role);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="hover:bg-destructive/10 hover:text-destructive"
              disabled={rows.busy.has(accountId)}
              aria-label={t(($) => $.collab.manage.removeNamed, { name: person.display_name })}
              onClick={() => setRemoving(member)}
            >
              <Trash2 aria-hidden />
              {t(($) => $.collab.manage.remove)}
            </Button>
          </>
        ) : (
          <Badge variant="muted" size="sm">
            {t(($) => $.collab.projectRoles[member.role])}
          </Badge>
        )}
        {rowError?.accountId === accountId ? (
          <div className="basis-full">
            <InlineAlert>{rowError.message}</InlineAlert>
          </div>
        ) : null}
      </li>
    );
  };

  const renderPeople = () => {
    if (loadError) {
      return (
        <LoadFailed
          message={t(($) => $.collab.manage.loadFailed)}
          reason={loadError}
          onRetry={() => setRequest((count) => count + 1)}
        />
      );
    }
    if (!members || !summary) return <LoadingState size="compact" label={t(($) => $.collab.manage.loading)} />;
    return (
      <>
        {isOwner ? (
          <AddPeople
            projectId={projectId}
            server={server}
            members={members}
            guests={guests}
            onAdded={(member) => {
              setMembers((current) => (current ? upsertMember(current, member) : current));
              syncMembersChange(projectId);
            }}
            onInvited={afterInvite}
          />
        ) : null}
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t(($) => $.collab.manage.people)}</h3>
          <ul aria-label={t(($) => $.collab.manage.people)} className="divide-y rounded-lg border bg-card">
            {members.map((member) => renderRow(member))}
          </ul>
        </div>
        {isOwner && guests.info ? (
          <GuestInvitationList projectId={projectId} info={guests.info} onWithdrawn={guests.remove} />
        ) : null}
        <LinkSharing
          projectId={projectId}
          server={server}
          link={share.link}
          summary={summary}
          isOwner={isOwner}
          onSummary={setSummary}
        />
        {isOwner ? (
          <CommentsSetting projectId={projectId} server={server} summary={summary} onSummary={setSummary} />
        ) : null}
        {isOwner ? <AccessLogSetting projectId={projectId} summary={summary} onSummary={setSummary} /> : null}
      </>
    );
  };

  const endLabel = isOwner ? t(($) => $.collab.manage.stop) : t(($) => $.collab.manage.leave);

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{t(($) => $.collab.manage.sharedOn, { server })}</span>
        <Badge variant="muted" size="sm">
          {t(($) => $.collab.manage.yourRole, { role: t(($) => $.collab.projectRoles[share.role]) })}
        </Badge>
      </p>
      {renderPeople()}
      {endError ? <InlineAlert>{endError}</InlineAlert> : null}
      <div className="flex justify-start border-t pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={endBusy}
          onClick={() => setEnding(true)}
        >
          {isOwner ? <Trash2 aria-hidden /> : <DoorOpen aria-hidden />}
          {endLabel}
        </Button>
      </div>
      <ConfirmationDialog
        open={removing !== null}
        title={t(($) => $.collab.manage.removeConfirm.title, { name: removing?.person.display_name ?? "" })}
        description={t(($) => $.collab.manage.removeConfirm.description)}
        confirmLabel={t(($) => $.collab.manage.removeConfirm.confirm)}
        destructive
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmationDialog
        open={ending}
        title={
          isOwner
            ? t(($) => $.collab.manage.stopConfirm.title, { name })
            : t(($) => $.collab.manage.leaveConfirm.title, { name })
        }
        description={
          isOwner
            ? t(($) => $.collab.manage.stopConfirm.description)
            : t(($) => $.collab.manage.leaveConfirm.description)
        }
        confirmLabel={
          isOwner ? t(($) => $.collab.manage.stopConfirm.confirm) : t(($) => $.collab.manage.leaveConfirm.confirm)
        }
        destructive
        onConfirm={() => void end()}
        onCancel={() => setEnding(false)}
      />
    </div>
  );
}
