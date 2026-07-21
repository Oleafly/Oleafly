import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip } from "@/components/ui/tooltip";
import {
  getConfig,
  mcpConnectionInfo,
  mcpRegenerateToken,
  mcpRestartServer,
  mcpSetEnabled,
  mcpStatus,
  setConfig,
  type AppConfig,
  type McpStatus,
} from "@/lib/tauri";
import { refreshMcpRegistry } from "@/lib/mcp-bridge";
import { useMcpActivityStore } from "@/store/mcp-activity";
import { cn } from "@/lib/utils";

function CopyBtn({ text, testId }: { text: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      data-testid={testId}
      disabled={!text}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

type SnippetLang = "json" | "shell" | "toml";

// Avoids pulling in a full syntax-highlighter dependency for these small snippets.
function highlightSnippet(source: string, lang: SnippetLang): ReactNode[] {
  const out: ReactNode[] = [];
  let key = 0;
  const push = (cls: string | null, text: string) => {
    if (!text) return;
    out.push(
      cls ? (
        <span key={key++} className={cls}>
          {text}
        </span>
      ) : (
        <span key={key++}>{text}</span>
      ),
    );
  };

  if (lang === "json") {
    // Keys, strings, numbers, booleans/null, punctuation.
    const re =
      /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?)\b|(\b(?:true|false|null)\b)|([{}[\],:])|(\s+)|([^\s"{}[\],:]+)/g;
    for (const m of source.matchAll(re)) {
      if (m[1] !== undefined) {
        if (m[2] !== undefined) {
          push("text-sky-700 dark:text-sky-300", m[1]);
          push("text-muted-foreground", m[2]);
        } else {
          push("text-emerald-700 dark:text-emerald-400", m[1]);
        }
      } else if (m[3] !== undefined) {
        push("text-amber-700 dark:text-amber-400", m[3]);
      } else if (m[4] !== undefined) {
        push("text-violet-700 dark:text-violet-400", m[4]);
      } else if (m[5] !== undefined) {
        push("text-muted-foreground", m[5]);
      } else if (m[6] !== undefined) {
        push(null, m[6]);
      } else if (m[7] !== undefined) {
        push(null, m[7]);
      }
    }
    return out;
  }

  if (lang === "toml") {
    const re =
      /(\[[^\]]+\])|([A-Za-z_][\w.]*)(\s*=\s*)|("(?:\\.|[^"\\])*")|([{}=,])|(\s+)|([^\s[\]"={}]+)/g;
    for (const m of source.matchAll(re)) {
      if (m[1] !== undefined) {
        push("text-sky-700 dark:text-sky-300", m[1]);
      } else if (m[2] !== undefined) {
        push("text-sky-700 dark:text-sky-300", m[2]);
        push("text-muted-foreground", m[3] ?? "");
      } else if (m[4] !== undefined) {
        push("text-emerald-700 dark:text-emerald-400", m[4]);
      } else if (m[5] !== undefined) {
        push("text-muted-foreground", m[5]);
      } else if (m[6] !== undefined) {
        push(null, m[6]);
      } else if (m[7] !== undefined) {
        push(null, m[7]);
      }
    }
    return out;
  }

  // shell: flag, quoted string, bare token
  const re = /("(?:\\.|[^"\\])*")|(--?[\w-]+)|(\s+)|([^\s"]+)/g;
  let first = true;
  for (const m of source.matchAll(re)) {
    if (m[1] !== undefined) {
      push("text-emerald-700 dark:text-emerald-400", m[1]);
    } else if (m[2] !== undefined) {
      push("text-violet-700 dark:text-violet-400", m[2]);
    } else if (m[3] !== undefined) {
      push(null, m[3]);
    } else if (m[4] !== undefined) {
      push(first ? "text-sky-700 dark:text-sky-300 font-medium" : null, m[4]);
      first = false;
    }
  }
  return out;
}

function FileName({ children }: { children: string }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] font-normal text-foreground">
      {children}
    </code>
  );
}

function Snippet({
  title,
  body,
  copyText,
  lang,
}: {
  title: ReactNode;
  // Displayed (may be masked).
  body: string;
  // Pasted on Copy (always the real snippet when the token is known).
  copyText: string;
  lang: SnippetLang;
}) {
  const highlighted = useMemo(() => highlightSnippet(body, lang), [body, lang]);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <CopyBtn text={copyText} />
      </div>
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
        <code>{highlighted}</code>
      </pre>
    </div>
  );
}

function buildSnippets(url: string, bearer: string) {
  const claudeCode = `claude mcp add --transport http oleafly ${url} --header "Authorization: Bearer ${bearer}"`;
  const claudeDesktop = JSON.stringify(
    {
      mcpServers: {
        oleafly: {
          command: "npx",
          args: [
            "-y",
            "mcp-remote@latest",
            url,
            "--header",
            `Authorization: Bearer ${bearer}`,
            "--transport",
            "http-only",
          ],
        },
      },
    },
    null,
    2,
  );
  const cursor = JSON.stringify(
    {
      mcpServers: {
        oleafly: {
          url,
          headers: { Authorization: `Bearer ${bearer}` },
        },
      },
    },
    null,
    2,
  );
  const grok = `[mcp_servers.oleafly]\nurl = "${url}"\nheaders = { Authorization = "Bearer ${bearer}" }`;
  return { claudeCode, claudeDesktop, cursor, grok };
}

export function McpSection() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [restartConfirmation, setRestartConfirmation] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const loadToken = useCallback(async (running: boolean) => {
    if (!running) {
      setToken(null);
      setRevealed(false);
      return;
    }
    try {
      const info = await mcpConnectionInfo();
      setToken(info.token);
    } catch {
      setToken(null);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([getConfig(), mcpStatus()]);
      setCfg(c);
      setStatus(s);
      useMcpActivityStore.getState().setServerRunning(!!s.running);
      await loadToken(!!s.running);
    } catch (e) {
      setError(String(e));
    }
  }, [loadToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const persistPolicy = async (patch: Partial<AppConfig>) => {
    if (!cfg) return;
    setError(null);
    const next = { ...cfg, ...patch };
    try {
      await setConfig(next);
      setCfg(next);
      await refreshMcpRegistry();
    } catch (e) {
      setError(String(e));
    }
  };

  const toggleEnabled = async (next: boolean) => {
    if (!cfg || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setRevealed(false);
    setRestartConfirmation(null);
    try {
      const s = await mcpSetEnabled(next);
      setStatus(s);
      setCfg({
        ...cfg,
        mcp_enabled: next,
        mcp_port: s.port ?? cfg.mcp_port,
      });
      useMcpActivityStore.getState().setServerRunning(!!s.running);
      if (next) {
        await refreshMcpRegistry();
        await loadToken(true);
      } else {
        setToken(null);
      }
    } catch (e) {
      setError(String(e));
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const restartServer = async () => {
    if (!cfg || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setRevealed(false);
    try {
      const s = await mcpRestartServer();
      setStatus(s);
      setCfg({
        ...cfg,
        mcp_enabled: true,
        mcp_port: s.port ?? cfg.mcp_port,
      });
      useMcpActivityStore.getState().setServerRunning(!!s.running);
      setRestartConfirmation(s.url);
      await refreshMcpRegistry();
      await loadToken(true);
    } catch (e) {
      setError(String(e));
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const revealToken = async () => {
    setError(null);
    if (!status?.running) {
      setError("Enable the server to view the token.");
      return;
    }
    if (!token) {
      try {
        const info = await mcpConnectionInfo();
        setToken(info.token);
      } catch (e) {
        setError(String(e));
        return;
      }
    }
    setRevealed(true);
  };

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      await mcpRegenerateToken();
      setConfirmRegen(false);
      if (status?.running) {
        const info = await mcpConnectionInfo();
        setToken(info.token);
        // Keep current reveal state: if they were looking at it, show the new one.
      } else {
        setToken(null);
        setRevealed(false);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const enabled = !!(cfg?.mcp_enabled || status?.running);
  const url = status?.url ?? `http://127.0.0.1:${cfg?.mcp_port || 5323}/mcp`;
  // Display: real token when revealed, short mask when hidden, <token> only when unknown.
  const tokenMask = "XXXXXX";
  const tokenForDisplay = token ? (revealed ? token : tokenMask) : "<token>";
  // Copy always pastes the real secret when the server is running.
  const tokenForCopy = token ?? "<token>";

  const displaySnippets = buildSnippets(url, tokenForDisplay);
  const copySnippets = buildSnippets(url, tokenForCopy);

  if (!cfg) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="settings-section-mcp">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="settings-section-mcp">
      <div>
        <h2 className="text-base font-semibold">MCP</h2>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
          Expose Oleafly&apos;s AI tools to external apps over the Model Context Protocol. Claude
          Desktop, Claude Code, Cursor, and other MCP clients can then read, edit, and compile the
          open project, with your approval for every change.
        </p>
      </div>

      <div
        role="switch"
        aria-checked={enabled}
        aria-label="Enable MCP server"
        tabIndex={0}
        data-testid="mcp-enable-toggle"
        onClick={() => {
          if (!busy) void toggleEnabled(!enabled);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!busy) void toggleEnabled(!enabled);
          }
        }}
        className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border bg-card p-3 hover:bg-accent"
      >
        <div>
          <div className="text-sm font-medium">Enable MCP server</div>
          <div className="text-xs text-muted-foreground">
            Listens only on this computer while Oleafly is open.
          </div>
        </div>
        <span
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
            enabled ? "bg-primary" : "bg-zinc-300 dark:bg-zinc-600",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block size-4 rounded-full bg-white shadow transition-transform",
              enabled ? "translate-x-4" : "translate-x-1",
            )}
          />
        </span>
      </div>

      <div data-testid="mcp-status" className="rounded-lg border bg-card p-3 text-sm">
        {status?.running && status.url ? (
          <span className="text-emerald-600 dark:text-emerald-500">
            {restartConfirmation ? `Restarted at ${restartConfirmation}` : `Running at ${status.url}`}
          </span>
        ) : (
          <span className="text-muted-foreground">Off</span>
        )}
      </div>

      {enabled && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="mcp-port">
            Port
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="mcp-port"
              type="text"
              readOnly
              aria-label="Automatically selected MCP server port"
              value={status?.port ?? cfg.mcp_port}
              className="w-32"
            />
            <Tooltip
              side="right"
              wide
              label="Restart the MCP server. Oleafly reuses this port if it is available, or selects another free port."
            >
              <Button
                type="button"
                variant="secondary"
                size="icon"
                disabled={busy}
                aria-label="Restart MCP server and select an available port"
                onClick={() => void restartServer()}
              >
                <RefreshCw className={cn("size-4", busy && "animate-spin")} />
              </Button>
            </Tooltip>
          </div>
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Approval policy</legend>
        <RadioGroup
          value={cfg.mcp_approval_policy || "ask"}
          onValueChange={(value) => void persistPolicy({ mcp_approval_policy: value })}
        >
        <label htmlFor="mcp-policy-ask" className="flex cursor-pointer items-start gap-2 text-sm">
          <RadioGroupItem
            id="mcp-policy-ask"
            value="ask"
            className="mt-1"
            data-testid="mcp-policy-ask"
          />
          <span>
            <span className="font-medium">Confirm every change</span>
            <span className="block text-xs text-muted-foreground">
              Writes, renames, and deletes show an approval card in Oleafly with a diff before
              anything is applied.
            </span>
          </span>
        </label>
        <label htmlFor="mcp-policy-auto-writes" className="flex cursor-pointer items-start gap-2 text-sm">
          <RadioGroupItem
            id="mcp-policy-auto-writes"
            value="auto_writes"
            className="mt-1"
            data-testid="mcp-policy-auto-writes"
          />
          <span>
            <span className="font-medium">Auto-approve edits, confirm deletes</span>
            <span className="block text-xs text-muted-foreground">
              Writes and renames apply immediately. Deletes still show an approval card.
            </span>
          </span>
        </label>
        <label htmlFor="mcp-policy-trust" className="flex cursor-pointer items-start gap-2 text-sm">
          <RadioGroupItem
            id="mcp-policy-trust"
            value="trust"
            className="mt-1"
            data-testid="mcp-policy-trust"
          />
          <span>
            <span className="font-medium">Trust this connection</span>
            <span className="block text-xs text-muted-foreground">
              Oleafly never prompts. Your MCP client's own approval is the only gate, deletes
              included. Best when your client already confirms tool use.
            </span>
          </span>
        </label>
        </RadioGroup>
      </fieldset>

      <div
        role="switch"
        aria-checked={!!cfg.mcp_read_only}
        aria-label="Read-only mode"
        tabIndex={0}
        onClick={() => void persistPolicy({ mcp_read_only: !cfg.mcp_read_only })}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void persistPolicy({ mcp_read_only: !cfg.mcp_read_only });
          }
        }}
        className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border bg-card p-3 hover:bg-accent"
      >
        <div>
          <div className="text-sm font-medium">Read-only</div>
          <div className="text-xs text-muted-foreground">
            External apps can read and compile but never modify files.
          </div>
        </div>
        <span
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
            cfg.mcp_read_only ? "bg-primary" : "bg-zinc-300 dark:bg-zinc-600",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block size-4 rounded-full bg-white shadow transition-transform",
              cfg.mcp_read_only ? "translate-x-4" : "translate-x-1",
            )}
          />
        </span>
      </div>

      <div className="space-y-2 rounded-lg border bg-card p-3">
        <div className="text-xs font-medium">Bearer token</div>
        <code className="block w-full truncate rounded bg-muted px-2 py-1.5 text-[11px] font-mono">
          {status?.running
            ? revealed && token
              ? token
              : tokenMask
            : "Enable the server to view the token."}
        </code>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!status?.running || busy}
            onClick={() => {
              if (revealed) {
                setRevealed(false);
              } else {
                void revealToken();
              }
            }}
          >
            {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {revealed ? "Hide" : "Reveal"}
          </Button>
          <CopyBtn text={token ?? ""} testId="mcp-copy-token" />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="mcp-copy-url"
            onClick={() => void navigator.clipboard.writeText(url)}
          >
            <Copy className="size-3.5" />
            Copy URL
          </Button>
          {!confirmRegen ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmRegen(true)}
            >
              <RefreshCw className="size-3.5" />
              Regenerate
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-amber-600 dark:text-amber-500">
                Existing clients will need the new token.
              </span>
              <Button type="button" size="sm" disabled={busy} onClick={() => void regenerate()}>
                Confirm
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirmRegen(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Reveal or copy the bearer token, copy the server URL, or regenerate the
          token for connected MCP clients.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Connect your app</h3>
        <Snippet
          title="Claude Code"
          body={displaySnippets.claudeCode}
          copyText={copySnippets.claudeCode}
          lang="shell"
        />
        <Snippet
          title={
            <>
              Claude Desktop (<FileName>claude_desktop_config.json</FileName>)
            </>
          }
          body={displaySnippets.claudeDesktop}
          copyText={copySnippets.claudeDesktop}
          lang="json"
        />
        <Snippet
          title={
            <>
              Cursor (<FileName>.cursor/mcp.json</FileName>)
            </>
          }
          body={displaySnippets.cursor}
          copyText={copySnippets.cursor}
          lang="json"
        />
        <Snippet
          title={
            <>
              Grok CLI (<FileName>~/.grok/config.toml</FileName>)
            </>
          }
          body={displaySnippets.grok}
          copyText={copySnippets.grok}
          lang="toml"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        The server only listens on this computer (127.0.0.1) and requires the token above. Under
        the first two policies, deleting files always asks for your confirmation in Oleafly.
        claude.ai in the browser cannot reach a local server; use Claude Desktop instead.
      </p>

      {error && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          {error}
        </p>
      )}
    </div>
  );
}
