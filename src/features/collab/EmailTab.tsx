import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Mail, MailX, Send } from "lucide-react";
import { SettingsNote } from "@/components/settings/SettingsNote";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useCopyStatus } from "@/components/ui/use-copy-status";
import { formatDateTime } from "@/lib/intl";
import type {
  CollabEmailStatus,
  CollabServer,
} from "@/lib/tauri";
import {
  collabAdminEmailStatus,
  collabAdminEmailTest,
  collabAdminPatchSettings,
} from "@/lib/tauri-collab";
import { collabErrorText } from "./errors";
import { InlineAlert, LoadFailed } from "./feedback";
import { serverRoleAllows, type ServerRole } from "./roles";

const UNDELIVERABLE = /@users\.noreply\.github\.com$/i;

type TestState =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent"; to: string[] }
  | { state: "refused"; detail: string | null }
  | { state: "failed"; message: string };

function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

export function addServerLink(serverUrl: string): string {
  const address = withoutTrailingSlashes(serverUrl.trim());
  return `oleafly://server/add?url=${encodeURIComponent(address)}`;
}

export function testAddresses(emails: readonly string[]): string[] {
  const kept: string[] = [];
  for (const email of emails) {
    const address = email.trim().toLowerCase();
    if (address.includes("@") && !UNDELIVERABLE.test(address) && !kept.includes(address)) kept.push(address);
  }
  return kept.slice(0, 5);
}

function CopyAddLink({ server }: Readonly<{ server: CollabServer }>) {
  const { t } = useTranslation(["collab"]);
  const copy = useCopyStatus();
  const link = addServerLink(server.url);
  const label = () => {
    if (copy.status === "copied") return t(($) => $.collab.manage.link.copied);
    if (copy.status === "failed") return t(($) => $.collab.manage.link.copyFailed);
    return t(($) => $.collab.manage.link.copy);
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t(($) => $.collab.admin.email.off.copyPath)}</p>
      <p className="select-text break-all rounded-md bg-muted/50 px-3 py-2 font-mono text-xs">{link}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void copy.copy(link)}>
        {copy.copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {label()}
      </Button>
      <p className="text-xs text-muted-foreground">{t(($) => $.collab.admin.email.off.address)}</p>
      <p className="select-text break-all rounded-md bg-muted/50 px-3 py-2 font-mono text-xs">{server.url}</p>
    </div>
  );
}

function EmailState({ status, server }: Readonly<{ status: CollabEmailStatus; server: CollabServer }>) {
  const { t } = useTranslation(["collab"]);
  if (status.configured && status.working === false) {
    return (
      <div className="flex items-start gap-2 rounded-lg border px-3 py-2" data-testid="collab-email-state">
        <MailX aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{t(($) => $.collab.admin.email.broken.title)}</p>
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.admin.email.broken.description)}</p>
        </div>
      </div>
    );
  }
  if (status.configured) {
    return (
      <div className="flex items-start gap-2 rounded-lg border px-3 py-2" data-testid="collab-email-state">
        <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{t(($) => $.collab.admin.email.on.title)}</p>
          {status.from ? (
            <p className="select-text break-all text-xs text-muted-foreground">
              {t(($) => $.collab.admin.email.on.from, { from: status.from })}
            </p>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border px-3 py-2" data-testid="collab-email-state">
      <div className="flex items-start gap-2">
        <MailX aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{t(($) => $.collab.admin.email.off.title)}</p>
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.admin.email.off.description)}</p>
        </div>
      </div>
      <CopyAddLink server={server} />
    </div>
  );
}

function TestEmail({
  serverId,
  configured,
  admin,
  addresses,
  onDelivered,
}: Readonly<{
  serverId: string;
  configured: boolean;
  admin: boolean;
  addresses: string[];
  onDelivered: () => void;
}>) {
  const { t } = useTranslation(["collab"]);
  const [test, setTest] = useState<TestState>({ state: "idle" });
  const ready = configured && admin && addresses.length > 0;

  const send = async () => {
    setTest({ state: "sending" });
    try {
      const result = await collabAdminEmailTest(serverId);
      setTest(result.delivered ? { state: "sent", to: result.sent_to } : { state: "refused", detail: result.error });
      // A delivered test proves email works, which can unlock notifications.
      if (result.delivered) onDelivered();
    } catch (error) {
      setTest({ state: "failed", message: collabErrorText(error) });
    }
  };

  const hint = () => {
    if (!configured) return t(($) => $.collab.admin.email.needsSettings);
    if (!admin) return t(($) => $.collab.admin.email.test.adminOnly);
    if (addresses.length === 0) return t(($) => $.collab.admin.email.test.noAddress);
    return t(($) => $.collab.admin.email.test.description, { address: addresses.join(", ") });
  };

  return (
    <div className="space-y-2 rounded-lg border px-3 py-2">
      <p className="text-sm font-medium">{t(($) => $.collab.admin.email.test.title)}</p>
      <p className="text-xs text-muted-foreground">{hint()}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!ready || test.state === "sending"}
        onClick={() => void send()}
      >
        {test.state === "sending" ? <Spinner /> : <Send aria-hidden />}
        {t(($) => $.collab.admin.email.test.send)}
      </Button>
      {test.state === "sending" ? (
        <p className="text-xs text-muted-foreground">{t(($) => $.collab.admin.email.test.sending)}</p>
      ) : null}
      {test.state === "sent" ? (
        <output className="flex items-start gap-1.5 text-xs text-foreground">
          <Check aria-hidden className="mt-px size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          {t(($) => $.collab.admin.email.test.sent, { address: test.to.join(", ") })}
        </output>
      ) : null}
      {test.state === "refused" ? (
        <InlineAlert>
          {t(($) => $.collab.admin.email.test.failed)}
          {test.detail ? <span className="mt-1 block break-words font-mono">{test.detail}</span> : null}
        </InlineAlert>
      ) : null}
      {test.state === "failed" ? <InlineAlert>{test.message}</InlineAlert> : null}
    </div>
  );
}

export function EmailTab({ server, actor }: Readonly<{ server: CollabServer; actor: ServerRole }>) {
  const { t } = useTranslation(["collab"]);
  const serverId = server.server_id;
  const admin = serverRoleAllows(actor, "changeSettings");
  const addresses = testAddresses(server.account?.emails ?? []);
  const [status, setStatus] = useState<CollabEmailStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useMemo(() => ({ serverId, request }), [serverId, request]);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    collabAdminEmailStatus(load.serverId).then(
      (next) => {
        if (active) setStatus(next);
      },
      (error: unknown) => {
        if (active) setLoadError(collabErrorText(error));
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  const changeNotifications = async (value: boolean) => {
    if (!status || saving) return;
    const previous = status;
    setStatus({ ...status, notifications: value });
    setSaving(true);
    setSaveError(null);
    try {
      const settings = await collabAdminPatchSettings(serverId, { email_notifications: value });
      setStatus((current) => (current ? { ...current, notifications: settings.email_notifications } : current));
    } catch (error) {
      setStatus(previous);
      setSaveError(collabErrorText(error));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <LoadFailed
        message={t(($) => $.collab.admin.loadFailed)}
        reason={loadError}
        onRetry={() => setRequest((count) => count + 1)}
      />
    );
  }
  if (!status) return <LoadingState size="compact" label={t(($) => $.collab.admin.email.loading)} />;

  const failure = status.last_failure;
  // Notifications stay off while email fails. An older server doesn't say
  // whether it works, so only its settings count there.
  const working = status.configured && status.working !== false;
  const notificationsNote = () => {
    if (!status.configured) return t(($) => $.collab.admin.email.needsSettings);
    if (!working) return t(($) => $.collab.admin.email.needsWorking);
    return t(($) => $.collab.admin.settings.emailNotifications.description);
  };
  return (
    <div className="space-y-3" data-testid="collab-email-tab">
      <p className="text-xs text-muted-foreground">{t(($) => $.collab.admin.email.description)}</p>
      <EmailState status={status} server={server} />
      {admin ? null : <SettingsNote>{t(($) => $.collab.admin.settings.adminOnly)}</SettingsNote>}
      <SettingsToggleRow
        testId="collab-setting-email_notifications"
        label={t(($) => $.collab.admin.settings.emailNotifications.label)}
        description={notificationsNote()}
        checked={working && status.notifications}
        disabled={!working || !admin || saving}
        onChange={(value) => void changeNotifications(value)}
      />
      {saveError ? <InlineAlert>{saveError}</InlineAlert> : null}
      <TestEmail
        serverId={serverId}
        configured={status.configured}
        admin={admin}
        addresses={addresses}
        onDelivered={() => setRequest((count) => count + 1)}
      />
      {failure ? (
        <div className="space-y-1 text-xs text-muted-foreground" data-testid="collab-email-last-failure">
          <p>{t(($) => $.collab.admin.email.lastFailure, { date: formatDateTime(failure.at) })}</p>
          <p className="select-text break-words font-mono">{failure.message}</p>
        </div>
      ) : null}
    </div>
  );
}
