import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Check, Copy, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsPathText } from "@/components/settings/SettingsPath";
import { describeError } from "@/lib/app-error";
import {
  installShellCommand,
  isShellCommandStatus,
  removeShellCommand,
  shellCommandStatus,
  type ShellCommandPathHint,
  type ShellCommandState,
  type ShellCommandStatus,
} from "@/lib/shell-command";

type Busy = "install" | "remove" | null;

type Change = Exclude<Busy, null>;

const FOCUS_TINT = "focus-visible:bg-accent focus-visible:text-accent-foreground";

interface RowView {
  state: ShellCommandState | undefined;
  path: string;
  directory: string;
  installed: boolean;
  installable: boolean;
  afterSignIn: boolean;
  hint: ShellCommandPathHint | null | undefined;
}

function describeStatus(status: ShellCommandStatus | null): RowView {
  const state = status?.state;
  const installed = state === "installed" || state === "outdated";
  const afterSignIn = installed && status?.after_sign_in === true;
  return {
    state,
    path: status?.path ?? "",
    directory: status?.directory ?? "",
    installed,
    installable: state === "not_installed" || state === "outdated",
    afterSignIn,
    hint: installed && status?.on_path === false && !afterSignIn ? status.hint : null,
  };
}

function StateSummary({
  state,
  path,
  directory,
  loadFailed,
}: Readonly<{
  state: ShellCommandState | undefined;
  path: string;
  directory: string;
  loadFailed: boolean;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  let summary: string | null = null;
  switch (state) {
    case "not_installed":
      summary = t(($) => $.settings.shellCommand.state.notInstalled, { directory });
      break;
    case "installed":
      summary = t(($) => $.settings.shellCommand.state.installed, { path });
      break;
    case "outdated":
      summary = t(($) => $.settings.shellCommand.state.outdated, { path });
      break;
    case "occupied":
      summary = t(($) => $.settings.shellCommand.state.occupied, { path });
      break;
    case "packaged":
      summary = t(($) => $.settings.shellCommand.state.packaged, { path });
      break;
    case "unavailable":
      summary = t(($) => $.settings.shellCommand.state.unavailable);
      break;
    case "move_app":
      summary = t(($) => $.settings.shellCommand.state.moveApp);
      break;
    default:
      if (!loadFailed) summary = t(($) => $.settings.shellCommand.checking);
  }
  if (!summary) return null;
  return (
    <p data-testid="shell-command-state" className="mt-1 break-words text-xs text-muted-foreground">
      <SettingsPathText text={summary} />
    </p>
  );
}

function ShellCommandActions({
  state,
  installable,
  installed,
  busy,
  installRef,
  removeRef,
  onChange,
}: Readonly<{
  state: ShellCommandState | undefined;
  installable: boolean;
  installed: boolean;
  busy: Busy;
  installRef: RefObject<HTMLButtonElement | null>;
  removeRef: RefObject<HTMLButtonElement | null>;
  onChange: (kind: Change) => void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  if (!installable && !installed) return null;

  let installLabel = t(($) => $.settings.shellCommand.install);
  if (busy === "install") {
    installLabel = t(($) => $.settings.shellCommand.installing);
  } else if (state === "outdated") {
    installLabel = t(($) => $.settings.shellCommand.update);
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {installable ? (
        <Button
          ref={installRef}
          type="button"
          variant="outline"
          size="sm"
          className={FOCUS_TINT}
          disabled={busy !== null}
          onClick={() => onChange("install")}
        >
          {installLabel}
        </Button>
      ) : null}
      {installed ? (
        <Button
          ref={removeRef}
          type="button"
          variant="ghost"
          size="sm"
          className={FOCUS_TINT}
          disabled={busy !== null}
          onClick={() => onChange("remove")}
        >
          {busy === "remove"
            ? t(($) => $.settings.shellCommand.removing)
            : t(($) => $.common.actions.remove)}
        </Button>
      ) : null}
    </div>
  );
}

function PathHint({
  hint,
  directory,
  copied,
  onCopy,
}: Readonly<{
  hint: ShellCommandPathHint;
  directory: string;
  copied: boolean;
  onCopy: (line: string) => void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  return (
    <div
      data-testid="shell-command-hint"
      className="ml-7 mt-3 space-y-2 rounded-md border bg-muted/30 p-2.5"
    >
      <p className="break-words text-xs text-muted-foreground">
        <SettingsPathText
          text={
            hint.file
              ? t(($) => $.settings.shellCommand.notOnPath.file, { directory, file: hint.file })
              : t(($) => $.settings.shellCommand.notOnPath.run, { directory })
          }
        />
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded border bg-background px-2 py-1 font-mono text-[11px]">
          <SettingsPathText text={hint.line} />
        </code>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className={FOCUS_TINT}
          onClick={() => onCopy(hint.line)}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? t(($) => $.common.actions.copied) : t(($) => $.common.actions.copy)}
        </Button>
        <span data-testid="shell-command-copied" aria-live="polite" className="sr-only">
          {copied ? t(($) => $.common.actions.copied) : ""}
        </span>
      </div>
    </div>
  );
}

function ShellCommandMessages({
  result,
  error,
  loadFailed,
  onRetry,
}: Readonly<{
  result: string | null;
  error: string | null;
  loadFailed: boolean;
  onRetry: () => void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  return (
    <>
      {result ? (
        <output aria-live="polite" className="ml-7 mt-2 block break-words text-xs text-foreground">
          <SettingsPathText text={result} />
        </output>
      ) : null}
      {error ? (
        <p role="alert" className="ml-7 mt-2 break-words text-xs text-destructive">
          <SettingsPathText text={error} />
        </p>
      ) : null}
      {loadFailed ? (
        <div className="ml-7 mt-2 flex items-center gap-2">
          <p role="alert" className="text-xs text-destructive">
            {t(($) => $.settings.shellCommand.loadFailed)}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={FOCUS_TINT}
            onClick={onRetry}
          >
            {t(($) => $.common.actions.retry)}
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function ShellCommandRow() {
  const { t } = useTranslation(["common", "settings"]);
  const [status, setStatus] = useState<ShellCommandStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [focusNext, setFocusNext] = useState<Change | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const installButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const request = useRef(0);
  const alive = useRef(true);
  const copiedTimer = useRef<number | null>(null);

  const refresh = useCallback(() => {
    const current = ++request.current;
    setLoadFailed(false);
    void Promise.resolve()
      .then(() => shellCommandStatus())
      .then((next) => {
        if (current !== request.current) return;
        if (isShellCommandStatus(next)) {
          setStatus(next);
        } else {
          setLoadFailed(true);
        }
      })
      .catch(() => {
        if (current === request.current) setLoadFailed(true);
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    return () => {
      alive.current = false;
      request.current += 1;
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, [refresh]);

  useEffect(() => {
    if (focusNext === null) return;
    setFocusNext(null);
    const active = document.activeElement;
    if (active && active !== document.body && !row.current?.contains(active)) return;
    const target = focusNext === "install" ? installButton.current : removeButton.current;
    target?.focus();
  }, [focusNext]);

  const change = async (kind: Change) => {
    const previousPath = status?.path ?? "";
    request.current += 1;
    setBusy(kind);
    setError(null);
    setResult(null);
    try {
      const outcome = kind === "install" ? await installShellCommand() : await removeShellCommand();
      if (!alive.current) return;
      setStatus(outcome.status);
      setLoadFailed(false);
      setFocusNext(kind === "install" ? "remove" : "install");
      const path = outcome.status.path ?? previousPath;
      if (outcome.action === "linked") {
        setResult(t(($) => $.settings.shellCommand.result.linked, { path }));
      } else if (outcome.action === "copied") {
        setResult(t(($) => $.settings.shellCommand.result.copied, { path }));
      } else {
        setResult(t(($) => $.settings.shellCommand.result.removed, { path: previousPath }));
      }
    } catch (error_) {
      if (!alive.current) return;
      setError(describeError(error_));
      refresh();
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const copyLine = async (line: string) => {
    try {
      await navigator.clipboard.writeText(line);
      if (!alive.current) return;
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  if (status?.state === "unsupported") return null;

  const view = describeStatus(status);

  return (
    <div ref={row} data-testid="shell-command-row" className="rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <SquareTerminal aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium">{t(($) => $.settings.shellCommand.title)}</div>
            <div className="text-xs text-muted-foreground">
              <Trans
                ns="settings"
                i18nKey={($) => $.settings.shellCommand.description}
                components={{ code: <code className="rounded bg-muted px-1 font-mono text-[11px]" /> }}
              />
            </div>
            <StateSummary
              state={view.state}
              path={view.path}
              directory={view.directory}
              loadFailed={loadFailed}
            />
          </div>
        </div>
        <ShellCommandActions
          state={view.state}
          installable={view.installable}
          installed={view.installed}
          busy={busy}
          installRef={installButton}
          removeRef={removeButton}
          onChange={(kind) => void change(kind)}
        />
      </div>
      {view.afterSignIn ? (
        <p
          data-testid="shell-command-sign-in"
          className="ml-7 mt-3 break-words rounded-md border bg-muted/30 p-2.5 text-xs text-muted-foreground"
        >
          <SettingsPathText
            text={t(($) => $.settings.shellCommand.afterSignIn, { directory: view.directory })}
          />
        </p>
      ) : null}
      {view.hint ? (
        <PathHint
          hint={view.hint}
          directory={view.directory}
          copied={copied}
          onCopy={(line) => void copyLine(line)}
        />
      ) : null}
      <ShellCommandMessages
        result={result}
        error={error}
        loadFailed={loadFailed}
        onRetry={refresh}
      />
    </div>
  );
}
