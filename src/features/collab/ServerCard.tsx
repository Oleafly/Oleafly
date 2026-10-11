import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, LogIn, LogOut, Server, ShieldCheck, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { LoadingState } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import {
  collabServerDevices,
  collabServerSignOutDevice,
  collabServerTest,
  type CollabConnectionCheck,
  type CollabServer,
} from "@/lib/tauri";
import { ConnectionChecks } from "./ConnectionChecks";
import { DevicesList } from "./DevicesList";
import { collabErrorCode, collabErrorMessage } from "./errors";
import { InlineAlert } from "./feedback";
import { accountDetail, accountPerson } from "./people";
import { canManageServer, toServerRole } from "./roles";
import { useCollabStore } from "./store";

type ConnectionTest =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; checks: CollabConnectionCheck[] }
  | { state: "failed"; message: string };

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
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [test, setTest] = useState<ConnectionTest>({ state: "idle" });
  const account = server.signed_in ? server.account : null;
  const role = toServerRole(account?.server_role);

  const runTest = async () => {
    setTest({ state: "running" });
    try {
      setTest({ state: "done", checks: await collabServerTest(server.url) });
    } catch (error) {
      setTest({ state: "failed", message: collabErrorMessage(collabErrorCode(error)) });
    }
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
                {t(($) => $.collab.section.server.signedOut)}
              </Badge>
            )}
          </>
        }
      >
        {account ? (
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
        ) : (
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.section.server.signedOutHint)}</p>
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
          ) : (
            <Button type="button" size="sm" disabled={pending !== null} onClick={onSignIn}>
              <LogIn aria-hidden />
              {t(($) => $.collab.section.server.signIn)}
            </Button>
          )}
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
          {account && canManageServer(role) ? (
            <Button type="button" variant="outline" size="sm" onClick={onManage}>
              <ShieldCheck aria-hidden />
              {t(($) => $.collab.section.server.manage)}
            </Button>
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
        {test.state === "running" ? (
          <LoadingState size="compact" label={t(($) => $.collab.section.checks.running)} />
        ) : null}
        {test.state === "done" ? <ConnectionChecks checks={test.checks} /> : null}
        {test.state === "failed" ? <InlineAlert>{test.message}</InlineAlert> : null}
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
        description={t(($) => $.collab.section.server.removeConfirm.description)}
        confirmLabel={t(($) => $.collab.section.server.removeConfirm.confirm)}
        destructive
        onConfirm={() => void doRemove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </>
  );
}
