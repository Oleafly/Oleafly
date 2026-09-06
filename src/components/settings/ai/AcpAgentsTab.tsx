import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { AgentLogo } from "@/components/ai/acp/AgentLogo";
import { ReadinessBadge } from "@/components/ai/acp/AgentReadiness";
import { bridgeSourceLabel, readinessDetail } from "@/components/ai/acp/agent-copy";
import {
  acpError,
  acpInstall,
  acpReadiness,
  acpRegister,
  acpRegistrySearch,
  acpRemoveAgent,
  type AcpAgentStatus,
  type AcpDefinition,
  type AcpRegistryEntry,
} from "@/lib/acp";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { useSettingsStore } from "@/store/settings";
import { useTerminalsStore } from "@/store/terminals";

const example = JSON.stringify(
  {
    id: "my-agent",
    name: "My agent",
    version: "1.0.0",
    description: "An installed ACP agent.",
    distribution: { command: { executable: "/absolute/path/to/my-agent", args: ["--acp"] } },
  },
  null,
  2,
);

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip label={copied ? "Copied" : label}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-label={label}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => setCopied(false));
        }}
      >
        <Copy className="size-3" />
      </Button>
    </Tooltip>
  );
}

function DetailRow({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 p-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function Section({
  id,
  title,
  description,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  description: string;
  icon: typeof Search;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        data-testid={`acp-section-${id}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 p-3 text-left"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-snug">{title}</span>
          <span className="block text-xs leading-snug text-muted-foreground">{description}</span>
        </span>
      </button>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </div>
  );
}

function RegistryResult({
  entry,
  registered,
  busy,
  onRegister,
}: {
  entry: AcpRegistryEntry;
  registered: boolean;
  busy: boolean;
  onRegister: (definition: AcpDefinition) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <article className="space-y-2 rounded-md border bg-background p-3">
      <h4 className="text-sm font-medium">
        {entry.name} <span className="font-normal text-muted-foreground">{entry.version}</span>
      </h4>
      <p className="text-xs text-muted-foreground">{entry.description}</p>
      {entry.reason && <p className="text-xs text-muted-foreground">{entry.reason}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || !entry.definition || registered}
          onClick={() => {
            if (entry.definition) onRegister(entry.definition);
          }}
        >
          {registered ? "Registered" : "Register agent"}
        </Button>
        {entry.definition && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={shown}
            onClick={() => setShown((value) => !value)}
          >
            {shown ? "Hide distribution" : "Show distribution"}
          </Button>
        )}
      </div>
      {shown && entry.definition && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 text-[11px]">
          {JSON.stringify(entry.definition.distribution, null, 2)}
        </pre>
      )}
    </article>
  );
}

function AgentCard({
  agent,
  projectId,
  busy,
  onInstall,
  onRemove,
  onOpenTerminal,
}: {
  agent: AcpAgentStatus;
  projectId?: string | null;
  busy: string | null;
  onInstall: (definition: AcpDefinition) => void;
  onRemove: (agentId: string) => void;
  onOpenTerminal: () => void;
}) {
  const [open, setOpen] = useState(false);
  const readiness = acpReadiness(agent);
  const cli = agent.cli;
  const installing = busy === "install";
  return (
    <div
      data-testid={`acp-agent-card-${agent.definition.id}`}
      className="rounded-lg border bg-card transition-colors"
    >
      <div className="flex items-start gap-2 p-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <AgentLogo agentId={agent.definition.id} size={18} />
              <h4 className="text-sm font-medium">{agent.definition.name}</h4>
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              {readinessDetail(agent, readiness)}
            </span>
          </span>
        </button>
        <div className="mt-0.5 shrink-0">
          <ReadinessBadge readiness={readiness} />
        </div>
      </div>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          {cli && (
            <DetailRow title="Command line tool">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 break-all font-mono text-[11px] text-foreground">
                  {cli.path ?? `${cli.command} was not found on your PATH.`}
                </p>
                {cli.version && (
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {cli.version}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <code className="min-w-0 flex-1 truncate rounded bg-background px-1.5 py-1 font-mono text-[11px]">
                  {cli.signInCommand}
                </code>
                <CopyValue value={cli.signInCommand} label="Copy sign-in command" />
                {projectId && (
                  <Button type="button" variant="ghost" size="xs" onClick={onOpenTerminal}>
                    <Terminal className="size-3" /> Open terminal
                  </Button>
                )}
              </div>
            </DetailRow>
          )}
          <DetailRow title="ACP bridge">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 break-all font-mono text-[11px] text-foreground">
                {agent.executable ?? "No bridge executable resolved yet."}
              </p>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {agent.installedVersion ?? agent.definition.version}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {bridgeSourceLabel(agent)} · {agent.platform}
            </p>
            {agent.taskUnavailableReason && (
              <p className="text-[11px] text-muted-foreground">{agent.taskUnavailableReason}</p>
            )}
          </DetailRow>
          {agent.reason && <p className="text-xs text-muted-foreground">{agent.reason}</p>}
          {agent.signInHint && <p className="text-xs text-muted-foreground">{agent.signInHint}</p>}
          <div className="flex flex-wrap gap-2">
            {(!agent.installed || !agent.managed) && (
              <Button
                type="button"
                size="sm"
                data-testid={`acp-agent-install-${agent.definition.id}`}
                disabled={!!busy || !agent.canInstall}
                onClick={() => onInstall(agent.definition)}
              >
                {installing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
                {agent.installed ? "Update bridge" : "Install bridge"}
              </Button>
            )}
            {!agent.definition.builtin && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!!busy}
                onClick={() => onRemove(agent.definition.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" /> Remove
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AcpAgentsTab({ projectId }: { projectId?: string | null }) {
  const catalog = useAcpSessionsStore((state) => state.catalog);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AcpRegistryEntry[]>([]);
  const [definition, setDefinition] = useState("");
  const [review, setReview] = useState<AcpDefinition | null>(null);

  useEffect(() => {
    void useAcpSessionsStore
      .getState()
      .refreshCatalog(true)
      .catch((value: unknown) => setError(acpError(value)));
  }, []);

  const action = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (value) {
      setError(acpError(value));
    } finally {
      setBusy(null);
    }
  };
  const register = (json: string) =>
    action("register", async () => {
      const registered = await acpRegister(json);
      await useAcpSessionsStore.getState().refreshCatalog();
      setReview(null);
      setNotice(`${registered.name} is registered. Registration does not install or launch it.`);
    });
  const openTerminal = () => {
    if (!projectId) return;
    const terminals = useTerminalsStore.getState();
    terminals.setProject(projectId);
    terminals.addTerminal();
    useSettingsStore.getState().setTerminalOpen(true);
    setNotice(
      "The project terminal is open. Run the sign-in command shown for your agent, then reconnect the conversation.",
    );
  };
  const packageName =
    review?.distribution.npx?.package ??
    review?.distribution.uvx?.package ??
    review?.distribution.command?.executable ??
    review?.distribution.binary?.[Object.keys(review.distribution.binary ?? {})[0] ?? ""]?.archive ??
    "";

  return (
    <section className="space-y-4" aria-label="ACP agents">
      <div className="space-y-2">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Connect a local agent through ACP. Each agent manages its own models, tools and
          sign-in, and API provider settings stay separate. Use the official CLI account for
          sign-in: Oleafly does not import account tokens or estimate subscription quotas.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={!!busy}
            onClick={() =>
              void action("preflight", () => useAcpSessionsStore.getState().refreshCatalog(true))
            }
          >
            {busy === "preflight" ? (
              <>
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                Checking installed agents
              </>
            ) : (
              <>
                <RefreshCw aria-hidden="true" className="size-3.5" />
                Check installed agents
              </>
            )}
          </Button>
          {projectId && (
            <Button variant="outline" size="sm" type="button" onClick={openTerminal}>
              <Terminal className="size-3.5" /> Open sign-in terminal
            </Button>
          )}
        </div>
      </div>
      {error && !review && (
        <p role="alert" className="rounded-md border border-destructive/40 p-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md border p-2 text-xs">
          {notice}
        </p>
      )}

      <div className="space-y-2.5" data-testid="acp-agent-list">
        {catalog.map((agent) => (
          <AgentCard
            key={agent.definition.id}
            agent={agent}
            projectId={projectId}
            busy={busy}
            onInstall={setReview}
            onOpenTerminal={openTerminal}
            onRemove={(agentId) =>
              void action(agentId, async () => {
                await acpRemoveAgent(agentId);
                await useAcpSessionsStore.getState().refreshCatalog();
                setNotice(
                  "Agent definition removed. Installed files and saved conversations remain available.",
                );
              })
            }
          />
        ))}
      </div>

      <Section
        id="registry"
        title="Find more agents"
        description="Search the ACP registry for agents published by other teams."
        icon={Search}
      >
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void action("search", async () => setResults(await acpRegistrySearch(query)));
          }}
        >
          <label className="block text-xs font-medium" htmlFor="acp-registry-search">
            Find an ACP agent
          </label>
          <div className="flex gap-2">
            <Input
              id="acp-registry-search"
              className="min-w-0 flex-1 text-xs"
              placeholder="Search the ACP registry"
              value={query}
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button variant="outline" size="sm" type="submit" disabled={!!busy}>
              {busy === "search" ? "Searching" : "Search"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Registry entries describe software from its publishers. Review the distribution before
            registering or installing it.
          </p>
        </form>
        {results.length > 0 && (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {results.map((entry) => (
              <RegistryResult
                key={entry.id}
                entry={entry}
                busy={!!busy}
                registered={catalog.some((agent) => agent.definition.id === entry.id)}
                onRegister={(value) => void register(JSON.stringify(value))}
              />
            ))}
          </div>
        )}
      </Section>

      <Section
        id="custom"
        title="Add a custom agent"
        description="Paste an agent definition to register an agent Oleafly does not ship."
        icon={Plus}
      >
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void register(definition);
          }}
        >
          <label className="block text-xs font-medium" htmlFor="acp-custom-definition">
            Register a custom agent
          </label>
          <p className="text-xs text-muted-foreground">
            Paste an agent definition with a pinned npm or uv package, a verified binary, or an
            installed executable. Keep passwords and API keys out of this JSON.
          </p>
          <Textarea
            id="acp-custom-definition"
            className="min-h-40 font-mono text-xs"
            value={definition}
            maxLength={65536}
            placeholder={example}
            onChange={(event) => setDefinition(event.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={!!busy || !definition.trim()}>
              Register definition
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setDefinition(example)}
            >
              Use example
            </Button>
          </div>
        </form>
      </Section>

      <Dialog open={review !== null} onOpenChange={(open) => !open && setReview(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Install {review?.name} bridge {review?.version}
            </DialogTitle>
            <DialogDescription>
              Oleafly downloads this pinned package into its own agent folder. The agent then runs
              with your CLI account when you start a conversation.
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 rounded-md border bg-muted/30 p-2.5 text-xs">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">Package</dt>
              <dd className="min-w-0 break-all font-mono text-[11px]">{packageName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">Installs to</dt>
              <dd className="min-w-0 break-all font-mono text-[11px]">
                Oleafly agents folder, {review?.id}/{review?.version}
              </dd>
            </div>
          </dl>
          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 p-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={!!busy}
              onClick={() => setReview(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              type="button"
              disabled={!!busy}
              onClick={() =>
                void action("install", async () => {
                  if (!review) return;
                  if (!catalog.some((agent) => agent.definition.id === review.id)) {
                    await acpRegister(JSON.stringify(review));
                  }
                  await acpInstall(review.id);
                  await useAcpSessionsStore.getState().refreshCatalog(true);
                  setNotice(`${review.name} is installed. Sign in through its CLI before starting a conversation.`);
                  setReview(null);
                })
              }
            >
              {busy === "install" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {busy === "install" ? "Installing" : "Install"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
