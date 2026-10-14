import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, AppWindow, LogIn, LogOut, Server, ShieldCheck, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { LoadingState } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { collabServerDevices, collabServerSignOutDevice, type CollabAccount, type CollabServer } from "@/lib/tauri";
import { openAdminConsole } from "./console/open-console";
import { ConnectionChecks } from "./ConnectionChecks";
import { DevicesList } from "./DevicesList";
import { EmailPreferencesRow } from "./EmailPreferencesRow";
import { collabErrorMessage } from "./errors";
import { InlineAlert } from "./feedback";
import { accountDetail, accountPerson } from "./people";
import { canManageServer, toServerRole, type ServerRole } from "./roles";
import { useCollabStore } from "./store";
import { useConnectionTest, type ConnectionTest } from "./use-connection-test";

function SignedInSummary({ account, role }: Readonly<{ account: CollabAccount; role: ServerRole | null }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <div className="flex items-center gap-3">
      <Avatar person={accountPerson(account)} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {t(($) => $.collab.section.server.signedInAs, { name: account.display_name })}
        </p>
        <p className="truncate text-xs text-muted-foreground">{accountDetail(account)}</p>
        {role ? (
          <p className="text-xs text-muted-foreground">
            {t(($) => $.collab.section.server.role, { role: t(($) => $.collab.roles[role]) })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ConnectionTestResult({ test }: Readonly<{ test: ConnectionTest }>) {
  const { t } = useTranslation(["collab"]);
  if (test.state === "running") return <LoadingState size="compact" label={t(($) => $.collab.section.checks.running)} />;
  if (test.state === "done") return <ConnectionChecks checks={test.checks} />;
  if (test.state === "failed") return <InlineAlert>{test.message}</InlineAlert>;
  return null;
}

export function ServerCard({
  server,
  defaultOpen,
  onSignIn,
  onManage,
}: Readonly<{ server: CollabServer; defaultOpen: boolean; onSignIn: () => void; onManage: () => void }>) {
  const { t } = useTranslation(["collab"]);
  const serverId = server.server_id;
  const pending = useCollabStore((state) => state.pending[serverId] ?? null);
  const signOut = useCollabStore((state) => state.signOut);
  const remove = useCollabStore((state) => state.remove);
  const unsent = useCollabStore((state) => state.unsent[serverId] ?? null);
  const keepLocalCopies = useCollabStore((state) => state.keepLocalCopies);
  const stay = useCollabStore((state) => state.stay);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { test, run: runTest } = useConnectionTest(server.url);
  const account = server.signed_in ? server.account : null;
  const role = toServerRole(account?.server_role);
  const ended = server.signed_in ? null : (server.ended ?? null);
  const formerGuest = server.account?.server_role === "guest";
  const canManage = account !== null && canManageServer(role);

  const signedOutBadge = () => {
    if (ended === "account_suspended") return t(($) => $.collab.section.server.paused);
    if (ended === "access_ended") return t(($) => $.collab.section.server.noAccess);
    return t(($) => $.collab.section.server.signedOut);
  };

  const signedOutHint = () => {
    const values = { server: server.name };
    if (ended === "account_suspended") return t(($) => $.collab.section.server.pausedHint, values);
    if (ended === "access_ended" && formerGuest) return t(($) => $.collab.section.server.endedGuestHint, values);
    if (ended === "access_ended") return t(($) => $.collab.section.server.endedHint, values);
    return t(($) => $.collab.section.server.signedOutHint);
  };

  const doSignOut = async () => {
    setActionError(null);
    const code = await signOut(serverId);
    if (code) setActionError(collabErrorMessage(code));
  };

  const doRemove = async () => {
    setConfirmRemove(false);
    setActionError(null);
    const code = await remove(serverId);
    if (code) setActionError(collabErrorMessage(code));
  };

  const doKeepLocalCopies = async () => {
    setActionError(null);
    const code = await keepLocalCopies(serverId);
    if (code) setActionError(collabErrorMessage(code));
  };

  const unsentCount = unsent?.projects.length ?? 0;

  return (
    <>
      <CollapsibleSection
        id={`collab-server-${serverId}`}
        title={server.name}
        description={server.url}
        icon={Server}
        defaultOpen={defaultOpen}
        trailing={
          <>
            {account ? <Avatar person={accountPerson(account)} size="sm" /> : null}
            {account ? (
              <Badge variant="success" size="sm">
                {t(($) => $.collab.section.server.signedIn)}
              </Badge>
            ) : (
              <Badge variant="muted" size="sm">
                {signedOutBadge()}
              </Badge>
            )}
          </>
        }
      >
        {account ? (
          <SignedInSummary account={account} role={role} />
        ) : (
          <p className="text-xs text-muted-foreground">{signedOutHint()}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {account ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending !== null}
              onClick={() => void doSignOut()}
            >
              {pending === "signOut" ? <Spinner /> : <LogOut aria-hidden />}
              {t(($) => $.collab.section.server.signOut)}
            </Button>
          ) : null}
          {!account ? (
            <Button type="button" size="sm" disabled={pending !== null} onClick={onSignIn}>
              <LogIn aria-hidden />
              {t(($) => $.collab.section.server.signIn)}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={test.state === "running"}
            onClick={() => void runTest()}
          >
            <Activity aria-hidden />
            {t(($) => $.collab.section.server.test)}
          </Button>
          {canManage ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={onManage}>
                <ShieldCheck aria-hidden />
                {t(($) => $.collab.section.server.manage)}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void openAdminConsole(server)}>
                <AppWindow aria-hidden />
                {t(($) => $.collab.console.open)}
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto hover:bg-destructive/10 hover:text-destructive"
            disabled={pending !== null}
            onClick={() => setConfirmRemove(true)}
          >
            {pending === "remove" ? <Spinner /> : <Trash2 aria-hidden />}
            {t(($) => $.collab.section.server.remove)}
          </Button>
        </div>
        {actionError ? <InlineAlert>{actionError}</InlineAlert> : null}
        <ConnectionTestResult test={test} />
        {account ? <EmailPreferencesRow key={`emails-${serverId}`} serverId={serverId} /> : null}
        {account ? (
          <DevicesList
            key={serverId}
            variant="own"
            load={() => collabServerDevices(serverId)}
            signOut={(deviceId) => collabServerSignOutDevice(serverId, deviceId)}
          />
        ) : null}
      </CollapsibleSection>
      <ConfirmationDialog
        open={confirmRemove}
        title={t(($) => $.collab.section.server.removeConfirm.title, { name: server.name })}
        description={t(($) => $.collab.section.server.removeConfirm.description, { name: server.name })}
        confirmLabel={t(($) => $.collab.section.server.removeConfirm.confirm)}
        destructive
        onConfirm={() => void doRemove()}
        onCancel={() => setConfirmRemove(false)}
      />
      <ConfirmationDialog
        open={unsent !== null}
        title={t(($) => $.collab.section.server.unsent.title)}
        description={t(($) => $.collab.section.server.unsent.description, { count: unsentCount })}
        confirmLabel={t(($) => $.collab.section.server.unsent.keep)}
        cancelLabel={t(($) => $.collab.section.server.unsent.stay)}
        onConfirm={() => void doKeepLocalCopies()}
        onCancel={() => stay(serverId)}
      />
    </>
  );
}
