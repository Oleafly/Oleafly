import { CloudConnectPanel } from "@/components/settings/cloud/CloudConnectPanel";
import { CloudNotice } from "@/components/settings/cloud/CloudNotice";
import { CloudProjectsCard } from "@/components/settings/cloud/CloudProjectsCard";
import { CloudProviderLogo } from "@/components/settings/cloud/CloudProviderLogo";
import { CloudSyncControls } from "@/components/settings/cloud/CloudSyncControls";
import { S3ConnectForm } from "@/components/settings/cloud/S3ConnectForm";
import { StorageRing } from "@/components/settings/cloud/StorageRing";
import { IntegrationBusyButton, IntegrationError } from "@/components/settings/IntegrationCard";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { InfoHint } from "@/components/ui/info-hint";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { describeError } from "@/lib/app-error";
import type { CloudProviderInfo, CloudProviderKind } from "@/lib/cloud";
import { cloudProviderName } from "@/lib/cloud-providers";
import { cn } from "@/lib/utils";
import { cloudErrorCode, useCloudStore } from "@/store/cloud";
import { Files, HardDriveUpload, History, Settings2, ShieldCheck, Unplug } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

function useProviderInfo(kind: CloudProviderKind): CloudProviderInfo | undefined {
  return useCloudStore((s) => s.providers?.find((provider) => provider.kind === kind));
}

function ProviderIdentity({
  titleId,
  kind,
  badge,
  email,
}: Readonly<{ titleId: string; kind: CloudProviderKind | null; badge?: ReactNode; email?: string | null }>) {
  const { t } = useTranslation(["cloud"]);
  const name = cloudProviderName(kind);
  return (
    <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
      <CloudProviderLogo kind={kind} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 id={titleId} className="text-sm font-semibold text-foreground">
            {kind ? name : t(($) => $.cloud.title)}
          </h3>
          <InfoHint label={t(($) => $.cloud.about)}>
            {t(($) => $.cloud.aboutHint, { provider: name })}
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

function ConnectButton({ label, provider }: Readonly<{ label: string; provider: CloudProviderKind }>) {
  const connectBusy = useCloudStore((s) => s.connectBusy);
  const beginConnect = useCloudStore((s) => s.beginConnect);
  return (
    <IntegrationBusyButton busy={connectBusy} testId="cloud-connect" onClick={() => void beginConnect(provider)}>
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

function ProviderOption({
  provider,
  onChoose,
}: Readonly<{ provider: CloudProviderInfo; onChoose: (provider: CloudProviderInfo) => void }>) {
  const { t } = useTranslation(["cloud"]);
  const id = useId();
  const connectBusy = useCloudStore((s) => s.connectBusy);
  const starting = useCloudStore((s) => s.connectBusy && s.connectProvider === provider.kind);
  return (
    <button
      type="button"
      data-testid={`cloud-provider-option-${provider.kind}`}
      aria-labelledby={`${id}-name`}
      aria-describedby={`${id}-hint`}
      disabled={!provider.available || connectBusy}
      onClick={() => onChoose(provider)}
      className="flex min-w-0 items-start gap-3 rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent focus-visible:border-primary focus-visible:bg-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-background"
    >
      <CloudProviderLogo kind={provider.kind} size="sm" />
      <span className="min-w-0">
        <span id={`${id}-name`} className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {cloudProviderName(provider.kind)}
          {starting ? <Spinner size="sm" /> : null}
        </span>
        <span id={`${id}-hint`} className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {provider.available ? t(($) => $.cloud.providerHint[provider.kind]) : t(($) => $.cloud.unavailable)}
        </span>
      </span>
    </button>
  );
}

function ProviderChooser({ onCredentials }: Readonly<{ onCredentials: (kind: CloudProviderKind) => void }>) {
  const { t } = useTranslation(["cloud"]);
  const providers = useCloudStore((s) => s.providers);
  const beginConnect = useCloudStore((s) => s.beginConnect);
  const choose = (provider: CloudProviderInfo) => {
    if (provider.auth === "credentials") onCredentials(provider.kind);
    else void beginConnect(provider.kind);
  };
  return (
    <div className="space-y-2">
      <fieldset>
        <legend className="text-xs font-medium text-foreground">{t(($) => $.cloud.choose)}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {(providers ?? []).map((provider) => (
            <ProviderOption key={provider.kind} provider={provider} onChoose={choose} />
          ))}
        </div>
      </fieldset>
      <ConnectError />
    </div>
  );
}

function ConnectView() {
  const { t } = useTranslation(["cloud"]);
  const titleId = useId();
  const state = useCloudStore((s) => s.state);
  const connectFlow = useCloudStore((s) => s.connectFlow);
  const cancelConnect = useCloudStore((s) => s.cancelConnect);
  const [form, setForm] = useState<CloudProviderKind | null>(null);
  const lines = [
    { icon: Files, text: t(($) => $.cloud.syncsProjects) },
    { icon: Settings2, text: t(($) => $.cloud.syncsSettings) },
    { icon: History, text: t(($) => $.cloud.syncsNotYet) },
    { icon: ShieldCheck, text: t(($) => $.cloud.syncNever) },
  ];
  let connect: ReactNode;
  if (connectFlow) {
    connect = <CloudConnectPanel />;
  } else if (form) {
    connect = (
      <S3ConnectForm
        onCancel={() => {
          cancelConnect();
          setForm(null);
        }}
      />
    );
  } else {
    connect = <ProviderChooser onCredentials={setForm} />;
  }
  return (
    <section
      aria-labelledby={titleId}
      data-testid="cloud-chooser"
      className="overflow-hidden rounded-xl border bg-card"
    >
      <header className="flex items-center gap-3 p-4">
        <ProviderIdentity titleId={titleId} kind={null} />
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
        {connect}
        {state?.lastEmail ? (
          <p className="text-xs text-muted-foreground">
            {t(($) => $.cloud.lastConnected, { email: state.lastEmail })}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function RevokedNotice({ kind }: Readonly<{ kind: CloudProviderKind }>) {
  const { t } = useTranslation(["cloud"]);
  const connectFlow = useCloudStore((s) => s.connectFlow);
  const cancelConnect = useCloudStore((s) => s.cancelConnect);
  const credentials = useProviderInfo(kind)?.auth === "credentials";
  const [formOpen, setFormOpen] = useState(false);
  let actions: ReactNode = null;
  if (credentials && !formOpen) {
    actions = (
      <Button type="button" size="sm" data-testid="cloud-connect" onClick={() => setFormOpen(true)}>
        {t(($) => $.cloud.connectAgain)}
      </Button>
    );
  } else if (!credentials && !connectFlow) {
    actions = <ConnectButton label={t(($) => $.cloud.connectAgain)} provider={kind} />;
  }
  let below: ReactNode = <ConnectError />;
  if (credentials && formOpen) {
    below = (
      <S3ConnectForm
        onCancel={() => {
          cancelConnect();
          setFormOpen(false);
        }}
      />
    );
  } else if (connectFlow) {
    below = <CloudConnectPanel />;
  }
  return (
    <div className="space-y-2">
      <CloudNotice tone="danger" icon={Unplug} testId="cloud-revoked" actions={actions}>
        {t(($) => $.cloud.revoked, { provider: cloudProviderName(kind) })}
      </CloudNotice>
      {below}
    </div>
  );
}

function SettingsNotice({ provider }: Readonly<{ provider: string }>) {
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
                {t(($) => $.cloud.choice.useCloud, { provider })}
              </Button>
            </>
          }
        >
          <span className="block font-medium">{t(($) => $.cloud.choice.title)}</span>
          <span className="block">{t(($) => $.cloud.choice.description, { provider })}</span>
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
        {unreadable ? t(($) => $.cloud.settingsUnreadable, { provider }) : describeError(problem)}
      </CloudNotice>
      {failure}
    </div>
  );
}

function AdvancedSection({
  provider,
  disconnecting,
  onDisconnect,
}: Readonly<{ provider: string; disconnecting: boolean; onDisconnect: () => void }>) {
  const { t } = useTranslation(["cloud"]);
  return (
    <CollapsibleSection id="cloud-advanced" title={t(($) => $.cloud.advanced)}>
      <SettingsRow
        testId="cloud-disconnect-row"
        label={t(($) => $.cloud.disconnectRow.label, { provider })}
        description={t(($) => $.cloud.disconnectRow.description, { provider })}
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

function AccountView({ kind }: Readonly<{ kind: CloudProviderKind }>) {
  const { t } = useTranslation(["cloud"]);
  const titleId = useId();
  const state = useCloudStore((s) => s.state);
  const status = useCloudStore((s) => s.status);
  const space = useCloudStore((s) => s.space);
  const disconnecting = useCloudStore((s) => s.disconnecting);
  const disconnect = useCloudStore((s) => s.disconnect);
  const watchDetails = useCloudStore((s) => s.watchDetails);
  const quota = useProviderInfo(kind)?.quota ?? false;
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const showDetails = status === "connected";
  useEffect(() => {
    if (!showDetails) return;
    return watchDetails();
  }, [showDetails, watchDetails]);

  if (!state) return null;
  const provider = cloudProviderName(kind);
  const revoked = status === "revoked";
  const quotaFull = quota && !revoked && state.quotaFull;
  const showRing = showDetails && quota;

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
        {t(($) => $.cloud.badge.full, { provider })}
      </Badge>
    );
  }

  return (
    <section
      aria-labelledby={titleId}
      data-testid={`cloud-provider-${kind}`}
      className="overflow-hidden rounded-xl border bg-card"
    >
      <header className={cn("flex flex-wrap items-center gap-x-6 gap-y-3 p-4", showRing && "min-h-22")}>
        <ProviderIdentity titleId={titleId} kind={kind} badge={badge} email={state.email ?? state.lastEmail} />
        {showRing ? <StorageRing space={space} /> : null}
      </header>
      <div className="space-y-4 px-4 pb-4">
        {revoked ? <RevokedNotice kind={kind} /> : null}
        {quotaFull ? (
          <CloudNotice tone="warning" icon={HardDriveUpload} testId="cloud-quota-full">
            {t(($) => $.cloud.quotaFull, { provider })}
          </CloudNotice>
        ) : null}
        {revoked ? null : <SettingsNotice provider={provider} />}
        <CloudSyncControls />
        <CloudProjectsCard />
        <AdvancedSection
          provider={provider}
          disconnecting={disconnecting}
          onDisconnect={() => setConfirmDisconnect(true)}
        />
      </div>
      <ConfirmationDialog
        open={confirmDisconnect}
        destructive
        title={t(($) => $.cloud.confirm.disconnectTitle, { provider })}
        description={t(($) => $.cloud.confirm.disconnectDescription, { provider })}
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

/** Cloud sync for the connected provider, or a choice of providers to connect. */
export function CloudProviderCard() {
  const status = useCloudStore((s) => s.status);
  const provider = useCloudStore((s) => s.state?.provider);
  // A connection saved before there was a choice of providers is Dropbox.
  if (status === "connected" || status === "revoked") return <AccountView kind={provider ?? "dropbox"} />;
  return <ConnectView />;
}
