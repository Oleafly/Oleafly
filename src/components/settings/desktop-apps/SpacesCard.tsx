import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BetaBadge } from "@/components/ui/beta-badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { IntegrationCard, IntegrationError } from "@/components/settings/IntegrationCard";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import type { DesktopAppsStatus } from "@/lib/desktop-apps";
import { useCuaSpacesConnectorStore } from "@/store/cua-spaces-connector";
import { runInTerminal } from "./run-in-terminal";

export function SpacesCard({
  status,
  projectId,
}: Readonly<{ status: DesktopAppsStatus; projectId: string | null }>) {
  const { t } = useTranslation(["common", "settings", "errors"]);
  const { connected, options, loading, failed, declined, refresh, connect, update, disconnect } =
    useCuaSpacesConnectorStore();
  const command = status.spacesCliPath;

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <IntegrationCard
      framed
      testId="desktop-apps-spaces"
      title={t(($) => $.settings.integrations.desktopApps.spaces.title)}
      badge={<BetaBadge />}
      description={t(($) => $.settings.integrations.desktopApps.spaces.description)}
    >
      {command ? (
        <div className="mt-3 space-y-2">
          <SettingsToggleRow
            testId="desktop-apps-spaces-connect"
            label={t(($) => $.settings.integrations.desktopApps.spaces.connect.label)}
            description={t(($) => $.settings.integrations.desktopApps.spaces.connect.description)}
            checked={connected}
            disabled={loading}
            onChange={(on) => {
              if (on) void connect(command, options);
              else void disconnect();
            }}
          />
          {connected ? (
            <>
              <SettingsToggleRow
                testId="desktop-apps-spaces-full-access"
                label={t(($) => $.settings.integrations.desktopApps.spaces.fullAccess.label)}
                description={t(($) => $.settings.integrations.desktopApps.spaces.fullAccess.description)}
                checked={options.fullAccess}
                disabled={loading}
                onChange={(fullAccess) => void update(command, { ...options, fullAccess })}
              />
              <SettingsToggleRow
                testId="desktop-apps-spaces-credentials"
                label={t(($) => $.settings.integrations.desktopApps.spaces.credentials.label)}
                description={t(($) => $.settings.integrations.desktopApps.spaces.credentials.description)}
                checked={options.shareCredentials}
                disabled={loading}
                onChange={(shareCredentials) => void update(command, { ...options, shareCredentials })}
              />
            </>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 space-y-2" data-testid="desktop-apps-spaces-install">
          <p className="text-xs text-muted-foreground">
            {t(($) => $.settings.integrations.desktopApps.spaces.notInstalled)}
          </p>
          <CodeBlock code={status.spacesInstallLine} />
          <Button
            type="button"
            size="sm"
            disabled={!projectId}
            onClick={() =>
              void runInTerminal(
                t(($) => $.settings.integrations.desktopApps.spaces.install.terminalTitle),
                status.spacesInstallCommand,
                t(($) => $.settings.integrations.desktopApps.spaces.install.confirm),
              )
            }
          >
            {t(($) => $.settings.integrations.desktopApps.install.run)}
          </Button>
          {projectId ? null : (
            <p className="text-xs text-muted-foreground">
              {t(($) => $.settings.integrations.desktopApps.install.needsProject)}
            </p>
          )}
        </div>
      )}
      {failed ? (
        <IntegrationError>{t(($) => $.settings.integrations.desktopApps.spaces.failed)}</IntegrationError>
      ) : null}
      {declined ? (
        <output className="mt-2 block text-xs text-muted-foreground" data-testid="desktop-apps-spaces-declined">
          {t(($) => $.errors.desktop_apps.change_declined)}
        </output>
      ) : null}
    </IntegrationCard>
  );
}
