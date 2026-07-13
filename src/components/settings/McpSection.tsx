import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getConfig,
  mcpConnectionInfo,
  mcpRegenerateToken,
  mcpSetEnabled,
  mcpStatus,
  setConfig,
  type AppConfig,
  type McpStatus,
} from "@/lib/tauri";
import { refreshMcpRegistry } from "@/lib/mcp-bridge";
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

function Snippet({
  title,
  body,
  copyText,
}: {
  title: string;
  body: string;
  copyText: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <CopyBtn text={copyText} />
      </div>
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap break-all">
        {body}
      </pre>
    </div>
  );
}

export function McpSection() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portDraft, setPortDraft] = useState("5323");
  const [token, setToken] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([getConfig(), mcpStatus()]);
      setCfg(c);
      setStatus(s);
      setPortDraft(String(c.mcp_port || 5323));
    } catch (e) {
      setError(String(e));
    }
  }, []);

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
    if (!cfg) return;
    setBusy(true);
    setError(null);
    setRevealed(false);
    setToken(null);
    try {
      const port = Number(portDraft) || cfg.mcp_port || 5323;
      const s = await mcpSetEnabled(next, port);
      setStatus(s);
      setCfg({ ...cfg, mcp_enabled: next, mcp_port: port });
      if (next) await refreshMcpRegistry();
    } catch (e) {
      const msg = String(e);
      setError(
        msg.includes("bind") || msg.includes("in use") || msg.includes("Address already")
          ? `Port ${portDraft} is in use. Pick another port.`
          : msg,
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  const applyPort = async () => {
    if (!cfg) return;
    const port = Number(portDraft);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      setError("Port must be a number between 1 and 65535.");
      setPortDraft(String(cfg.mcp_port || 5323));
      return;
    }
    setError(null);
    if (cfg.mcp_enabled || status?.running) {
      setBusy(true);
      try {
        const s = await mcpSetEnabled(true, port);
        setStatus(s);
        setCfg({ ...cfg, mcp_port: port, mcp_enabled: true });
      } catch (e) {
        setError(
          String(e).includes("bind") || String(e).includes("in use")
            ? `Port ${port} is in use. Pick another port.`
            : String(e),
        );
      } finally {
        setBusy(false);
      }
    } else {
      await persistPolicy({ mcp_port: port });
    }
  };

  const revealToken = async () => {
    setError(null);
    if (!status?.running) {
      setError("Enable the server to view the token.");
      return;
    }
    try {
      const info = await mcpConnectionInfo();
      setToken(info.token);
      setRevealed(true);
    } catch (e) {
      setError(String(e));
    }
  };

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      await mcpRegenerateToken();
      setToken(null);
      setRevealed(false);
      setConfirmRegen(false);
      if (status?.running) {
        const info = await mcpConnectionInfo();
        setToken(info.token);
        setRevealed(true);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const enabled = !!(cfg?.mcp_enabled || status?.running);
  const url = status?.url ?? `http://127.0.0.1:${portDraft || 5323}/mcp`;
  const tokenPlaceholder = "<token>";
  const tokenForSnippets = revealed && token ? token : tokenPlaceholder;

  const claudeCode = `claude mcp add --transport http openleaf ${url} --header "Authorization: Bearer ${tokenForSnippets}"`;
  const claudeDesktop = JSON.stringify(
    {
      mcpServers: {
        openleaf: {
          command: "npx",
          args: [
            "-y",
            "mcp-remote@latest",
            url,
            "--header",
            `Authorization: Bearer ${tokenForSnippets}`,
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
        openleaf: {
          url,
          headers: { Authorization: `Bearer ${tokenForSnippets}` },
        },
      },
    },
    null,
    2,
  );
  const grok = `[mcp_servers.openleaf]\nurl = "${url}"\nheaders = { Authorization = "Bearer ${tokenForSnippets}" }`;

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
          Expose OpenLeaf&apos;s AI tools to external apps over the Model Context Protocol. Claude
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
        className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border bg-background p-3 hover:bg-accent"
      >
        <div>
          <div className="text-sm font-medium">Enable MCP server</div>
          <div className="text-xs text-muted-foreground">
            Listens only on this computer while OpenLeaf is open.
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

      <div data-testid="mcp-status" className="rounded-lg border bg-background p-3 text-sm">
        {status?.running && status.url ? (
          <span className="text-emerald-600 dark:text-emerald-500">Running at {status.url}</span>
        ) : (
          <span className="text-muted-foreground">Off</span>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium" htmlFor="mcp-port">
          Port
        </label>
        <input
          id="mcp-port"
          type="number"
          min={1}
          max={65535}
          value={portDraft}
          onChange={(e) => setPortDraft(e.target.value)}
          onBlur={() => void applyPort()}
          className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Approval policy</legend>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name="mcp-policy"
            className="mt-1"
            data-testid="mcp-policy-ask"
            checked={
              cfg.mcp_approval_policy !== "auto_writes" && cfg.mcp_approval_policy !== "trust"
            }
            onChange={() => void persistPolicy({ mcp_approval_policy: "ask" })}
          />
          <span>
            <span className="font-medium">Confirm every change</span>
            <span className="block text-xs text-muted-foreground">
              Writes, renames, and deletes show an approval card in OpenLeaf with a diff before
              anything is applied.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name="mcp-policy"
            className="mt-1"
            data-testid="mcp-policy-auto-writes"
            checked={cfg.mcp_approval_policy === "auto_writes"}
            onChange={() => void persistPolicy({ mcp_approval_policy: "auto_writes" })}
          />
          <span>
            <span className="font-medium">Auto-approve edits, confirm deletes</span>
            <span className="block text-xs text-muted-foreground">
              Writes and renames apply immediately. Deletes still show an approval card.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name="mcp-policy"
            className="mt-1"
            data-testid="mcp-policy-trust"
            checked={cfg.mcp_approval_policy === "trust"}
            onChange={() => void persistPolicy({ mcp_approval_policy: "trust" })}
          />
          <span>
            <span className="font-medium">Trust this connection</span>
            <span className="block text-xs text-muted-foreground">
              OpenLeaf never prompts. Your MCP client's own approval is the only gate, deletes
              included. Best when your client already confirms tool use.
            </span>
          </span>
        </label>
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
        className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border bg-background p-3 hover:bg-accent"
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

      <div className="space-y-2 rounded-lg border bg-background p-3">
        <div className="text-xs font-medium">Bearer token</div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-[11px] font-mono">
            {revealed && token
              ? token
              : status?.running
                ? "••••••••••••••••••••••••••••••••"
                : "Enable the server to view the token."}
          </code>
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
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Connect your app</h3>
        <Snippet title="Claude Code" body={claudeCode} copyText={claudeCode} />
        <Snippet
          title="Claude Desktop (claude_desktop_config.json)"
          body={claudeDesktop}
          copyText={claudeDesktop}
        />
        <Snippet title="Cursor (.cursor/mcp.json)" body={cursor} copyText={cursor} />
        <Snippet title="Grok CLI (~/.grok/config.toml)" body={grok} copyText={grok} />
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        The server only listens on this computer (127.0.0.1) and requires the token above. Under
        the first two policies, deleting files always asks for your confirmation in OpenLeaf.
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
