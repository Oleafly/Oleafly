import { useEffect, useRef, useState } from "react";
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
  const ghStatus = useGithubStore((s) => s.status);
  const ghUser = useGithubStore((s) => s.user);
  const ghLoading = useGithubStore((s) => s.loading);
  const connectWithToken = useGithubStore((s) => s.connectWithToken);
  const disconnect = useGithubStore((s) => s.disconnect);
  const refresh = useGithubStore((s) => s.refresh);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [config, setConfigState] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
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
        setConfigError("Couldn't load Git settings.");
      });
    return () => {
      configRequest.current += 1;
    };
  }, []);

  const writeGitAutoInit = (value: boolean) => {
    if (!config) return;
    setConfigState({ ...config, git_auto_init: value });
    setConfigError(null);
    configWrites.current = configWrites.current
      .then(() => getConfig())
      .then((latest) => setConfig({ ...latest, git_auto_init: value }))
      .catch(() => setConfigError("Couldn't save Git settings."));
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

  const note = (ok: boolean, text: string) => setMsg({ ok, text });

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

      // Poll loop runs in JS: cancellable, and each Rust call is async + short
      // so it never freezes the webview.
      let wait = Math.max(dc.interval, 5) * 1000;
      const deadline = Date.now() + 16 * 60 * 1000;
      let token: string | null = null;
      while (Date.now() < deadline && !cancelled()) {
        await sleep(wait);
        if (cancelled()) return;
        const res = await checkDeviceToken(GITHUB_OAUTH_CLIENT_ID, dc.device_code);
        if (cancelled()) return;
        if (res.status === "token") {
          token = res.token;
          break;
        }
        if (res.status === "slow_down") wait = res.interval * 1000;
      }
      if (cancelled()) return;

      if (!token) {
        setFlowError("GitHub sign-in timed out. Try again.");
        setFlow(null);
        return;
      }
      await connectWithToken(token);
      if (cancelled()) return;
      setFlow(null);
      note(true, `Connected as @${useGithubStore.getState().user?.login ?? "GitHub"}`);
    } catch (e) {
      if (cancelled()) return;
      setFlowError(String(e));
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
      note(true, `Connected as @${useGithubStore.getState().user?.login ?? "GitHub"}`);
    } catch (e) {
      setFlowError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const doDisconnect = async () => {
    await disconnect();
    note(true, "Disconnected.");
  };

  return (
    <div className="space-y-2 text-sm">
      <div>
        <h3 className="text-sm font-medium">GitHub</h3>
        <p className="text-xs text-muted-foreground">
          Back up projects, sync across devices, and push/pull from the Git panel.
        </p>
      </div>
      <div className="space-y-2" data-testid="git-auto-init">
        <SettingsToggleRow
          label="Initialise Git for every project"
          description="New and opened projects get a Git repository so the Git panel can track changes. Oleafly never commits on its own."
          checked={gitAutoInitEnabled(config)}
          onChange={writeGitAutoInit}
        />
        {configError ? (
          <p className="text-xs text-destructive" role="alert">
            {configError}
          </p>
        ) : null}
      </div>
      {connected ? (
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
              @{ghUser?.login ?? "GitHub"}
            </div>
            <div className="text-xs text-muted-foreground">
              {ghUser?.name ? ghUser.name : "Connected"}
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={ghLoading}
            onClick={() => void doDisconnect()}
            className="hover:bg-destructive/10 hover:text-destructive"
          >
            Disconnect
          </Button>
        </div>
      ) : flow ? (
        <div className="space-y-3 rounded-lg border bg-background p-4">
          <div>
            <div className="text-sm font-semibold">Enter this code on GitHub</div>
            <div className="text-xs text-muted-foreground">
              We opened{" "}
              <button type="button"
                onClick={() => void open(flow.verification_uri)}
                className="font-medium text-primary hover:underline dark:text-primary"
              >
                {flow.verification_uri}
              </button>{" "}
              in your browser. Paste the code there to authorize Oleafly.
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
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void open(flow.verification_uri)}>
              Open GitHub
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelFlow}>
              Cancel
            </Button>
            <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Waiting for authorization…
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
            Connect GitHub
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
            Advanced: use a personal access token
          </button>
          {showAdvanced && (
            <div className="flex gap-2 pt-1">
              <Input
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder="ghp_…"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                size="sm"
                disabled={busy || !pat.trim()}
                onClick={() => void connectPat()}
              >
                Connect
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {GITHUB_OAUTH_CLIENT_ID
              ? "Signs you in with a one-time code in your browser."
              : "OAuth sign-in isn't configured in this build yet - paste a token instead."}
          </p>
        </>
      )}

      {msg && (
        <div
          className={
            msg.ok
              ? "rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-600 dark:text-emerald-400"
              : "rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive"
          }
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
