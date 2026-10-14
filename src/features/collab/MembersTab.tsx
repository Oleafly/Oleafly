import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Laptop, Trash2, UserCheck, UserPlus, UserX } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import {
  collabAdminMemberDevices,
  collabAdminPatchMember,
  collabAdminRemoveMember,
  collabAdminSignOutDevice,
  type CollabMember,
  type CollabMemberPatch,
  type CollabMemberStatus,
} from "@/lib/tauri";
import { useBusyRows } from "./busy-rows";
import { DevicesList } from "./DevicesList";
import { collabErrorText } from "./errors";
import { InlineAlert, LoadFailed } from "./feedback";
import { GuestBadge } from "./GuestBadge";
import { PendingGuests } from "./PendingGuests";
import { accountDetail, accountPerson } from "./people";
import { RolePicker } from "./RolePicker";
import { canChangeMember, isStaffRole, serverRoleAllows, toServerRole, type ServerRole } from "./roles";

export type MembersUpdate = (update: (members: CollabMember[]) => CollabMember[]) => void;

const STATUS_BADGE = {
  active: "success",
  suspended: "warning",
  removed: "muted",
} as const satisfies Record<CollabMemberStatus, BadgeVariant>;

function SuspendButton({
  suspended,
  disabled,
  onToggle,
}: Readonly<{ suspended: boolean; disabled: boolean; onToggle: () => void }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onToggle}>
      {suspended ? <UserCheck aria-hidden /> : <UserX aria-hidden />}
      {suspended ? t(($) => $.collab.admin.members.reactivate) : t(($) => $.collab.admin.members.suspend)}
    </Button>
  );
}

export function MembersTab({
  serverId,
  actor,
  selfId,
  members,
  loadError,
  onRetry,
  onMembersChange,
  onAddPeople,
}: Readonly<{
  serverId: string;
  actor: ServerRole;
  selfId: string | null;
  members: CollabMember[] | null;
  loadError: string | null;
  onRetry: () => void;
  onMembersChange: MembersUpdate;
  onAddPeople?: () => void;
}>) {
  const { t } = useTranslation(["collab"]);
  const rows = useBusyRows();
  const [rowError, setRowError] = useState<{ accountId: string; message: string } | null>(null);
  const [removing, setRemoving] = useState<CollabMember | null>(null);
  // A change to your own role takes your admin rights away, so it waits for a yes.
  const [stepping, setStepping] = useState<{ member: CollabMember; role: ServerRole } | null>(null);
  const [devicesFor, setDevicesFor] = useState<string | null>(null);
  const canSeeDevices = serverRoleAllows(actor, "signOutAnyDevice");

  const run = (member: CollabMember, action: () => Promise<void>) => {
    const accountId = member.account.account_id;
    return rows.run(accountId, async () => {
      setRowError((current) => (current?.accountId === accountId ? null : current));
      try {
        await action();
      } catch (error) {
        setRowError({ accountId, message: collabErrorText(error, "members") });
      }
    });
  };

  const patch = (member: CollabMember, change: CollabMemberPatch) =>
    run(member, async () => {
      const next = await collabAdminPatchMember(serverId, member.account.account_id, change);
      onMembersChange((current) =>
        current.map((item) => (item.account.account_id === next.account.account_id ? next : item)),
      );
    });

  const remove = (member: CollabMember) => {
    setRemoving(null);
    return run(member, async () => {
      await collabAdminRemoveMember(serverId, member.account.account_id);
      onMembersChange((current) => current.filter((item) => item.account.account_id !== member.account.account_id));
    });
  };

  const renderRow = (member: CollabMember) => {
    const accountId = member.account.account_id;
    const name = member.account.display_name;
    const role = toServerRole(member.account.server_role);
    const isSelf = accountId === selfId;
    const removed = member.status === "removed";
    const suspended = member.status === "suspended";
    const busy = rows.busy.has(accountId);
    const editable = !removed && role !== null && canChangeMember(actor, role);
    const devicesShown =
      canSeeDevices &&
      !removed &&
      (isSelf || role === null || !isStaffRole(role) || serverRoleAllows(actor, "manageStaff"));
    return (
      <li key={accountId} data-testid={`collab-member-${accountId}`} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <Avatar person={accountPerson(member.account)} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{name}</span>
            {role === "guest" ? <GuestBadge /> : null}
            {isSelf ? (
              <Badge variant="primaryGhost" size="sm">
                {t(($) => $.collab.admin.members.you)}
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">{accountDetail(member.account)}</p>
        </div>
        <Badge variant={STATUS_BADGE[member.status]} size="sm">
          {t(($) => $.collab.admin.members[member.status])}
        </Badge>
        {role !== null && editable ? (
          <RolePicker
            actor={actor}
            value={role}
            disabled={busy}
            label={t(($) => $.collab.admin.members.roleLabel, { name })}
            onChange={(next) => {
              if (next === role) return;
              if (isSelf) setStepping({ member, role: next });
              else void patch(member, { role: next });
            }}
          />
        ) : (
          <Badge variant="muted" size="sm">
            {role === null ? t(($) => $.collab.roles.unknown) : t(($) => $.collab.roles[role])}
          </Badge>
        )}
        {devicesShown ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={devicesFor === accountId}
            onClick={() => setDevicesFor(devicesFor === accountId ? null : accountId)}
          >
            <Laptop aria-hidden />
            {t(($) => $.collab.admin.members.devices)}
          </Button>
        ) : null}
        {editable && !isSelf ? (
          <>
            <SuspendButton
              suspended={suspended}
              disabled={busy}
              onToggle={() => void patch(member, { status: suspended ? "active" : "suspended" })}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="hover:bg-destructive/10 hover:text-destructive"
              disabled={busy}
              onClick={() => setRemoving(member)}
            >
              <Trash2 aria-hidden />
              {t(($) => $.collab.admin.members.remove)}
            </Button>
          </>
        ) : null}
        {rowError?.accountId === accountId ? (
          <div className="basis-full">
            <InlineAlert>{rowError.message}</InlineAlert>
          </div>
        ) : null}
        {devicesFor === accountId ? (
          <div className="basis-full">
            <DevicesList
              key={accountId}
              variant="member"
              ownerName={name}
              load={() => collabAdminMemberDevices(serverId, accountId)}
              signOut={(deviceId) => collabAdminSignOutDevice(serverId, deviceId)}
            />
          </div>
        ) : null}
      </li>
    );
  };

  const renderMembers = () => {
    if (loadError) {
      return <LoadFailed message={t(($) => $.collab.admin.loadFailed)} reason={loadError} onRetry={onRetry} />;
    }
    if (!members) return <LoadingState size="compact" label={t(($) => $.collab.admin.members.loading)} />;
    if (members.length === 0) {
      return (
        <EmptyState
          size="compact"
          className="rounded-lg border border-dashed px-4 py-6"
          title={t(($) => $.collab.admin.members.empty)}
        />
      );
    }
    return <ul className="divide-y rounded-lg border bg-card">{members.map((member) => renderRow(member))}</ul>;
  };

  return (
    <div className="space-y-2">
      {serverRoleAllows(actor, "approveGuests") ? <PendingGuests serverId={serverId} /> : null}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>{t(($) => $.collab.admin.members.description)}</p>
          {onAddPeople ? <p>{t(($) => $.collab.admin.members.addHint)}</p> : null}
        </div>
        {onAddPeople ? (
          <Button type="button" size="sm" className="shrink-0" onClick={onAddPeople}>
            <UserPlus aria-hidden />
            {t(($) => $.collab.admin.members.addPeople)}
          </Button>
        ) : null}
      </div>
      {renderMembers()}
      <ConfirmationDialog
        open={removing !== null}
        title={t(($) => $.collab.admin.members.removeConfirm.title, { name: removing?.account.display_name ?? "" })}
        description={t(($) => $.collab.admin.members.removeConfirm.description)}
        confirmLabel={t(($) => $.collab.admin.members.removeConfirm.confirm)}
        destructive
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmationDialog
        open={stepping !== null}
        title={t(($) => $.collab.admin.members.selfRoleConfirm.title, {
          role: stepping ? t(($) => $.collab.roles[stepping.role]) : "",
        })}
        description={t(($) => $.collab.admin.members.selfRoleConfirm.description)}
        confirmLabel={t(($) => $.collab.admin.members.selfRoleConfirm.confirm)}
        destructive
        onConfirm={() => {
          if (stepping) void patch(stepping.member, { role: stepping.role });
          setStepping(null);
        }}
        onCancel={() => setStepping(null)}
      />
    </div>
  );
}
