import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SectionHeading } from "@/components/ui/section-heading";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { i18n } from "@/i18n";
import {
  acpError, acpHermesSetOption, acpHermesSettings, acpHermesStatus, acpSetHermesSettings, acpTestRemoteHermes,
  type AcpHermesSettings, type AcpHermesStatus, type AcpRemoteHermes,
} from "@/lib/acp";
import { formatList } from "@/lib/intl";
import { cn } from "@/lib/utils";

const EMPTY_REMOTE: AcpRemoteHermes = { host: "", port: null, folder: "", command: "hermes", profile: null };
const HOST = /^[A-Za-z0-9._@-]{1,253}$/;
const COMMAND = /^(hermes|\/[A-Za-z0-9._/~+-]+)$/;
const PROFILE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

type RemoteField = "host" | "port" | "folder" | "command" | "profile";
type RemoteIssue = "required" | "invalid";

/** The same checks Oleafly runs before saving, per field (so mistakes show at once). */
export function remoteIssues(remote: AcpRemoteHermes): Partial<Record<RemoteField, RemoteIssue>> {
  const issues: Partial<Record<RemoteField, RemoteIssue>> = {};
  if (remote.host === "") issues.host = "required";
  else if (!HOST.test(remote.host) || remote.host.startsWith("-")) issues.host = "invalid";
  if (remote.port !== null && (!Number.isInteger(remote.port) || remote.port < 1 || remote.port > 65535)) {
    issues.port = "invalid";
  }
  if (remote.folder === "") issues.folder = "required";
  else if (!remote.folder.startsWith("/") || /[\r\n\0]/.test(remote.folder)) issues.folder = "invalid";
  if (!COMMAND.test(remote.command)) issues.command = "invalid";
  if (remote.profile !== null && remote.profile !== "" && !PROFILE.test(remote.profile)) {
    issues.profile = "invalid";
  }
  return issues;
}

export function remoteProblem(remote: AcpRemoteHermes): boolean {
  return Object.keys(remoteIssues(remote)).length > 0;
}

function sameRemote(saved: AcpRemoteHermes | null | undefined, draft: AcpRemoteHermes): boolean {
  return (
    !!saved &&
    saved.host === draft.host &&
    saved.port === draft.port &&
    saved.folder === draft.folder &&
    saved.command === draft.command &&
    (saved.profile || null) === (draft.profile || null)
  );
}

/** A labelled field with its problem (or hint) underneath, outside the label so the label's name stays short. */
function RemoteInput({
  id,
  label,
  error,
  hint,
  className,
  children,
}: Readonly<{ id: string; label: string; error?: string; hint?: string; className?: string; children: ReactNode }>) {
  const message = error ?? hint;
  return (
    <div className={cn("space-y-1 text-xs", className)}>
      <label htmlFor={id} className="block space-y-1">
        <span>{label}</span>
        {children}
      </label>
      {message ? (
        <p id={`${id}-message`} className={error ? "text-destructive" : "text-muted-foreground"}>
          {message}
        </p>
      ) : null}
    </div>
  );
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
  // What is stored, as opposed to `settings`, which also holds a mode picked but not saved yet.
  const [saved, setSaved] = useState<AcpHermesSettings | null>(null);
  const [status, setStatus] = useState<AcpHermesStatus | null>(null);
  const [remote, setRemote] = useState<AcpRemoteHermes>(EMPTY_REMOTE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<RemoteField>>(new Set());
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
        setSaved(value);
        setRemote(value.remote ?? EMPTY_REMOTE);
        if (value.mode !== "remote") refresh();
      })
      .catch((error_: unknown) => { if (current) setError(acpError(error_)); });
    return () => { current = false; };
  }, [projectId, refresh]);

  const run = (action: () => Promise<AcpHermesStatus>, onStored?: () => void, onFailed?: () => void) => {
    setBusy(true);
    setError(null);
    action()
      .then((next) => {
        setStatus(next);
        onStored?.();
      })
      .catch((error_: unknown) => {
        onFailed?.();
        setError(acpError(error_));
      })
      .finally(() => setBusy(false));
  };

  const chooseMode = (mode: AcpHermesSettings["mode"]) => {
    if (!settings) return;
    const next: AcpHermesSettings = { ...settings, mode, remote: mode === "remote" ? remote : settings.remote };
    if (mode === "remote" && remoteProblem(remote)) {
      setSettings(next);
      return;
    }
    const before = saved ?? settings;
    setSettings(next);
    // A mode that was not saved goes back to the one this project still uses.
    run(() => acpSetHermesSettings(projectId, next), () => setSaved(next), () => setSettings(before));
  };
  const saveRemote = () => {
    if (!settings || remoteProblem(remote)) return;
    const next: AcpHermesSettings = { ...settings, mode: "remote", remote: { ...remote, profile: remote.profile || null } };
    setSettings(next);
    run(() => acpSetHermesSettings(projectId, next), () => setSaved(next));
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
  const issues = remoteIssues(remote);
  const invalidRemote = Object.keys(issues).length > 0;
  const needsId = `${fieldId}-needs`;
  const empty: Record<RemoteField, boolean> = {
    host: remote.host === "",
    port: remote.port === null,
    folder: remote.folder === "",
    command: remote.command === "",
    profile: !remote.profile,
  };
  const touch = (field: RemoteField) => setTouched((current) => new Set(current).add(field));
  // A field the person has not reached yet stays quiet while it is empty; the note under the buttons covers it.
  const errorText = (field: RemoteField): string | undefined => {
    const issue = issues[field];
    if (!issue || (empty[field] && !touched.has(field))) return undefined;
    switch (field) {
      case "host":
        return issue === "required"
          ? t(($) => $.settings.ai.agents.hermes.errors.hostRequired)
          : t(($) => $.settings.ai.agents.hermes.errors.hostInvalid);
      case "port":
        return t(($) => $.settings.ai.agents.hermes.errors.port);
      case "folder":
        return issue === "required"
          ? t(($) => $.settings.ai.agents.hermes.errors.folderRequired)
          : t(($) => $.settings.ai.agents.hermes.errors.folderInvalid);
      case "command":
        return t(($) => $.settings.ai.agents.hermes.errors.command);
      default:
        return t(($) => $.settings.ai.agents.hermes.errors.profile);
    }
  };
  const fieldLabels: Record<RemoteField, string> = {
    host: t(($) => $.settings.ai.agents.hermes.host),
    port: t(($) => $.settings.ai.agents.hermes.port),
    folder: t(($) => $.settings.ai.agents.hermes.folder),
    command: t(($) => $.settings.ai.agents.hermes.command),
    profile: t(($) => $.settings.ai.agents.hermes.remoteProfile),
  };
  // A field's problem, marked for assistive tech and with a red border.
  const fieldProps = (field: RemoteField, options: { mono?: boolean; hinted?: boolean } = {}) => {
    const error = errorText(field);
    return {
      error,
      props: {
        id: `${fieldId}-${field}`,
        onBlur: () => touch(field),
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error || options.hinted ? `${fieldId}-${field}-message` : undefined,
        className: cn("h-7 text-xs", options.mono && "font-mono", error && "border-destructive"),
      },
    };
  };
  const unsaved =
    settings.mode === "remote" && !(saved?.mode === "remote" && sameRemote(saved.remote, remote));
  const stillUsing =
    saved?.mode === "project"
      ? t(($) => $.settings.ai.agents.hermes.project)
      : t(($) => $.settings.ai.agents.hermes.default);
  const host = fieldProps("host");
  const port = fieldProps("port");
  const folder = fieldProps("folder", { mono: true, hinted: true });
  const command = fieldProps("command", { mono: true });
  const profile = fieldProps("profile", { mono: true });
  const modeLabel = (mode: AcpHermesSettings["mode"]): string => {
    if (mode === "default") return t(($) => $.settings.ai.agents.hermes.default);
    if (mode === "project") return t(($) => $.settings.ai.agents.hermes.project);
    return t(($) => $.settings.ai.agents.hermes.remote);
  };
  return (
    <section data-testid="acp-hermes-section" className="space-y-2">
      <SectionHeading as="h4">{t(($) => $.settings.ai.agents.hermes.title)}</SectionHeading>
      <RadioGroup value={settings.mode} onValueChange={(value) => chooseMode(value as AcpHermesSettings["mode"])} className="gap-1.5">
        {(["default", "project", "remote"] as const).map((mode) => (
          <label key={mode} htmlFor={`${fieldId}-${mode}`} className="flex items-center gap-2 text-xs">
            <RadioGroupItem id={`${fieldId}-${mode}`} value={mode} disabled={busy} />
            {modeLabel(mode)}
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
          <RemoteInput id={host.props.id} label={fieldLabels.host} error={host.error}>
            <Input {...host.props} value={remote.host} onChange={(event) => setRemote({ ...remote, host: event.target.value.trim() })} />
          </RemoteInput>
          <RemoteInput id={port.props.id} label={fieldLabels.port} error={port.error}>
            <Input
              {...port.props}
              type="number"
              min={1}
              max={65535}
              value={remote.port ?? ""}
              onChange={(event) => setRemote({ ...remote, port: event.target.value ? Number(event.target.value) : null })}
            />
          </RemoteInput>
          <RemoteInput
            id={folder.props.id}
            label={fieldLabels.folder}
            error={folder.error}
            hint={t(($) => $.settings.ai.agents.hermes.folderHint)}
            className="sm:col-span-2"
          >
            <Input {...folder.props} value={remote.folder} onChange={(event) => setRemote({ ...remote, folder: event.target.value })} />
          </RemoteInput>
          <RemoteInput id={command.props.id} label={fieldLabels.command} error={command.error}>
            <Input {...command.props} value={remote.command} onChange={(event) => setRemote({ ...remote, command: event.target.value.trim() })} />
          </RemoteInput>
          <RemoteInput id={profile.props.id} label={fieldLabels.profile} error={profile.error}>
            <Input {...profile.props} value={remote.profile ?? ""} onChange={(event) => setRemote({ ...remote, profile: event.target.value.trim() || null })} />
          </RemoteInput>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="button" size="sm" variant="outline" disabled={busy || invalidRemote} aria-describedby={invalidRemote ? needsId : undefined} onClick={test}>
              {t(($) => $.settings.ai.agents.hermes.test)}
            </Button>
            <Button type="button" size="sm" disabled={busy || invalidRemote} aria-describedby={invalidRemote ? needsId : undefined} onClick={saveRemote}>
              {t(($) => $.settings.ai.agents.hermes.save)}
            </Button>
            {tested && <span className="text-xs text-muted-foreground">{t(($) => $.settings.ai.agents.hermes.testOk, { version: tested })}</span>}
          </div>
          {invalidRemote && (
            <p id={needsId} className="text-[0.6875rem] text-muted-foreground sm:col-span-2">
              {t(($) => $.settings.ai.agents.hermes.needsValid, {
                fields: formatList((Object.keys(issues) as RemoteField[]).map((field) => fieldLabels[field])),
              })}
            </p>
          )}
          {unsaved && (
            <p className="text-[0.6875rem] text-muted-foreground sm:col-span-2">
              {saved?.mode === "remote"
                ? t(($) => $.settings.ai.agents.hermes.unsavedEdit)
                : t(($) => $.settings.ai.agents.hermes.unsavedMode, { mode: stillUsing })}
            </p>
          )}
          <p className="text-[0.6875rem] text-muted-foreground sm:col-span-2">{t(($) => $.settings.ai.agents.hermes.sshNote)}</p>
        </div>
      )}
      {error && <p role="alert" className="select-text text-xs text-destructive">{error}</p>}
    </section>
  );
}

export default HermesSection;
