import { CloudConnectPanel } from "@/components/settings/cloud/CloudConnectPanel";
import { CloudNotice } from "@/components/settings/cloud/CloudNotice";
import { CloudProjectsCard } from "@/components/settings/cloud/CloudProjectsCard";
import { CloudSyncControls } from "@/components/settings/cloud/CloudSyncControls";
import { StorageRing } from "@/components/settings/cloud/StorageRing";
import { IntegrationBusyButton, IntegrationError } from "@/components/settings/IntegrationCard";
import { DropboxBrandIcon } from "@/components/settings/IntegrationBrandIcons";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { InfoHint } from "@/components/ui/info-hint";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { describeError } from "@/lib/app-error";
import { cn } from "@/lib/utils";
import { cloudErrorCode, useCloudStore } from "@/store/cloud";
import { Files, HardDriveUpload, History, Settings2, ShieldCheck, Unplug } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

function ProviderIdentity({
  titleId,
  badge,
  email,
}: Readonly<{ titleId: string; badge?: ReactNode; email?: string | null }>) {
  const { t } = useTranslation(["cloud"]);
  return (
    <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#0061FF] text-white"
      >
        <DropboxBrandIcon className="size-5" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 id={titleId} className="text-sm font-semibold text-foreground">
            {t(($) => $.cloud.dropbox)}
          </h3>
          <InfoHint label={t(($) => $.cloud.about)}>
            {t(($) => $.cloud.aboutHint)}
          </InfoHint>
          {badge}
        </div>
        {email ? (
          <p className="truncate text-xs text-muted-foreground" data-testid="cloud-account-email">
            <Tooltip label={email} className="inline">
              {email}
            </Tooltip>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ConnectButton({ label }: Readonly<{ label: string }>) {
  const connectBusy = useCloudStore((s) => s.connectBusy);
  const beginConnect = useCloudStore((s) => s.beginConnect);
  return (
    <IntegrationBusyButton busy={connectBusy} testId="cloud-connect" onClick={() => void beginConnect(false)}>
      {label}
    </IntegrationBusyButton>
  );
}

function ConnectError() {
  const connectError = useCloudStore((s) => s.connectError);
  const connectFlow = useCloudStore((s) => s.connectFlow);
  if (!connectError || connectFlow) return null;
  return <IntegrationError>{describeError(connectError)}</IntegrationError>;
}

function ConnectView() {
  const { t } = useTranslation(["cloud"]);
  const titleId = useId();
  const state = useCloudStore((s) => s.state);
  const connectFlow = useCloudStore((s) => s.connectFlow);
  const lines = [
    { icon: Files, text: t(($) => $.cloud.syncsProjects) },
    { icon: Settings2, text: t(($) => $.cloud.syncsSettings) },
    { icon: History, text: t(($) => $.cloud.syncsNotYet) },
    { icon: ShieldCheck, text: t(($) => $.cloud.syncNever) },
  ];
  return (
    <section
      aria-labelledby={titleId}
      data-testid="cloud-provider-dropbox"
      className="overflow-hidden rounded-xl border bg-card"
    >
      <header className="flex items-center gap-3 p-4">
        <ProviderIdentity titleId={titleId} />
      </header>
      <div className="space-y-4 px-4 pb-4">
        <p className="max-w-xl text-sm leading-relaxed text-foreground">
          {t(($) => $.cloud.lead)}
        </p>
        <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
          <h4 className="text-xs font-medium text-foreground">{t(($) => $.cloud.whatSyncs)}</h4>
          <ul className="mt-2 space-y-1.5">
            {lines.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
        {connectFlow ? (
          <CloudConnectPanel />
        ) : (
          <div className="space-y-2">
            <ConnectButton label={t(($) => $.cloud.connectDropbox)} />
            <ConnectError />
          </div>
        )}
        {state?.lastEmail ? (
          <p className="text-xs text-muted-foreground">
            {t(($) => $.cloud.lastConnected, { email: state.lastEmail })}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function RevokedNotice() {
  const { t } = useTranslation(["cloud"]);
  const connectFlow = useCloudStore((s) => s.connectFlow);
  return (
    <div className="space-y-2">
      <CloudNotice
        tone="danger"
        icon={Unplug}
        testId="cloud-revoked"
        actions={connectFlow ? null : <ConnectButton label={t(($) => $.cloud.connectAgain)} />}
      >
        {t(($) => $.cloud.revoked)}
      </CloudNotice>
      {connectFlow ? <CloudConnectPanel /> : <ConnectError />}
    </div>
  );
}

function SettingsNotice() {
  const { t } = useTranslation(["cloud"]);
  const choice = useCloudStore((s) => s.settingsChoice);
  const problem = useCloudStore((s) => s.settingsProblem);
  const busy = useCloudStore((s) => s.settingsChoiceBusy);
  const error = useCloudStore((s) => s.settingsChoiceError);
  const chooseSettings = useCloudStore((s) => s.chooseSettings);
  const failure = error ? <IntegrationError>{describeError(error)}</IntegrationError> : null;

  if (choice?.deferred) {
    return (
      <div className="space-y-2">
        <CloudNotice
          tone="warning"
          icon={Settings2}
          testId="cloud-settings-waiting"
          actions={
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                data-testid="cloud-settings-waiting-local"
                onClick={() => void chooseSettings("local")}
              >
                {t(($) => $.cloud.choice.keepLocal)}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                data-testid="cloud-settings-waiting-cloud"
                onClick={() => void chooseSettings("cloud")}
              >
                {busy ? <Spinner /> : null}
                {t(($) => $.cloud.choice.useCloud)}
              </Button>
            </>
          }
        >
          <span className="block font-medium">{t(($) => $.cloud.choice.title)}</span>
          <span className="block">{t(($) => $.cloud.choice.description)}</span>
        </CloudNotice>
        {failure}
      </div>
    );
  }

  if (!problem) return null;
  const unreadable = cloudErrorCode(problem) === "cloud.remote_unreadable";
  return (
    <div className="space-y-2">
      <CloudNotice
        tone="danger"
        icon={Settings2}
        testId="cloud-settings-problem"
        actions={
          unreadable ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void chooseSettings("local")}
            >
              {busy ? <Spinner /> : null}
              {t(($) => $.cloud.useLocalSettings)}
            </Button>
          ) : null
        }
      >
        {unreadable ? t(($) => $.cloud.settingsUnreadable) : describeError(problem)}
      </CloudNotice>
      {failure}
    </div>
  );
}

function AdvancedSection({
  disconnecting,
  onDisconnect,
}: Readonly<{ disconnecting: boolean; onDisconnect: () => void }>) {
  const { t } = useTranslation(["cloud"]);
  return (
    <CollapsibleSection id="cloud-advanced" title={t(($) => $.cloud.advanced)}>
      <SettingsRow
        testId="cloud-disconnect-row"
        label={t(($) => $.cloud.disconnectRow.label)}
        description={t(($) => $.cloud.disconnectRow.description)}
        control={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="cloud-disconnect"
            disabled={disconnecting}
            onClick={onDisconnect}
            className="shrink-0 hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
          >
            {disconnecting ? <Spinner /> : <Unplug aria-hidden className="size-3.5" />}
            {t(($) => $.cloud.disconnect)}
          </Button>
        }
      />
    </CollapsibleSection>
  );
}

function AccountView() {
  const { t } = useTranslation(["cloud"]);
  const titleId = useId();
  const state = useCloudStore((s) => s.state);
  const status = useCloudStore((s) => s.status);
  const space = useCloudStore((s) => s.space);
  const disconnecting = useCloudStore((s) => s.disconnecting);
  const disconnect = useCloudStore((s) => s.disconnect);
  const watchDetails = useCloudStore((s) => s.watchDetails);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const showDetails = status === "connected";
  useEffect(() => {
    if (!showDetails) return;
    return watchDetails();
  }, [showDetails, watchDetails]);

  if (!state) return null;
  const revoked = status === "revoked";
  const quotaFull = !revoked && state.quotaFull;

  let badge: ReactNode;
  if (revoked) {
    badge = (
      <Badge variant="destructive" size="sm">
        {t(($) => $.cloud.badge.revoked)}
      </Badge>
    );
  } else if (quotaFull) {
    badge = (
      <Badge variant="warning" size="sm">
        {t(($) => $.cloud.badge.full)}
      </Badge>
    );
  }

  return (
    <section
      aria-labelledby={titleId}
      data-testid="cloud-provider-dropbox"
      className="overflow-hidden rounded-xl border bg-card"
    >
      <header className={cn("flex flex-wrap items-center gap-x-6 gap-y-3 p-4", showDetails && "min-h-22")}>
        <ProviderIdentity titleId={titleId} badge={badge} email={state.email ?? state.lastEmail} />
        {showDetails ? <StorageRing space={space} /> : null}
      </header>
      <div className="space-y-4 px-4 pb-4">
        {revoked ? <RevokedNotice /> : null}
        {quotaFull ? (
          <CloudNotice tone="warning" icon={HardDriveUpload} testId="cloud-quota-full">
            {t(($) => $.cloud.quotaFull)}
          </CloudNotice>
        ) : null}
        {revoked ? null : <SettingsNotice />}
        <CloudSyncControls />
        <CloudProjectsCard />
        <AdvancedSection disconnecting={disconnecting} onDisconnect={() => setConfirmDisconnect(true)} />
      </div>
      <ConfirmationDialog
        open={confirmDisconnect}
        destructive
        title={t(($) => $.cloud.confirm.disconnectTitle)}
        description={t(($) => $.cloud.confirm.disconnectDescription)}
        confirmLabel={t(($) => $.cloud.confirm.disconnectAction)}
        onConfirm={() => {
          setConfirmDisconnect(false);
          void disconnect();
        }}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </section>
  );
}

export function DropboxProviderCard() {
  const status = useCloudStore((s) => s.status);
  if (status === "connected" || status === "revoked") return <AccountView />;
  return <ConnectView />;
}
