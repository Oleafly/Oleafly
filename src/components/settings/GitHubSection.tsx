import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Github,
  Loader2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useGithubStore } from "@/store/github";
import {
  gitCurrentBranch,
  gitGetRemote,
  gitPull,
  gitPush,
  gitRemoveRemote,
  gitSetRemote,
} from "@/lib/tauri";
import {
  GITHUB_OAUTH_CLIENT_ID,
  checkDeviceToken,
  githubCreateRepo,
  requestDeviceCode,
  type DeviceCode,
} from "@/lib/github";
import { cn } from "@/lib/utils";

export function GitHubSection({
  projectId,
  projectName,
  onRemoteChanged,
}: {
  projectId: string | null;
  projectName: string;
  onRemoteChanged: () => void;
}) {
  const ghStatus = useGithubStore((s) => s.status);
  const ghUser = useGithubStore((s) => s.user);
  const ghLoading = useGithubStore((s) => s.loading);
  const connectWithToken = useGithubStore((s) => s.connectWithToken);
  const disconnect = useGithubStore((s) => s.disconnect);
  const refresh = useGithubStore((s) => s.refresh);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [flow, setFlow] = useState<DeviceCode | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pat, setPat] = useState("");

  const [remote, setRemote] = useState("");
  const [branch, setBranch] = useState("");
  const [repoName, setRepoName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);

  const connected = ghStatus === "connected";

  useEffect(() => {
    if (ghStatus === "unknown") void refresh();
  }, [ghStatus, refresh]);

  useEffect(() => {
    if (!projectId) return;
    void gitGetRemote(projectId).then((r) => setRemote(r ?? ""));
    void gitCurrentBranch(projectId).then(setBranch).catch(() => setBranch(""));
  }, [projectId]);

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
    void navigator.clipboard?.writeText(code).catch(() => {});
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

  const saveRemote = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      await gitSetRemote(projectId, remote.trim());
      onRemoteChanged();
      note(true, "Remote saved.");
    } catch (e) {
      note(false, String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      await gitRemoveRemote(projectId);
      setRemote("");
      onRemoteChanged();
      note(true, "Unlinked from GitHub.");
    } catch (e) {
      note(false, String(e));
    } finally {
      setBusy(false);
    }
  };

  const createRepo = async () => {
    if (!connected) return note(false, "Connect GitHub first.");
    const name = (repoName.trim() || projectName || projectId || "oleafly-project")
      .toLowerCase()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    setBusy(true);
    try {
      const repo = await githubCreateRepo(name, isPrivate);
      if (projectId) {
        // Set a CLEAN remote (no embedded token). Auth is supplied at push/pull
        // time by the Rust env-backed credential helper, so the token never
        // touches .git/config on disk.
        await gitSetRemote(projectId, repo.clone_url);
        setRemote(repo.clone_url);
        onRemoteChanged();
      }
      note(true, `Created ${repo.full_name} and linked it.`);
    } catch (e) {
      note(false, String(e));
    } finally {
      setBusy(false);
    }
  };

  const push = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      note(true, await gitPush(projectId));
    } catch (e) {
      note(false, String(e));
    } finally {
      setBusy(false);
    }
  };

  const pull = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      note(true, await gitPull(projectId));
      onRemoteChanged();
    } catch (e) {
      note(false, String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-2">
        <div className="font-medium">GitHub account</div>
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
                Copy
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
      </div>

      <hr className="border-border" />

      <div className="space-y-2">
        <div className="font-medium">
          Repository {projectId ? `· ${projectId}` : ""}
          {branch && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              {branch}
            </span>
          )}
        </div>
        {projectId ? (
          <>
            <div className="flex gap-2">
              <Input
                value={remote}
                onChange={(e) => setRemote(e.target.value)}
                placeholder="https://github.com/you/repo.git"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void saveRemote()}>
                Save
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy || !remote || !connected} onClick={() => void push()}>
                <Github className="size-3.5" /> Push
              </Button>
              <Button size="sm" variant="secondary" disabled={busy || !remote} onClick={() => void pull()}>
                Pull
              </Button>
              {remote && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void unlink()}>
                  Unlink
                </Button>
              )}
            </div>

            <div className="pt-2 text-xs text-muted-foreground">
              No repo yet? Create one and link it:
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                placeholder={projectName || "repo-name"}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <label htmlFor="github-private-repository" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  id="github-private-repository"
                  checked={isPrivate}
                  onCheckedChange={(checked) => setIsPrivate(checked === true)}
                />
                Private
              </label>
              <Button
                size="sm"
                disabled={busy || !connected}
                onClick={() => void createRepo()}
              >
                Create &amp; link
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Open a project to configure its remote and push.
          </p>
        )}
      </div>

      {msg && (
        <div
          className={cn(
            "rounded-md border p-2.5 text-xs",
            msg.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          )}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
