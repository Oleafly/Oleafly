import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { LoadingState } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
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
import { describeError } from "@/lib/app-error";
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
import { useFilesStore } from "@/store/files";
import { SpacesCard } from "./SpacesCard";
import { storeSavedSettings, useDesktopAppsStatus } from "./desktop-apps-queries";
import { runInTerminal } from "./run-in-terminal";

const AppPickerDialog = lazy(() => import("./AppPickerDialog"));

const CUA_DRIVER_DOCS_URL = "https://cua.ai/docs/cua-driver";

function SectionHeading({ children }: Readonly<{ children: string }>) {
  return <h4 className="text-sm font-medium">{children}</h4>;
}

/** Settings › Integrations › Desktop apps. */
export default function DesktopAppsSection() {
  const { t } = useTranslation(["common", "settings"]);
  const client = useQueryClient();
  const status = useDesktopAppsStatus();
  const projectId = useFilesStore((state) => state.projectId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [site, setSite] = useState("");
  const [testing, setTesting] = useState(false);
  const [report, setReport] = useState<DesktopAppsTestReport | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

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

  const save = async (next: DesktopAppsSettings): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const saved = await cuaDriverSettingsSet(next);
      storeSavedSettings(client, saved);
      await syncDesktopAppsTool();
      return true;
    } catch (failure) {
      setError(describeError(failure));
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
    if (!origin) return;
    if (await save({ ...settings, sites: [...settings.sites, { origin, signedIn: false }] })) setSite("");
  };

  const runTest = async () => {
    setTesting(true);
    setReport(null);
    setTestError(null);
    try {
      setReport(await cuaDriverTest());
    } catch (failure) {
      setTestError(describeError(failure));
    } finally {
      setTesting(false);
    }
  };

  const failedDetail = (found: DesktopAppsTestReport): string => {
    const runtime = found.runtimes.find((entry) => !entry.ok);
    if (runtime?.detail) return describeError(runtime.detail);
    return found.problems.join(" ");
  };

  return (
    <div className="space-y-4" data-testid="desktop-apps-section">
      <IntegrationCard
        title={title}
        description={description}
        hint={
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:underline"
            onClick={() => void openInSystemBrowser(CUA_DRIVER_DOCS_URL)}
          >
            {t(($) => $.settings.integrations.desktopApps.docsLink)}
            <ExternalLink aria-hidden className="size-3" />
          </button>
        }
      >
        <DriverStatus status={data} projectId={projectId} onCheckAgain={() => void status.refetch()} />
      </IntegrationCard>

      {data.permissions ? (
        <SettingsRow
          testId="desktop-apps-permissions"
          label={t(($) => $.settings.integrations.desktopApps.permissions.heading)}
          description={
            data.permissions.accessibility === true && data.permissions.screenRecording === true
              ? t(($) => $.settings.integrations.desktopApps.permissions.granted)
              : data.permissions.accessibility === false || data.permissions.screenRecording === false
                ? t(($) => $.settings.integrations.desktopApps.permissions.needed)
                : t(($) => $.settings.integrations.desktopApps.permissions.unknown)
          }
          control={
            data.driverPath &&
            !(data.permissions.accessibility === true && data.permissions.screenRecording === true) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  void runInTerminal(t(($) => $.settings.integrations.desktopApps.permissions.terminalTitle), {
                    program: data.driverPath ?? "",
                    args: ["permissions", "grant"],
                  })
                }
              >
                {t(($) => $.settings.integrations.desktopApps.permissions.grant)}
              </Button>
            ) : null
          }
        />
      ) : null}

      {data.gnomeHelper === null ? null : (
        <SettingsRow
          testId="desktop-apps-gnome"
          label={t(($) => $.settings.integrations.desktopApps.gnome.heading)}
          description={
            data.gnomeHelper
              ? t(($) => $.settings.integrations.desktopApps.gnome.active)
              : t(($) => $.settings.integrations.desktopApps.gnome.needed)
          }
          details={
            !data.gnomeHelper && data.gnomeHelperLine ? (
              <CodeBlock className="mt-2" code={data.gnomeHelperLine} />
            ) : null
          }
        />
      )}

      <SettingsToggleRow
        testId="desktop-apps-enable"
        label={t(($) => $.settings.integrations.desktopApps.enable.label)}
        description={t(($) => $.settings.integrations.desktopApps.enable.description)}
        checked={settings.enabled}
        disabled={saving || (data.driverProblem !== null && !settings.enabled)}
        onChange={(enabled) => void save({ ...settings, enabled })}
      />

      <section className="space-y-2" data-testid="desktop-apps-apps">
        <div className="flex items-center justify-between gap-2">
          <SectionHeading>{t(($) => $.settings.integrations.desktopApps.apps.heading)}</SectionHeading>
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setPickerOpen(true)}>
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
              description={app.bundleId ?? (app.executable ? <SettingsPath path={app.executable} /> : null)}
              control={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={saving}
                  aria-label={t(($) => $.settings.integrations.desktopApps.apps.remove, { name: app.name })}
                  onClick={() =>
                    void save({ ...settings, apps: settings.apps.filter((_, position) => position !== index) })
                  }
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              }
            />
          ))
        )}
      </section>

      <section className="space-y-2" data-testid="desktop-apps-sites">
        <SectionHeading>{t(($) => $.settings.integrations.desktopApps.sites.heading)}</SectionHeading>
        <p className="text-xs text-muted-foreground">
          {t(($) => $.settings.integrations.desktopApps.sites.signedIn.description)}
        </p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void addSite();
          }}
        >
          <Input
            type="url"
            value={site}
            onChange={(event) => setSite(event.target.value)}
            placeholder={t(($) => $.settings.integrations.desktopApps.sites.placeholder)}
            aria-label={t(($) => $.settings.integrations.desktopApps.sites.add)}
            className="min-w-0 flex-1"
          />
          <Button type="submit" size="sm" disabled={saving || !site.trim()}>
            {t(($) => $.settings.integrations.desktopApps.sites.add)}
          </Button>
        </form>
        {settings.sites.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t(($) => $.settings.integrations.desktopApps.sites.empty)}</p>
        ) : (
          settings.sites.map((entry, index) => (
            <SettingsRow
              key={entry.origin}
              label={entry.origin}
              control={
                <div className="flex shrink-0 items-center gap-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                      checked={entry.signedIn}
                      disabled={saving}
                      aria-label={t(($) => $.settings.integrations.desktopApps.sites.signedIn.label)}
                      onCheckedChange={(signedIn) =>
                        void save({
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
                      void save({ ...settings, sites: settings.sites.filter((_, position) => position !== index) })
                    }
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
              }
            />
          ))
        )}
      </section>

      <SettingsToggleRow
        testId="desktop-apps-scripted"
        label={t(($) => $.settings.integrations.desktopApps.scripted.label)}
        description={t(($) => $.settings.integrations.desktopApps.scripted.description)}
        checked={settings.scriptedControl}
        disabled={saving}
        onChange={(scriptedControl) => void save({ ...settings, scriptedControl })}
      />

      {error ? <IntegrationError>{error}</IntegrationError> : null}

      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="desktop-apps-test"
          disabled={testing || !settings.enabled || data.driverProblem !== null}
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
        {testError ? (
          <IntegrationError>
            {t(($) => $.settings.integrations.desktopApps.test.failed, { detail: testError })}
          </IntegrationError>
        ) : null}
      </div>

      <SpacesCard status={data} projectId={projectId} />

      {pickerOpen ? (
        <Suspense fallback={null}>
          <AppPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} existing={settings.apps} onPick={addApp} />
        </Suspense>
      ) : null}
    </div>
  );
}

/** Installed, missing or too old, with the official install line. */
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
  const problem =
    status.driverProblem === "too_old"
      ? t(($) => $.settings.integrations.desktopApps.status.tooOld, {
          version: status.driverVersion ?? "",
          minimum: status.minimumVersion,
        })
      : status.driverProblem === "no_app_bundle"
        ? t(($) => $.settings.integrations.desktopApps.status.noAppBundle)
        : t(($) => $.settings.integrations.desktopApps.status.notInstalled);
  return (
    <div className="space-y-2" data-testid="desktop-apps-install">
      <p className="text-xs text-muted-foreground">{problem}</p>
      <h4 className="text-sm font-medium">{t(($) => $.settings.integrations.desktopApps.install.heading)}</h4>
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
