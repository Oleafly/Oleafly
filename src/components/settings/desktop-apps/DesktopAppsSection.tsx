import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { LoadingState } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/section-heading";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  IntegrationCard,
  IntegrationConnected,
  IntegrationError,
} from "@/components/settings/IntegrationCard";
import { SettingsPath, SettingsPathText } from "@/components/settings/SettingsPath";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { decodeAppError, describeError } from "@/lib/app-error";
import {
  cuaDriverSettingsSet,
  cuaDriverTest,
  syncDesktopAppsTool,
  type DesktopAppsSettings,
  type DesktopAppsStatus,
  type DesktopAppsTestReport,
  type InstalledApp,
} from "@/lib/desktop-apps";
import { openInSystemBrowser } from "@/lib/system-browser";
import { shellCommandLine } from "@/lib/terminal-quote";
import { useFilesStore } from "@/store/files";
import { SpacesCard } from "./SpacesCard";
import { storeSavedSettings, useDesktopAppsStatus } from "./desktop-apps-queries";
import { runInTerminal } from "./run-in-terminal";

const AppPickerDialog = lazy(() => import("./AppPickerDialog"));

const CUA_DRIVER_DOCS_URL = "https://cua.ai/docs/cua-driver";

const CHANGE_DECLINED = "desktop_apps.change_declined";

export default function DesktopAppsSection() {
  const { t } = useTranslation(["common", "settings"]);
  const client = useQueryClient();
  const status = useDesktopAppsStatus();
  const projectId = useFilesStore((state) => state.projectId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [site, setSite] = useState("");

  const title = t(($) => $.settings.integrations.desktopApps.title);
  const description = t(($) => $.settings.integrations.desktopApps.description);
  const data = status.data;
  if (!data) {
    return (
      <IntegrationCard testId="desktop-apps-section" title={title} description={description}>
        {status.isError ? (
          <IntegrationError>{describeError(status.error)}</IntegrationError>
        ) : (
          <LoadingState label={t(($) => $.common.state.loading)} size="compact" />
        )}
      </IntegrationCard>
    );
  }

  const settings = data.settings;

  const save = async (
    next: DesktopAppsSettings,
    showError: (message: string | null) => void = setError,
  ): Promise<boolean> => {
    setSaving(true);
    setError(null);
    setNotice(null);
    setSiteError(null);
    try {
      const saved = await cuaDriverSettingsSet(next);
      storeSavedSettings(client, saved);
      await syncDesktopAppsTool();
      return true;
    } catch (error_) {
      if (decodeAppError(error_)?.code === CHANGE_DECLINED) {
        setNotice(describeError(error_));
      } else {
        showError(describeError(error_));
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addApp = (app: InstalledApp) =>
    void save({
      ...settings,
      apps: [...settings.apps, { name: app.name, bundleId: app.bundleId, executable: app.executable }],
    });

  const addSite = async () => {
    const origin = site.trim();
    if (!origin || saving) return;
    const added = await save(
      { ...settings, sites: [...settings.sites, { origin, signedIn: false }] },
      setSiteError,
    );
    if (added) setSite("");
  };

  return (
    <div className="space-y-4" data-testid="desktop-apps-section">
      <IntegrationCard
        title={title}
        description={description}
        hint={
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto gap-1 p-0 text-xs"
            onClick={() => void openInSystemBrowser(CUA_DRIVER_DOCS_URL)}
          >
            {t(($) => $.settings.integrations.desktopApps.docsLink)}
            <ExternalLink aria-hidden className="size-3" />
          </Button>
        }
      >
        <DriverStatus status={data} projectId={projectId} onCheckAgain={() => void status.refetch()} />
      </IntegrationCard>

      {data.permissions && data.driverProblem === null ? (
        <PermissionsRow
          status={data}
          projectId={projectId}
          checking={status.isFetching}
          onCheckAgain={() => void status.refetch()}
        />
      ) : null}

      <GnomeHelperRow status={data} checking={status.isFetching} onCheckAgain={() => void status.refetch()} />

      <SettingsToggleRow
        testId="desktop-apps-enable"
        label={t(($) => $.settings.integrations.desktopApps.enable.label)}
        description={t(($) => $.settings.integrations.desktopApps.enable.description)}
        checked={settings.enabled}
        disabled={saving || (data.driverProblem !== null && !settings.enabled)}
        onChange={(enabled) => void save({ ...settings, enabled })}
      />

      <AllowedApps
        settings={settings}
        missingApps={data.missingApps}
        saving={saving}
        onSave={(next) => void save(next)}
        onAdd={() => setPickerOpen(true)}
      />

      <AllowedSites
        settings={settings}
        saving={saving}
        siteError={siteError}
        site={site}
        onSiteChange={setSite}
        onSubmit={() => void addSite()}
        onSave={(next) => void save(next)}
      />

      <SettingsToggleRow
        testId="desktop-apps-scripted"
        label={t(($) => $.settings.integrations.desktopApps.scripted.label)}
        description={t(($) => $.settings.integrations.desktopApps.scripted.description)}
        checked={settings.scriptedControl}
        disabled={saving}
        onChange={(scriptedControl) => void save({ ...settings, scriptedControl })}
      />

      <SettingsToggleRow
        testId="desktop-apps-ask"
        label={t(($) => $.settings.integrations.desktopApps.ask.label)}
        description={t(($) => $.settings.integrations.desktopApps.ask.description)}
        checked={settings.askBeforeActions}
        disabled={saving}
        onChange={(askBeforeActions) => void save({ ...settings, askBeforeActions })}
      />

      {error ? <IntegrationError>{error}</IntegrationError> : null}
      {notice ? (
        <output className="block text-xs text-muted-foreground" data-testid="desktop-apps-declined">
          {notice}
        </output>
      ) : null}

      <DriverTest unavailable={!settings.enabled || data.driverProblem !== null} />

      <SpacesCard status={data} projectId={projectId} />

      {pickerOpen ? (
        <Suspense fallback={null}>
          <AppPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} existing={settings.apps} onPick={addApp} />
        </Suspense>
      ) : null}
    </div>
  );
}

function GnomeHelperRow({
  status,
  checking,
  onCheckAgain,
}: Readonly<{ status: DesktopAppsStatus; checking: boolean; onCheckAgain(): void }>) {
  const { t } = useTranslation(["common", "settings"]);
  if (status.gnomeHelper === null) return null;
  return (
    <SettingsRow
      testId="desktop-apps-gnome"
      label={t(($) => $.settings.integrations.desktopApps.gnome.heading)}
      description={
        status.gnomeHelper
          ? t(($) => $.settings.integrations.desktopApps.gnome.active)
          : t(($) => $.settings.integrations.desktopApps.gnome.needed)
      }
      details={
        !status.gnomeHelper && status.gnomeHelperLine ? (
          <CodeBlock className="mt-2" code={status.gnomeHelperLine} />
        ) : null
      }
      control={
        status.gnomeHelper ? null : (
          <Button type="button" variant="outline" size="sm" disabled={checking} onClick={onCheckAgain}>
            {t(($) => $.settings.integrations.desktopApps.install.checkAgain)}
          </Button>
        )
      }
    />
  );
}

interface AllowedListProps {
  settings: DesktopAppsSettings;
  saving: boolean;
  onSave(next: DesktopAppsSettings): void;
}

function AllowedApps({
  settings,
  missingApps,
  saving,
  onSave,
  onAdd,
}: Readonly<AllowedListProps & { missingApps: readonly string[]; onAdd(): void }>) {
  const { t } = useTranslation(["common", "settings"]);
  return (
    <section className="space-y-2" data-testid="desktop-apps-apps">
      <div className="flex items-center justify-between gap-2">
        <SectionHeading as="h4">{t(($) => $.settings.integrations.desktopApps.apps.heading)}</SectionHeading>
        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onAdd}>
          <Plus aria-hidden className="size-3.5" />
          {t(($) => $.settings.integrations.desktopApps.apps.add)}
        </Button>
      </div>
      {settings.apps.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.integrations.desktopApps.apps.empty)}</p>
      ) : (
        settings.apps.map((app, index) => (
          <SettingsRow
            key={app.bundleId ?? app.executable ?? app.name}
            label={app.name}
            description={
              <>
                {app.bundleId ?? (app.executable ? <SettingsPath path={app.executable} /> : null)}
                {app.executable && missingApps.includes(app.executable) ? (
                  <span className="mt-0.5 block" data-testid="desktop-apps-missing">
                    {t(($) => $.settings.integrations.desktopApps.apps.missing)}
                  </span>
                ) : null}
              </>
            }
            control={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={saving}
                aria-label={t(($) => $.settings.integrations.desktopApps.apps.remove, { name: app.name })}
                onClick={() =>
                  onSave({ ...settings, apps: settings.apps.filter((_, position) => position !== index) })
                }
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            }
          />
        ))
      )}
    </section>
  );
}

interface AllowedSitesProps extends AllowedListProps {
  siteError: string | null;
  site: string;
  onSiteChange(site: string): void;
  onSubmit(): void;
}

function AllowedSites({ settings, saving, siteError, site, onSiteChange, onSubmit, onSave }: Readonly<AllowedSitesProps>) {
  const { t } = useTranslation(["common", "settings"]);
  return (
    <section className="space-y-2" data-testid="desktop-apps-sites">
      <SectionHeading as="h4">{t(($) => $.settings.integrations.desktopApps.sites.heading)}</SectionHeading>
      {/* No browser validation: WebKit blocks a bad address without saying
          so. Rust checks the address and the message shows below. */}
      <form
        noValidate
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Input
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={site}
          disabled={saving}
          onChange={(event) => onSiteChange(event.target.value)}
          placeholder={t(($) => $.settings.integrations.desktopApps.sites.placeholder)}
          aria-label={t(($) => $.settings.integrations.desktopApps.sites.add)}
          aria-invalid={siteError ? true : undefined}
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="sm" disabled={saving || !site.trim()}>
          {t(($) => $.settings.integrations.desktopApps.sites.add)}
        </Button>
      </form>
      {siteError ? <IntegrationError>{siteError}</IntegrationError> : null}
      {settings.sites.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.integrations.desktopApps.sites.empty)}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t(($) => $.settings.integrations.desktopApps.sites.signedIn.description)}
        </p>
      )}
      {settings.sites.map((entry, index) => (
        <SettingsRow
          key={entry.origin}
          label={entry.origin}
          control={
            <div className="flex shrink-0 items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={entry.signedIn}
                  disabled={saving}
                  aria-label={t(($) => $.settings.integrations.desktopApps.sites.signedIn.labelFor, {
                    origin: entry.origin,
                  })}
                  onCheckedChange={(signedIn) =>
                    onSave({
                      ...settings,
                      sites: settings.sites.map((known, position) =>
                        position === index ? { ...known, signedIn } : known,
                      ),
                    })
                  }
                />
                <span aria-hidden>{t(($) => $.settings.integrations.desktopApps.sites.signedIn.label)}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={saving}
                aria-label={t(($) => $.settings.integrations.desktopApps.sites.remove, { origin: entry.origin })}
                onClick={() =>
                  onSave({ ...settings, sites: settings.sites.filter((_, position) => position !== index) })
                }
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </div>
          }
        />
      ))}
    </section>
  );
}

function failedDetail(found: DesktopAppsTestReport): string {
  const runtime = found.runtimes.find((entry) => !entry.ok);
  if (runtime?.detail) return describeError(runtime.detail);
  return found.problems.join(" ");
}

function DriverTest({ unavailable }: Readonly<{ unavailable: boolean }>) {
  const { t } = useTranslation(["common", "settings"]);
  const [testing, setTesting] = useState(false);
  const [report, setReport] = useState<DesktopAppsTestReport | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const runTest = async () => {
    setTesting(true);
    setReport(null);
    setTestError(null);
    try {
      setReport(await cuaDriverTest());
    } catch (error) {
      setTestError(describeError(error));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="desktop-apps-test"
        disabled={testing || unavailable}
        onClick={() => void runTest()}
      >
        {testing ? <Spinner /> : null}
        {testing
          ? t(($) => $.settings.integrations.desktopApps.test.running)
          : t(($) => $.settings.integrations.desktopApps.test.action)}
      </Button>
      {report?.ok ? (
        <IntegrationConnected testId="desktop-apps-test-ok">
          {t(($) => $.settings.integrations.desktopApps.test.ok)}
        </IntegrationConnected>
      ) : null}
      {report && !report.ok ? (
        <IntegrationError>
          {t(($) => $.settings.integrations.desktopApps.test.failed, { detail: failedDetail(report) })}
        </IntegrationError>
      ) : null}
      {report && report.problems.length > 0 ? (
        <div className="space-y-1 text-xs text-muted-foreground" data-testid="desktop-apps-test-problems">
          <p>{t(($) => $.settings.integrations.desktopApps.test.problems)}</p>
          <ul className="list-disc pl-4">
            {report.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {testError ? (
        <IntegrationError>
          {t(($) => $.settings.integrations.desktopApps.test.failed, { detail: testError })}
        </IntegrationError>
      ) : null}
    </div>
  );
}

function DriverStatus({
  status,
  projectId,
  onCheckAgain,
}: Readonly<{ status: DesktopAppsStatus; projectId: string | null; onCheckAgain(): void }>) {
  const { t } = useTranslation(["common", "settings"]);
  if (status.driverProblem === null) {
    return (
      <div className="space-y-1">
        <IntegrationConnected testId="desktop-apps-installed">
          {status.driverVersion
            ? t(($) => $.settings.integrations.desktopApps.status.installed, { version: status.driverVersion })
            : t(($) => $.settings.integrations.desktopApps.status.installedNoVersion)}
        </IntegrationConnected>
        {status.driverPath ? (
          <p className="text-xs text-muted-foreground">
            <SettingsPathText
              text={t(($) => $.settings.integrations.desktopApps.status.path, { path: status.driverPath })}
            />
          </p>
        ) : null}
      </div>
    );
  }
  const problemText = (): string => {
    if (status.driverProblem === "too_old") {
      return t(($) => $.settings.integrations.desktopApps.status.tooOld, {
        version: status.driverVersion ?? "",
        minimum: status.minimumVersion,
      });
    }
    if (status.driverProblem === "no_app_bundle") return t(($) => $.settings.integrations.desktopApps.status.noAppBundle);
    if (status.driverProblem === "unreadable_version") {
      return t(($) => $.settings.integrations.desktopApps.status.unreadableVersion);
    }
    return t(($) => $.settings.integrations.desktopApps.status.notInstalled);
  };
  const problem = problemText();
  return (
    <div className="space-y-2" data-testid="desktop-apps-install">
      <p className="text-xs text-muted-foreground">{problem}</p>
      <SectionHeading as="h4">{t(($) => $.settings.integrations.desktopApps.install.heading)}</SectionHeading>
      <p className="text-xs text-muted-foreground">{t(($) => $.settings.integrations.desktopApps.install.hint)}</p>
      <CodeBlock code={status.installLine} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!projectId}
          onClick={() =>
            void runInTerminal(
              t(($) => $.settings.integrations.desktopApps.install.terminalTitle),
              status.installCommand,
              t(($) => $.settings.integrations.desktopApps.install.confirm),
            )
          }
        >
          {t(($) => $.settings.integrations.desktopApps.install.run)}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCheckAgain}>
          {t(($) => $.settings.integrations.desktopApps.install.checkAgain)}
        </Button>
      </div>
      {projectId ? null : (
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.integrations.desktopApps.install.needsProject)}</p>
      )}
    </div>
  );
}

function PermissionsRow({
  status,
  projectId,
  checking,
  onCheckAgain,
}: Readonly<{ status: DesktopAppsStatus; projectId: string | null; checking: boolean; onCheckAgain(): void }>) {
  const { t } = useTranslation(["common", "settings"]);
  const permissions = status.permissions;
  if (!permissions) return null;
  const granted = permissions.accessibility === true && permissions.screenRecording === true;
  const missing = permissions.accessibility === false || permissions.screenRecording === false;
  const grant = status.driverPath ? { program: status.driverPath, args: ["permissions", "grant"] } : null;
  let description = permissions.unchecked
    ? t(($) => $.settings.integrations.desktopApps.permissions.unchecked)
    : t(($) => $.settings.integrations.desktopApps.permissions.unknown);
  if (granted) description = t(($) => $.settings.integrations.desktopApps.permissions.granted);
  else if (missing) description = t(($) => $.settings.integrations.desktopApps.permissions.needed);
  return (
    <SettingsRow
      testId="desktop-apps-permissions"
      label={t(($) => $.settings.integrations.desktopApps.permissions.heading)}
      description={description}
      details={
        granted ? null : (
          <div className="mt-2 space-y-2">
            {grant && !projectId ? (
              <CodeBlock
                code={shellCommandLine("posix", { command: grant.program, args: grant.args })}
                preClassName="whitespace-pre-wrap break-words"
              />
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {grant ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={!projectId}
                  onClick={() =>
                    void runInTerminal(t(($) => $.settings.integrations.desktopApps.permissions.terminalTitle), grant)
                  }
                >
                  {t(($) => $.settings.integrations.desktopApps.permissions.grant)}
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" disabled={checking} onClick={onCheckAgain}>
                {t(($) => $.settings.integrations.desktopApps.install.checkAgain)}
              </Button>
            </div>
            {grant && !projectId ? (
              <p className="text-xs text-muted-foreground">
                {t(($) => $.settings.integrations.desktopApps.install.needsProject)}
              </p>
            ) : null}
          </div>
        )
      }
    />
  );
}
