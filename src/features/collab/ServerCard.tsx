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
import { formatNumber } from "@/lib/intl";
import type {
  CollabAccount,
  CollabServer,
  CollabUnsentProject,
} from "@/lib/tauri";
import {
  collabServerDevices,
  collabServerSignOutDevice,
} from "@/lib/tauri-collab";
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

function RoleBadge({ role }: Readonly<{ role: ServerRole }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <Badge variant="primaryGhost" size="sm" data-testid="collab-server-role">
      {t(($) => $.collab.roles[role])}
    </Badge>
  );
}

function SignedInSummary({ account, role }: Readonly<{ account: CollabAccount; role: ServerRole | null }>) {
  return (
    <div className="flex items-center gap-3">
      <Avatar person={accountPerson(account)} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-medium">{account.display_name}</p>
          {role ? <RoleBadge role={role} /> : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">{accountDetail(account)}</p>
      </div>
    </div>
  );
}

// Which projects hold the changes, and the name each keeps as a local copy.
function UnsentProjects({ projects }: Readonly<{ projects: readonly CollabUnsentProject[] }>) {
  const { t } = useTranslation(["collab", "native"]);
  return (
    <ul className="mt-3 max-h-48 divide-y overflow-y-auto rounded-md border text-xs" data-testid="collab-unsent-projects">
      {projects.map((project) => (
        <li key={project.project_id} className="px-3 py-2">
          <p className="truncate font-medium">{project.name}</p>
          <p className="text-muted-foreground">
            {t(($) => $.collab.section.server.unsent.changes, { changes: formatNumber(project.changes) })}
            {" · "}
            {t(($) => $.collab.section.server.unsent.staysAs, {
              name: t(($) => $.native.collab.localCopy, { name: project.name }),
            })}
          </p>
        </li>
      ))}
    </ul>
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
  const [open, setOpen] = useState(defaultOpen);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { test, run: runTest } = useConnectionTest(server.url);
  const account = server.signed_in ? server.account : null;
  const role = toServerRole(account?.server_role);
  const ended = server.signed_in ? null : (server.ended ?? null);
  const formerGuest = server.account?.server_role === "guest";
  const canManage = account !== null && canManageServer(role);

  const signedOutBadge = () => {
    if (ended === "account_suspended") return t(($) => $.collab.section.server.suspended);
    if (ended === "access_ended") return t(($) => $.collab.section.server.noAccess);
    return t(($) => $.collab.section.server.signedOut);
  };

  const signedOutHint = () => {
    const values = { server: server.name };
    if (ended === "account_suspended") return t(($) => $.collab.section.server.suspendedHint, values);
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

  const removing = unsent?.action === "remove";

  const removeButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="hover:bg-destructive/10 hover:text-destructive"
      disabled={pending !== null}
      onClick={() => setConfirmRemove(true)}
    >
      {pending === "remove" ? <Spinner /> : <Trash2 aria-hidden />}
      {t(($) => $.collab.section.server.remove)}
    </Button>
  );

  // Folded, the header sums up who is signed in: their picture and their
  // role, since being signed in shows already. Open, the card says that
  // itself and the header holds Remove. Why someone is signed out stays.
  const headerTrailing = () => {
    if (!account) {
      return (
        <>
          <Badge variant="muted" size="sm">
            {signedOutBadge()}
          </Badge>
          {open ? removeButton : null}
        </>
      );
    }
    if (open) return removeButton;
    return (
      <>
        <Avatar person={accountPerson(account)} size="sm" />
        {role ? (
          <RoleBadge role={role} />
        ) : (
          <Badge variant="success" size="sm">
            {t(($) => $.collab.section.server.signedIn)}
          </Badge>
        )}
      </>
    );
  };

  return (
    <>
      <CollapsibleSection
        id={`collab-server-${serverId}`}
        title={server.name}
        description={server.url}
        // The server's own icon, as the add-server dialog shows it.
        leading={
          <Avatar
            person={{ id: serverId, name: server.name, imageUrl: server.icon_url }}
            size="md"
            fallbackIcon={<Server />}
          />
        }
        open={open}
        onOpenChange={setOpen}
        trailing={headerTrailing()}
      >
        {/* Who is signed in on the left, the actions on the right. They wrap
            below it when the card is too narrow for one line. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-60">
            {account ? (
              <SignedInSummary account={account} role={role} />
            ) : (
              <p className="text-xs text-muted-foreground">{signedOutHint()}</p>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2" data-testid="collab-server-actions">
            {canManage ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => void openAdminConsole(server)}>
                  <AppWindow aria-hidden />
                  {t(($) => $.collab.section.server.adminConsole)}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={onManage}>
                  <ShieldCheck aria-hidden />
                  {t(($) => $.collab.section.server.manage)}
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={test.state === "running"}
              onClick={() => void runTest()}
            >
              <Activity aria-hidden />
              {t(($) => $.collab.section.server.testShort)}
            </Button>
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
            ) : (
              <Button type="button" size="sm" disabled={pending !== null} onClick={onSignIn}>
                <LogIn aria-hidden />
                {t(($) => $.collab.section.server.signIn)}
              </Button>
            )}
          </div>
        </div>
        {canManage ? (
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.section.server.manageHint)}</p>
        ) : null}
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
        description={
          removing
            ? t(($) => $.collab.section.server.unsent.removeDescription)
            : t(($) => $.collab.section.server.unsent.description)
        }
        confirmLabel={t(($) => $.collab.section.server.unsent.keep)}
        cancelLabel={
          removing
            ? t(($) => $.collab.section.server.unsent.keepServer)
            : t(($) => $.collab.section.server.unsent.stay)
        }
        onConfirm={() => void doKeepLocalCopies()}
        onCancel={() => stay(serverId)}
      >
        {unsent ? <UnsentProjects projects={unsent.projects} /> : null}
      </ConfirmationDialog>
    </>
  );
}
