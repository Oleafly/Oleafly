import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip } from "@/components/ui/tooltip";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { CopyTextButton, highlightSnippet, type SnippetLang } from "@/components/settings/snippet";
import { CodeBlock } from "@/components/ui/code-block";
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
import { describeError } from "@/lib/app-error";
import { refreshMcpRegistry, revokeMcpBridgeCalls } from "@/lib/mcp-bridge";
import { useMcpActivityStore } from "@/store/mcp-activity";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

type McpClientTab = "claude-code" | "claude-desktop" | "cursor" | "codex" | "grok";

const CLIENT_NAMES: Record<McpClientTab, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
  codex: "Codex CLI",
  grok: "Grok CLI",
};

const CLIENT_CONFIG_FILES = {
  "claude-desktop": "claude_desktop_config.json",
  cursor: ".cursor/mcp.json",
  codex: "~/.codex/config.toml",
  grok: "~/.grok/config.toml",
} as const;

const SNIPPET_TITLE_SUFFIX = ")";


function FileName({ children }: Readonly<{ children: string }>) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem] font-normal text-foreground">
      {children}
    </code>
  );
}

function ClientSnippetTitle({ client }: Readonly<{ client: keyof typeof CLIENT_CONFIG_FILES }>) {
  const prefix = `${CLIENT_NAMES[client]} (`;
  return (
    <>
      {prefix}
      <FileName>{CLIENT_CONFIG_FILES[client]}</FileName>
      {SNIPPET_TITLE_SUFFIX}
    </>
  );
}

function Snippet({
  title,
  body,
  copyText,
  lang,
}: Readonly<{
  title: ReactNode;
  // Displayed (may be masked).
  body: string;
  // Pasted on Copy (always the real snippet when the token is known).
  copyText: string;
  lang: SnippetLang;
}>) {
  const highlighted = useMemo(() => highlightSnippet(body, lang), [body, lang]);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-foreground">{title}</p>
      <CodeBlock code={copyText} preClassName="p-2.5 pr-10 whitespace-pre-wrap break-all">
        <code>{highlighted}</code>
      </CodeBlock>
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
  const codex = [
    "[mcp_servers.oleafly]",
    'command = "npx"',
    `args = ["-y", "mcp-remote@latest", "${url}", "--header", "Authorization: Bearer ${bearer}", "--transport", "http-only"]`,
  ].join("\n");
  return { claudeCode, claudeDesktop, cursor, grok, codex };
}

export function McpSection() {
  const { t } = useTranslation(["common", "settings"]);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [restartConfirmation, setRestartConfirmation] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [clientTab, setClientTab] = useState<McpClientTab>("claude-code");

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
      setError(describeError(e));
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
      revokeMcpBridgeCalls();
      await setConfig(next);
      setCfg(next);
      await refreshMcpRegistry();
    } catch (e) {
      setError(describeError(e));
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
      if (!next) revokeMcpBridgeCalls();
      let s = await mcpSetEnabled(next);
      if (next) {
        await refreshMcpRegistry();
        s = await mcpStatus();
      }
      setStatus(s);
      setCfg({
        ...cfg,
        mcp_enabled: next,
        mcp_port: s.port ?? cfg.mcp_port,
      });
      useMcpActivityStore.getState().setServerRunning(!!s.running);
      if (next) {
        await loadToken(s.running);
      } else {
        setToken(null);
      }
    } catch (e) {
      setError(describeError(e));
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
      revokeMcpBridgeCalls();
      const restarting = await mcpRestartServer();
      await refreshMcpRegistry();
      const ready = await mcpStatus();
      setStatus(ready);
      setCfg({
        ...cfg,
        mcp_enabled: true,
        mcp_port: ready.port ?? restarting.port ?? cfg.mcp_port,
      });
      useMcpActivityStore.getState().setServerRunning(ready.running);
      setRestartConfirmation(ready.url);
      await loadToken(ready.running);
    } catch (e) {
      setError(describeError(e));
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const revealToken = async () => {
    setError(null);
    if (!status?.running) {
      setError(t(($) => $.settings.mcp.section.token.enableToView));
      return;
    }
    if (!token) {
      try {
        const info = await mcpConnectionInfo();
        setToken(info.token);
      } catch (e) {
        setError(describeError(e));
        return;
      }
    }
    setRevealed(true);
  };

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      revokeMcpBridgeCalls();
      await mcpRegenerateToken();
      await refreshMcpRegistry();
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
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const enabled = !!(cfg?.mcp_enabled || status?.running);
  const url = status?.url ?? `http://127.0.0.1:${cfg?.mcp_port || 5323}/mcp`;
  // Display: real token when revealed, short mask when hidden, <token> only when unknown.
  const tokenMask = "XXXXXX";
  const shownToken = revealed && token ? token : tokenMask;
  const tokenForDisplay = token ? shownToken : "<token>";
  // Copy always pastes the real secret when the server is running.
  const tokenForCopy = token ?? "<token>";

  const displaySnippets = buildSnippets(url, tokenForDisplay);
  const copySnippets = buildSnippets(url, tokenForCopy);

  if (!cfg) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="oleafly-mcp-server">
        <Spinner /> {t(($) => $.common.state.loading)}
      </div>
    );
  }

  const renderMcpStatus = () => (
    <div data-testid="mcp-status" className="rounded-lg border bg-card p-3 text-sm">
      {status?.running && status.url ? (
        <span className="text-emerald-600 dark:text-emerald-500">
          {restartConfirmation
            ? t(($) => $.settings.mcp.section.status.restartedAt, { url: restartConfirmation })
            : t(($) => $.settings.mcp.section.status.runningAt, { url: status.url })}
        </span>
      ) : (
        <span className="text-muted-foreground">{t(($) => $.common.state.off)}</span>
      )}
    </div>
  );

  const renderMcpTokenCard = () => (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="text-xs font-medium">{t(($) => $.settings.mcp.section.token.label)}</div>
      <code className="block w-full truncate rounded bg-muted px-2 py-1.5 text-[0.6875rem] font-mono">
        {status?.running
          ? shownToken
          : t(($) => $.settings.mcp.section.token.enableToView)}
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
          {revealed
            ? t(($) => $.settings.mcp.section.token.hide)
            : t(($) => $.settings.mcp.section.token.reveal)}
        </Button>
        <CopyTextButton text={token ?? ""} testId="mcp-copy-token" />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-testid="mcp-copy-url"
          onClick={() => void navigator.clipboard.writeText(url)}
        >
          <Copy className="size-3.5" />
          {t(($) => $.settings.mcp.section.token.copyUrl)}
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
            {t(($) => $.settings.mcp.section.token.regenerate)}
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-amber-600 dark:text-amber-500">
              {t(($) => $.settings.mcp.section.token.regenerateWarning)}
            </span>
            <Button type="button" size="sm" disabled={busy} onClick={() => void regenerate()}>
              {t(($) => $.common.actions.confirm)}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setConfirmRegen(false)}
            >
              {t(($) => $.common.actions.cancel)}
            </Button>
          </div>
        )}
      </div>
      <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
        {t(($) => $.settings.mcp.section.token.help)}
      </p>
    </div>
  );

  return (
    <div className="space-y-5" data-testid="oleafly-mcp-server">
      <div>
        <h3 className="text-sm font-medium">{t(($) => $.settings.mcp.section.title)}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t(($) => $.settings.mcp.section.description)}
        </p>
      </div>

      <SettingsToggleRow
        testId="mcp-enable-toggle"
        label={t(($) => $.settings.mcp.section.enable.label)}
        ariaLabel={t(($) => $.settings.mcp.section.enable.ariaLabel)}
        description={t(($) => $.settings.mcp.section.enable.description)}
        checked={enabled}
        onChange={(value) => {
          if (!busy) void toggleEnabled(value);
        }}
      />

      {renderMcpStatus()}

      {enabled && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="mcp-port">
            {t(($) => $.settings.mcp.section.port.label)}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="mcp-port"
              type="text"
              readOnly
              aria-label={t(($) => $.settings.mcp.section.port.ariaLabel)}
              value={status?.port ?? cfg.mcp_port}
              className="w-32"
            />
            <Tooltip
              side="right"
              wide
              label={t(($) => $.settings.mcp.section.port.restartTooltip)}
            >
              <Button
                type="button"
                variant="secondary"
                size="icon"
                disabled={busy}
                aria-label={t(($) => $.settings.mcp.section.port.restartAriaLabel)}
                onClick={() => void restartServer()}
              >
                <RefreshCw className={cn("size-4", busy && "animate-spin")} />
              </Button>
            </Tooltip>
          </div>
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">{t(($) => $.settings.mcp.section.policy.legend)}</legend>
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
            <span className="font-medium">{t(($) => $.settings.mcp.section.policy.ask.label)}</span>
            <span className="block text-xs text-muted-foreground">
              {t(($) => $.settings.mcp.section.policy.ask.description)}
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
            <span className="font-medium">{t(($) => $.settings.mcp.section.policy.autoWrites.label)}</span>
            <span className="block text-xs text-muted-foreground">
              {t(($) => $.settings.mcp.section.policy.autoWrites.description)}
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
            <span className="font-medium">{t(($) => $.settings.mcp.section.policy.trust.label)}</span>
            <span className="block text-xs text-muted-foreground">
              {t(($) => $.settings.mcp.section.policy.trust.description)}
            </span>
          </span>
        </label>
        </RadioGroup>
      </fieldset>

      <SettingsToggleRow
        label={t(($) => $.settings.mcp.section.readOnly.label)}
        ariaLabel={t(($) => $.settings.mcp.section.readOnly.ariaLabel)}
        description={t(($) => $.settings.mcp.section.readOnly.description)}
        checked={!!cfg.mcp_read_only}
        onChange={(value) => void persistPolicy({ mcp_read_only: value })}
      />

      {renderMcpTokenCard()}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t(($) => $.settings.mcp.section.clients.title)}</h3>
        <Tabs
          value={clientTab}
          onValueChange={(value) => setClientTab(value as McpClientTab)}
          className="space-y-3"
        >
          <TabsList scrollable data-testid="mcp-client-tab-strip">
            <TabsTrigger
              value="claude-code"
              data-testid="mcp-tab-claude-code"
            >
              {CLIENT_NAMES["claude-code"]}
            </TabsTrigger>
            <TabsTrigger
              value="claude-desktop"
              data-testid="mcp-tab-claude-desktop"
            >
              {CLIENT_NAMES["claude-desktop"]}
            </TabsTrigger>
            <TabsTrigger
              value="cursor"
              data-testid="mcp-tab-cursor"
            >
              {CLIENT_NAMES.cursor}
            </TabsTrigger>
            <TabsTrigger
              value="codex"
              data-testid="mcp-tab-codex"
            >
              {CLIENT_NAMES.codex}
            </TabsTrigger>
            <TabsTrigger
              value="grok"
              data-testid="mcp-tab-grok"
            >
              {CLIENT_NAMES.grok}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="claude-code">
            <Snippet
              title={CLIENT_NAMES["claude-code"]}
              body={displaySnippets.claudeCode}
              copyText={copySnippets.claudeCode}
              lang="shell"
            />
          </TabsContent>
          <TabsContent value="claude-desktop">
            <Snippet
              title={<ClientSnippetTitle client="claude-desktop" />}
              body={displaySnippets.claudeDesktop}
              copyText={copySnippets.claudeDesktop}
              lang="json"
            />
          </TabsContent>
          <TabsContent value="cursor">
            <Snippet
              title={<ClientSnippetTitle client="cursor" />}
              body={displaySnippets.cursor}
              copyText={copySnippets.cursor}
              lang="json"
            />
          </TabsContent>
          <TabsContent value="codex">
            <Snippet
              title={<ClientSnippetTitle client="codex" />}
              body={displaySnippets.codex}
              copyText={copySnippets.codex}
              lang="toml"
            />
          </TabsContent>
          <TabsContent value="grok">
            <Snippet
              title={<ClientSnippetTitle client="grok" />}
              body={displaySnippets.grok}
              copyText={copySnippets.grok}
              lang="toml"
            />
          </TabsContent>
        </Tabs>
      </div>

      <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
        {t(($) => $.settings.mcp.section.footer)}
      </p>

      {error && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          {error}
        </p>
      )}
    </div>
  );
}
