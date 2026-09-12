import { describeError } from "@/lib/app-error";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronRight, Copy, Github, Loader2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { gitAutoInitEnabled } from "@/components/settings/gitAutoInit";
import { getConfig, setConfig, type AppConfig } from "@/lib/tauri";
import { useGithubStore } from "@/store/github";
import {
  GITHUB_OAUTH_CLIENT_ID,
  checkDeviceToken,
  requestDeviceCode,
  type DeviceCode,
} from "@/lib/github";

export function GitHubSection() {
  const { t } = useTranslation(["common", "settings"]);
  const ghStatus = useGithubStore((s) => s.status);
  const ghUser = useGithubStore((s) => s.user);
  const ghLoading = useGithubStore((s) => s.loading);
  const connectWithToken = useGithubStore((s) => s.connectWithToken);
  const disconnect = useGithubStore((s) => s.disconnect);
  const refresh = useGithubStore((s) => s.refresh);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<
    { ok: boolean; kind: "connected"; login: string } | { ok: boolean; kind: "disconnected" } | null
  >(null);

  const [configState, setConfigState] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<"load" | "save" | null>(null);
  const configRequest = useRef(0);
  const configWrites = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const request = ++configRequest.current;
    void getConfig()
      .then((next) => {
        if (request !== configRequest.current) return;
        setConfigState(next);
        setConfigError(null);
      })
      .catch(() => {
        if (request !== configRequest.current) return;
        setConfigError("load");
      });
    return () => {
      configRequest.current += 1;
    };
  }, []);

  const writeGitAutoInit = (value: boolean) => {
    if (!configState) return;
    setConfigState({ ...configState, git_auto_init: value });
    setConfigError(null);
    configWrites.current = configWrites.current
      .then(() => getConfig())
      .then((latest) => setConfig({ ...latest, git_auto_init: value }))
      .catch(() => setConfigError("save"));
  };

  const [flow, setFlow] = useState<DeviceCode | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pat, setPat] = useState("");

  const connected = ghStatus === "connected";

  useEffect(() => {
    if (ghStatus === "unknown") void refresh();
  }, [ghStatus, refresh]);

  const noteConnected = () =>
    setMsg({
      ok: true,
      kind: "connected",
      login: useGithubStore.getState().user?.login ?? "GitHub",
    });

  // Bumping this invalidates any in-flight poll, letting the user cancel a
  // running device flow and guarding against cancel→reconnect races.
  const flowGenRef = useRef(0);

  // Also bump on unmount (e.g. Settings closed mid-flow) so the poll loop's
  // `cancelled()` trips and it stops calling setState.
  useEffect(() => {
    return () => {
      flowGenRef.current++;
    };
  }, []);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Poll loop runs in JS: cancellable, and each Rust call is async + short
  // so it never freezes the webview.
  const pollDeviceToken = async (
    dc: Awaited<ReturnType<typeof requestDeviceCode>>,
    cancelled: () => boolean,
  ): Promise<string | null> => {
    let wait = Math.max(dc.interval, 5) * 1000;
    const deadline = Date.now() + 16 * 60 * 1000;
    while (Date.now() < deadline && !cancelled()) {
      await sleep(wait);
      if (cancelled()) return null;
      const res = await checkDeviceToken(GITHUB_OAUTH_CLIENT_ID, dc.device_code);
      if (cancelled()) return null;
      if (res.status === "token") return res.token;
      if (res.status === "slow_down") wait = res.interval * 1000;
    }
    return null;
  };

  const connectDeviceFlow = async () => {
    if (!GITHUB_OAUTH_CLIENT_ID) {
      // No OAuth app configured yet - direct the user to the PAT route.
      setShowAdvanced(true);
      return;
    }
    const gen = ++flowGenRef.current;
    const cancelled = () => flowGenRef.current !== gen;
    setFlowError(null);
    setBusy(true);
    setFlow(null);
    try {
      const dc = await requestDeviceCode(GITHUB_OAUTH_CLIENT_ID);
      if (cancelled()) return;
      setFlow(dc);
      void open(dc.verification_uri);

      const token = await pollDeviceToken(dc, cancelled);
      if (cancelled()) return;

      if (!token) {
        setFlowError(t(($) => $.settings.github.device.timedOut));
        setFlow(null);
        return;
      }
      await connectWithToken(token);
      if (cancelled()) return;
      setFlow(null);
      noteConnected();
    } catch (e) {
      if (cancelled()) return;
      setFlowError(describeError(e));
      setFlow(null);
    } finally {
      if (!cancelled()) setBusy(false);
    }
  };

  const cancelFlow = () => {
    flowGenRef.current++;
    setFlow(null);
    setFlowError(null);
    setBusy(false);
  };

  const copyCode = (code: string) => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const connectPat = async () => {
    if (!pat.trim()) return;
    setBusy(true);
    setFlowError(null);
    try {
      await connectWithToken(pat.trim());
      setPat("");
      setShowAdvanced(false);
      noteConnected();
    } catch (e) {
      setFlowError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const doDisconnect = async () => {
    await disconnect();
    setMsg({ ok: true, kind: "disconnected" });
  };

  return (
    <div className="space-y-2 text-sm">
      <div>
        <h3 className="text-sm font-medium">GitHub</h3>
        <p className="text-xs text-muted-foreground">
          {t(($) => $.settings.github.description)}
        </p>
      </div>
      <div className="space-y-2" data-testid="git-auto-init">
        <SettingsToggleRow
          label={t(($) => $.settings.github.autoInit.label)}
          description={t(($) => $.settings.github.autoInit.description)}
          checked={gitAutoInitEnabled(configState)}
          onChange={writeGitAutoInit}
        />
        {configError ? (
          <p className="text-xs text-destructive" role="alert">
            {configError === "load"
              ? t(($) => $.settings.github.config.loadFailed)
              : t(($) => $.settings.github.config.saveFailed)}
          </p>
        ) : null}
      </div>
      {connected && (
        <div className="flex items-center gap-3 rounded-lg border bg-background p-3">
          {ghUser?.avatar_url ? (
            <img
              src={ghUser.avatar_url}
              alt=""
              className="size-8 rounded-full object-cover"
            />
          ) : (
            <span className="flex size-8 items-center justify-center rounded-full bg-foreground text-background">
              <Github className="size-4" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {t(($) => $.settings.github.account.handle, {
                login: ghUser?.login ?? "GitHub",
              })}
            </div>
            <div className="text-xs text-muted-foreground">
              {ghUser?.name ? ghUser.name : t(($) => $.settings.github.account.connected)}
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={ghLoading}
            onClick={() => void doDisconnect()}
            className="hover:bg-destructive/10 hover:text-destructive"
          >
            {t(($) => $.settings.github.account.disconnect)}
          </Button>
        </div>
      )}
      {!connected && (flow ? (
        <div className="space-y-3 rounded-lg border bg-background p-4">
          <div>
            <div className="text-sm font-semibold">
              {t(($) => $.settings.github.device.title)}
            </div>
            <div className="text-xs text-muted-foreground">
              <Trans
                ns="settings"
                i18nKey={($) => $.settings.github.device.opened}
                values={{ url: flow.verification_uri }}
                components={{
                  verificationLink: (
                    <button type="button"
                      onClick={() => void open(flow.verification_uri)}
                      className="font-medium text-primary hover:underline dark:text-primary"
                    />
                  ),
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 rounded-md border bg-muted/40 py-4">
            <code className="select-all font-mono text-2xl font-semibold tracking-[0.25em]">
              {flow.user_code}
            </code>
            <Button
              size="sm"
              variant="ghost"
              className="ml-1"
              onClick={() => copyCode(flow.user_code)}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? t(($) => $.common.actions.copied) : t(($) => $.common.actions.copy)}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void open(flow.verification_uri)}>
              {t(($) => $.settings.github.device.openGithub)}
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelFlow}>
              {t(($) => $.common.actions.cancel)}
            </Button>
            <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t(($) => $.settings.github.device.waiting)}
            </span>
          </div>
        </div>
      ) : (
        <>
          <Button
            disabled={busy || ghLoading}
            onClick={() => void connectDeviceFlow()}
          >
            {busy || ghLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Github className="size-4" />
            )}
            {t(($) => $.settings.github.connect)}
          </Button>
          {flowError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
              {flowError}
            </div>
          )}
          <button type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1 pt-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showAdvanced ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            {t(($) => $.settings.github.advanced.toggle)}
          </button>
          {showAdvanced && (
            <div className="flex gap-2 pt-1">
              <Input
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder={t(($) => $.settings.github.advanced.tokenPlaceholder)}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                size="sm"
                disabled={busy || !pat.trim()}
                onClick={() => void connectPat()}
              >
                {t(($) => $.settings.github.advanced.connect)}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {GITHUB_OAUTH_CLIENT_ID
              ? t(($) => $.settings.github.hint.oauth)
              : t(($) => $.settings.github.hint.token)}
          </p>
        </>
      ))}

      {msg && (
        <div
          className={
            msg.ok
              ? "rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-600 dark:text-emerald-400"
              : "rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive"
          }
        >
          {msg.kind === "connected"
            ? t(($) => $.settings.github.notice.connected, { login: msg.login })
            : t(($) => $.settings.github.notice.disconnected)}
        </div>
      )}
    </div>
  );
}
