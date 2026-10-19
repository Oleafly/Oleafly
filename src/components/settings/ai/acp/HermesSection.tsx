import { useCallback, useEffect, useId, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { i18n } from "@/i18n";
import {
  acpError, acpHermesSetOption, acpHermesSettings, acpHermesStatus, acpSetHermesSettings, acpTestRemoteHermes,
  type AcpHermesSettings, type AcpHermesStatus, type AcpRemoteHermes,
} from "@/lib/acp";

const EMPTY_REMOTE: AcpRemoteHermes = { host: "", port: null, folder: "", command: "hermes", profile: null };
const HOST = /^[A-Za-z0-9._@-]{1,253}$/;
const COMMAND = /^(hermes|\/[A-Za-z0-9._/~+-]+)$/;
const PROFILE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The same checks Oleafly runs before saving (so mistakes show at once). */
export function remoteProblem(remote: AcpRemoteHermes): boolean {
  if (!HOST.test(remote.host) || remote.host.startsWith("-")) return true;
  if (remote.port !== null && (remote.port < 1 || remote.port > 65535)) return true;
  if (!remote.folder.startsWith("/") || /[\r\n\0]/.test(remote.folder)) return true;
  if (!COMMAND.test(remote.command)) return true;
  return remote.profile !== null && remote.profile !== "" && !PROFILE.test(remote.profile);
}

function statusText(status: AcpHermesStatus): string {
  switch (status.gateway) {
    case "ready":
      return i18n.t(($) => $.settings.ai.agents.hermes.status.ready);
    case "starting":
      return i18n.t(($) => $.settings.ai.agents.hermes.status.starting);
    case "stopped":
      return i18n.t(($) => $.settings.ai.agents.hermes.status.stopped);
    default:
      return i18n.t(($) => $.settings.ai.agents.hermes.status.unknown);
  }
}

/** How this project runs Hermes: the shared profile, its own profile, or Hermes on another machine. */
export function HermesSection({ projectId }: Readonly<{ projectId: string }>) {
  const { t } = useTranslation(["common", "settings"]);
  const [settings, setSettings] = useState<AcpHermesSettings | null>(null);
  const [status, setStatus] = useState<AcpHermesStatus | null>(null);
  const [remote, setRemote] = useState<AcpRemoteHermes>(EMPTY_REMOTE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  const fieldId = useId();

  const refresh = useCallback(() => {
    setError(null);
    acpHermesStatus(projectId).then(setStatus).catch((error_: unknown) => setError(acpError(error_)));
  }, [projectId]);

  useEffect(() => {
    let current = true;
    acpHermesSettings(projectId)
      .then((value) => {
        if (!current) return;
        setSettings(value);
        setRemote(value.remote ?? EMPTY_REMOTE);
        if (value.mode !== "remote") refresh();
      })
      .catch((error_: unknown) => { if (current) setError(acpError(error_)); });
    return () => { current = false; };
  }, [projectId, refresh]);

  const run = (action: () => Promise<AcpHermesStatus>) => {
    setBusy(true);
    setError(null);
    action()
      .then((next) => setStatus(next))
      .catch((error_: unknown) => setError(acpError(error_)))
      .finally(() => setBusy(false));
  };

  const chooseMode = (mode: AcpHermesSettings["mode"]) => {
    if (!settings) return;
    const next: AcpHermesSettings = { ...settings, mode, remote: mode === "remote" ? remote : settings.remote };
    if (mode === "remote" && remoteProblem(remote)) {
      setSettings(next);
      return;
    }
    setSettings(next);
    run(() => acpSetHermesSettings(projectId, next));
  };
  const saveRemote = () => {
    if (!settings || remoteProblem(remote)) return;
    const next: AcpHermesSettings = { ...settings, mode: "remote", remote: { ...remote, profile: remote.profile || null } };
    setSettings(next);
    run(() => acpSetHermesSettings(projectId, next));
  };
  const test = () => {
    if (remoteProblem(remote)) return;
    setBusy(true);
    setError(null);
    setTested(null);
    acpTestRemoteHermes(projectId, { ...remote, profile: remote.profile || null })
      .then((version) => setTested(version))
      .catch((error_: unknown) => setError(acpError(error_)))
      .finally(() => setBusy(false));
  };

  if (!settings) return error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null;
  const invalidRemote = remoteProblem(remote);
  return (
    <section data-testid="acp-hermes-section" className="space-y-2">
      <h5 className="text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
        {t(($) => $.settings.ai.agents.hermes.title)}
      </h5>
      <RadioGroup value={settings.mode} onValueChange={(value) => chooseMode(value as AcpHermesSettings["mode"])} className="gap-1.5">
        {(["default", "project", "remote"] as const).map((mode) => (
          <label key={mode} htmlFor={`${fieldId}-${mode}`} className="flex items-center gap-2 text-xs">
            <RadioGroupItem id={`${fieldId}-${mode}`} value={mode} disabled={busy} />
            {mode === "default"
              ? t(($) => $.settings.ai.agents.hermes.default)
              : mode === "project"
                ? t(($) => $.settings.ai.agents.hermes.project)
                : t(($) => $.settings.ai.agents.hermes.remote)}
          </label>
        ))}
      </RadioGroup>
      {settings.mode === "project" && (
        <div className="space-y-1 rounded-md border bg-background/40 p-2">
          {status?.profile && (
            <p className="font-mono text-[0.6875rem] text-muted-foreground">
              {t(($) => $.settings.ai.agents.hermes.profileName, { name: status.profile })}
            </p>
          )}
          <SettingsToggleRow
            label={t(($) => $.settings.ai.agents.hermes.memory)}
            description={t(($) => $.settings.ai.agents.hermes.memoryDescription)}
            checked={status?.memory ?? settings.memory}
            disabled={busy}
            onChange={(value) => run(() => acpHermesSetOption(projectId, "memory", value))}
          />
          <SettingsToggleRow
            label={t(($) => $.settings.ai.agents.hermes.toolGateway)}
            description={t(($) => $.settings.ai.agents.hermes.toolGatewayDescription)}
            checked={status?.toolGateway ?? settings.toolGateway}
            disabled={busy}
            onChange={(value) => run(() => acpHermesSetOption(projectId, "toolGateway", value))}
          />
        </div>
      )}
      {settings.mode !== "remote" && status && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{statusText(status)}{status.reason ? ` (${status.reason})` : ""}</span>
          <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={refresh}>
            <RefreshCw className="size-3" /> {t(($) => $.settings.ai.agents.hermes.refresh)}
          </Button>
        </div>
      )}
      {settings.mode !== "remote" && (
        <p className="text-[0.6875rem] text-muted-foreground">{t(($) => $.settings.ai.agents.hermes.keepsRunning)}</p>
      )}
      {settings.mode === "remote" && (
        <div className="grid gap-2 rounded-md border bg-background/40 p-2 sm:grid-cols-2">
          <label htmlFor={`${fieldId}-host`} className="space-y-1 text-xs">
            <span>{t(($) => $.settings.ai.agents.hermes.host)}</span>
            <Input id={`${fieldId}-host`} value={remote.host} className="h-7 text-xs" onChange={(event) => setRemote({ ...remote, host: event.target.value.trim() })} />
          </label>
          <label htmlFor={`${fieldId}-port`} className="space-y-1 text-xs">
            <span>{t(($) => $.settings.ai.agents.hermes.port)}</span>
            <Input
              id={`${fieldId}-port`}
              type="number"
              min={1}
              max={65535}
              value={remote.port ?? ""}
              className="h-7 text-xs"
              onChange={(event) => setRemote({ ...remote, port: event.target.value ? Number(event.target.value) : null })}
            />
          </label>
          <label htmlFor={`${fieldId}-folder`} className="space-y-1 text-xs sm:col-span-2">
            <span>{t(($) => $.settings.ai.agents.hermes.folder)}</span>
            <Input id={`${fieldId}-folder`} value={remote.folder} className="h-7 font-mono text-xs" onChange={(event) => setRemote({ ...remote, folder: event.target.value })} />
          </label>
          <label htmlFor={`${fieldId}-command`} className="space-y-1 text-xs">
            <span>{t(($) => $.settings.ai.agents.hermes.command)}</span>
            <Input id={`${fieldId}-command`} value={remote.command} className="h-7 font-mono text-xs" onChange={(event) => setRemote({ ...remote, command: event.target.value.trim() })} />
          </label>
          <label htmlFor={`${fieldId}-profile`} className="space-y-1 text-xs">
            <span>{t(($) => $.settings.ai.agents.hermes.remoteProfile)}</span>
            <Input id={`${fieldId}-profile`} value={remote.profile ?? ""} className="h-7 font-mono text-xs" onChange={(event) => setRemote({ ...remote, profile: event.target.value.trim() || null })} />
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="button" size="sm" variant="outline" disabled={busy || invalidRemote} onClick={test}>
              {t(($) => $.settings.ai.agents.hermes.test)}
            </Button>
            <Button type="button" size="sm" disabled={busy || invalidRemote} onClick={saveRemote}>
              {t(($) => $.settings.ai.agents.hermes.save)}
            </Button>
            {tested && <span className="text-xs text-muted-foreground">{t(($) => $.settings.ai.agents.hermes.testOk, { version: tested })}</span>}
          </div>
          <p className="text-[0.6875rem] text-muted-foreground sm:col-span-2">{t(($) => $.settings.ai.agents.hermes.sshNote)}</p>
        </div>
      )}
      {error && <p role="alert" className="select-text text-xs text-destructive">{error}</p>}
    </section>
  );
}

export default HermesSection;
