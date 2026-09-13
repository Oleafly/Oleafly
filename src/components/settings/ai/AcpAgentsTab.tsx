import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { appModalCoordinator } from "@/components/ui/use-modal-accessibility";
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

function CopyValue({ value, label }: Readonly<{ value: string; label: string }>) {
  const { t } = useTranslation(["common"]);
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip label={copied ? t(($) => $.common.actions.copied) : label}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
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

function Section({
  id,
  title,
  description,
  icon: Icon,
  children,
}: Readonly<{
  id: string;
  title: string;
  description: string;
  icon: typeof Search;
  children: React.ReactNode;
}>) {
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
}: Readonly<{
  entry: AcpRegistryEntry;
  registered: boolean;
  busy: boolean;
  onRegister: (definition: AcpDefinition) => void;
}>) {
  const { t } = useTranslation(["settings"]);
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
          {registered
            ? t(($) => $.settings.ai.agents.registry.registered)
            : t(($) => $.settings.ai.agents.registry.register)}
        </Button>
        {entry.definition && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={shown}
            onClick={() => setShown((value) => !value)}
          >
            {shown
              ? t(($) => $.settings.ai.agents.registry.hideDistribution)
              : t(($) => $.settings.ai.agents.registry.showDistribution)}
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
}: Readonly<{
  agent: AcpAgentStatus;
  projectId?: string | null;
  busy: string | null;
  onInstall: (definition: AcpDefinition, opener: HTMLButtonElement) => void;
  onRemove: (agentId: string) => void;
  onOpenTerminal: () => void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const [open, setOpen] = useState(false);
  const readiness = acpReadiness(agent);
  const cli = agent.cli;
  const installing = busy === "install";
  const bridgeActionAvailable =
    !agent.bridgeSharedWithCli && (!agent.installed || !agent.managed);
  const nextStep =
    agent.taskUnavailableReason ??
    (readiness === "bridge-missing"
      ? t(($) => $.settings.ai.agents.installBridgeNextStep)
      : agent.reason ?? agent.signInHint);
  const cliTitleId = `acp-agent-${agent.definition.id}-cli-title`;
  const bridgeTitleId = `acp-agent-${agent.definition.id}-bridge-title`;
  const nextStepTitleId = `acp-agent-${agent.definition.id}-next-step-title`;
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
        <div className="space-y-4 border-t border-border/70 px-4 py-4">
          {cli && (
            <section aria-labelledby={cliTitleId} className="space-y-3">
              <h5 id={cliTitleId} className="text-xs font-semibold text-foreground">
                {t(($) => $.settings.ai.agents.cliTitle)}
              </h5>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t(($) => $.settings.ai.agents.cliPathLabel)}
                  </dt>
                  <dd className="mt-1 break-all font-mono text-[11px] leading-relaxed text-foreground">
                    {cli.path ??
                      t(($) => $.settings.ai.agents.cliNotOnPath, {
                        command: cli.command,
                      })}
                  </dd>
                </div>
                <div className="min-w-24">
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t(($) => $.settings.ai.agents.versionLabel)}
                  </dt>
                  <dd className="mt-1 text-xs tabular-nums text-foreground">
                    {cli.version ?? t(($) => $.settings.ai.agents.notReported)}
                  </dd>
                </div>
              </dl>
              <div className="space-y-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.settings.ai.agents.signInCommandLabel)}
                </p>
                <div
                  data-testid={`acp-agent-sign-in-command-${agent.definition.id}`}
                  className="flex min-h-12 items-center gap-2 rounded-md border bg-background px-3 py-2.5"
                >
                  <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-foreground">
                    {cli.signInCommand}
                  </code>
                  <CopyValue
                    value={cli.signInCommand}
                    label={t(($) => $.settings.ai.agents.copySignInCommand)}
                  />
                </div>
              </div>
            </section>
          )}
          <section
            aria-labelledby={bridgeTitleId}
            data-testid={`acp-agent-bridge-details-${agent.definition.id}`}
            className={cli ? "space-y-3 border-t border-border/70 pt-4" : "space-y-3"}
          >
            <h5 id={bridgeTitleId} className="text-xs font-semibold text-foreground">
              {t(($) => $.settings.ai.agents.bridgeTitle)}
            </h5>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.settings.ai.agents.bridgePathLabel)}
                </dt>
                <dd className="mt-1 break-all font-mono text-[11px] leading-relaxed text-foreground">
                  {agent.executable ??
                    t(($) => $.settings.ai.agents.bridgeUnresolved)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.settings.ai.agents.versionLabel)}
                </dt>
                <dd className="mt-1 text-xs tabular-nums text-foreground">
                  {agent.installedVersion ?? agent.definition.version}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.settings.ai.agents.bridgeSourceLabel)}
                </dt>
                <dd className="mt-1 text-xs text-foreground">
                  {bridgeSourceLabel(agent)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.settings.ai.agents.platformLabel)}
                </dt>
                <dd className="mt-1 break-all text-xs text-foreground">
                  {agent.platform}
                </dd>
              </div>
            </dl>
          </section>
          {(nextStep || bridgeActionAvailable || (projectId && cli)) && (
            <section
              aria-labelledby={nextStepTitleId}
              className="space-y-2.5 border-t border-border/70 pt-4"
            >
              <h5
                id={nextStepTitleId}
                className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {t(($) => $.settings.ai.agents.nextStepTitle)}
              </h5>
              {nextStep && (
                <p className="text-xs leading-relaxed text-foreground/85">
                  {nextStep}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {bridgeActionAvailable && (
                  <Button
                    type="button"
                    size="sm"
                    data-testid={`acp-agent-install-${agent.definition.id}`}
                    disabled={!!busy || !agent.canInstall}
                    onClick={(event) =>
                      onInstall(agent.definition, event.currentTarget)
                    }
                  >
                    {installing ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    {agent.installed
                      ? t(($) => $.settings.ai.agents.updateBridge)
                      : t(($) => $.settings.ai.agents.installBridge)}
                  </Button>
                )}
                {projectId && cli && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onOpenTerminal}
                  >
                    <Terminal className="size-3.5" />
                    {t(($) => $.settings.ai.agents.openTerminal)}
                  </Button>
                )}
              </div>
            </section>
          )}
          {!agent.definition.builtin && (
            <div className="flex border-t border-border/70 pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!!busy}
                onClick={() => onRemove(agent.definition.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" /> {t(($) => $.common.actions.remove)}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AcpAgentsTab({ projectId }: Readonly<{ projectId?: string | null }>) {
  const { t } = useTranslation(["common", "settings"]);
  const catalog = useAcpSessionsStore((state) => state.catalog);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalogCheckState, setCatalogCheckState] = useState<"checking" | "ready" | "error">("checking");
  const [catalogCheckError, setCatalogCheckError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AcpRegistryEntry[]>([]);
  const [definition, setDefinition] = useState("");
  const [review, setReview] = useState<AcpDefinition | null>(null);
  const reviewOpener = useRef<HTMLElement | null>(null);
  const mounted = useRef(true);
  const catalogCheckRequest = useRef(0);
  const reviewing = review !== null;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!reviewing) return;
    const id = appModalCoordinator.add(reviewOpener.current);
    return () => { appModalCoordinator.remove(id)?.focus({ preventScroll: true }); };
  }, [reviewing]);

  const checkInstalledAgents = useCallback(async (userInitiated = false) => {
    const request = ++catalogCheckRequest.current;
    if (userInitiated) setBusy("preflight");
    setError(null);
    setCatalogCheckError(null);
    setNotice(null);
    setCatalogCheckState("checking");
    try {
      let applied = false;
      while (
        !applied &&
        mounted.current &&
        request === catalogCheckRequest.current
      ) {
        applied = await useAcpSessionsStore.getState().refreshCatalog(true);
      }
      if (!applied) return;
      if (mounted.current && request === catalogCheckRequest.current) {
        setCatalogCheckState("ready");
      }
    } catch (error_) {
      const message = acpError(error_);
      if (mounted.current && request === catalogCheckRequest.current) {
        setCatalogCheckError(message);
        setCatalogCheckState("error");
      }
    } finally {
      if (
        userInitiated &&
        mounted.current &&
        request === catalogCheckRequest.current
      ) {
        setBusy(null);
      }
    }
  }, []);

  useEffect(() => {
    void checkInstalledAgents();
  }, [checkInstalledAgents]);

  const action = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setCatalogCheckError(null);
    setCatalogCheckState((state) => (state === "error" ? "ready" : state));
    setNotice(null);
    try {
      await work();
    } catch (error_) {
      setError(acpError(error_));
    } finally {
      setBusy(null);
    }
  };
  const register = (json: string) =>
    action("register", async () => {
      const registered = await acpRegister(json);
      await useAcpSessionsStore.getState().refreshCatalog();
      setReview(null);
      setNotice(
        t(($) => $.settings.ai.agents.notice.registered, { name: registered.name }),
      );
    });
  const openTerminal = () => {
    if (!projectId) return;
    const terminals = useTerminalsStore.getState();
    terminals.setProject(projectId);
    terminals.addTerminal();
    useSettingsStore.getState().setTerminalOpen(true);
    setNotice(t(($) => $.settings.ai.agents.notice.terminalOpen));
  };
  const packageName =
    review?.distribution.npx?.package ??
    review?.distribution.uvx?.package ??
    review?.distribution.command?.executable ??
    review?.distribution.binary?.[Object.keys(review.distribution.binary ?? {})[0] ?? ""]?.archive ??
    "";

  return (
    <section className="space-y-4" aria-label={t(($) => $.settings.ai.agents.sectionLabel)}>
      <div className="space-y-2">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(($) => $.settings.ai.agents.intro)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={!!busy || catalogCheckState === "checking"}
            onClick={() =>
              void checkInstalledAgents(true)
            }
          >
            {catalogCheckState === "checking" ? (
              <>
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                {t(($) => $.settings.ai.agents.checkingAction)}
              </>
            ) : (
              <>
                <RefreshCw aria-hidden="true" className="size-3.5" />
                {t(($) => $.settings.ai.agents.checkInstalled)}
              </>
            )}
          </Button>
          {projectId && (
            <Button variant="outline" size="sm" type="button" onClick={openTerminal}>
              <Terminal className="size-3.5" /> {t(($) => $.settings.ai.agents.openSignInTerminal)}
            </Button>
          )}
        </div>
      </div>
      {error && !review && (
        <p role="alert" className="rounded-md border border-destructive/40 p-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {catalogCheckError && catalog.length > 0 && !review ? (
        <p role="alert" className="rounded-md border border-destructive/40 p-2 text-xs text-destructive">
          <span className="font-medium">
            {t(($) => $.settings.ai.agents.checkFailedTitle)}
          </span>
          <span className="ml-1">{catalogCheckError}</span>
        </p>
      ) : null}
      {notice && (
        <output
          data-testid="acp-agent-notice"
          className="block rounded-md border p-2 text-xs"
        >
          {notice}
        </output>
      )}

      <div
        className="min-h-72 space-y-2.5"
        data-testid="acp-agent-list"
        aria-busy={catalogCheckState === "checking"}
      >
        {catalog.length > 0 ? (
          <div className="space-y-2.5">
            {catalogCheckState === "checking" && (
              <div
                data-testid="acp-agent-check-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="flex min-h-8 items-center gap-2 px-1 text-xs text-muted-foreground"
              >
                <Loader2
                  aria-hidden="true"
                  className="size-3.5 shrink-0 animate-spin"
                />
                <span>{t(($) => $.settings.ai.agents.refreshingStatus)}</span>
              </div>
            )}
            {catalog.map((agent) => (
              <AgentCard
                key={agent.definition.id}
                agent={agent}
                projectId={projectId}
                busy={busy}
                onInstall={(definition, opener) => {
                  reviewOpener.current = opener;
                  setError(null);
                  setReview(definition);
                }}
                onOpenTerminal={openTerminal}
                onRemove={(agentId) =>
                  void action(agentId, async () => {
                    await acpRemoveAgent(agentId);
                    await useAcpSessionsStore.getState().refreshCatalog();
                    setNotice(t(($) => $.settings.ai.agents.notice.removed));
                  })
                }
              />
            ))}
          </div>
        ) : (
          <div
            data-testid="acp-agent-empty-state"
            role={catalogCheckState === "checking" ? "status" : undefined}
            aria-live={catalogCheckState === "checking" ? "polite" : undefined}
            aria-atomic={catalogCheckState === "checking" ? "true" : undefined}
            className="flex min-h-56 items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6 text-center"
          >
            {catalogCheckState === "checking" ? (
              <Empty className="max-w-sm gap-3">
                <EmptyMedia>
                  <Loader2 aria-hidden="true" className="size-5 animate-spin" />
                </EmptyMedia>
                <div className="space-y-1.5">
                  <EmptyTitle className="text-base">{t(($) => $.settings.ai.agents.checkingTitle)}</EmptyTitle>
                  <EmptyDescription className="text-xs leading-relaxed">
                    {t(($) => $.settings.ai.agents.checkingDescription)}
                  </EmptyDescription>
                </div>
              </Empty>
            ) : catalogCheckState === "error" ? (
              <Empty className="max-w-sm gap-3">
                <EmptyMedia>
                  <RefreshCw aria-hidden="true" className="size-5" />
                </EmptyMedia>
                <div className="space-y-1.5">
                  <EmptyTitle className="text-base">{t(($) => $.settings.ai.agents.checkFailedTitle)}</EmptyTitle>
                  <div role="alert">
                    <EmptyDescription className="text-xs leading-relaxed text-destructive">
                      {catalogCheckError}
                    </EmptyDescription>
                  </div>
                </div>
                <Button variant="outline" size="sm" type="button" onClick={() => void checkInstalledAgents(true)}>
                  <RefreshCw aria-hidden="true" className="size-3.5" />
                  {t(($) => $.settings.ai.agents.checkAgain)}
                </Button>
              </Empty>
            ) : (
              <Empty className="max-w-sm gap-3">
                <EmptyMedia>
                  <Search aria-hidden="true" className="size-5" />
                </EmptyMedia>
                <div className="space-y-1.5">
                  <EmptyTitle className="text-base">{t(($) => $.settings.ai.agents.emptyTitle)}</EmptyTitle>
                  <EmptyDescription className="text-xs leading-relaxed">
                    {t(($) => $.settings.ai.agents.emptyDescription)}
                  </EmptyDescription>
                </div>
              </Empty>
            )}
          </div>
        )}
      </div>

      <Section
        id="registry"
        title={t(($) => $.settings.ai.agents.registry.title)}
        description={t(($) => $.settings.ai.agents.registry.description)}
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
            {t(($) => $.settings.ai.agents.registry.searchLabel)}
          </label>
          <div className="flex gap-2">
            <Input
              id="acp-registry-search"
              className="min-w-0 flex-1 text-xs"
              placeholder={t(($) => $.settings.ai.agents.registry.searchPlaceholder)}
              value={query}
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button variant="outline" size="sm" type="submit" disabled={!!busy}>
              {busy === "search"
                ? t(($) => $.settings.ai.agents.registry.searching)
                : t(($) => $.settings.ai.agents.registry.search)}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(($) => $.settings.ai.agents.registry.reviewHint)}
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
        title={t(($) => $.settings.ai.agents.custom.title)}
        description={t(($) => $.settings.ai.agents.custom.description)}
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
            {t(($) => $.settings.ai.agents.custom.label)}
          </label>
          <p className="text-xs text-muted-foreground">
            {t(($) => $.settings.ai.agents.custom.hint)}
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
              {t(($) => $.settings.ai.agents.custom.submit)}
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setDefinition(example)}
            >
              {t(($) => $.settings.ai.agents.custom.useExample)}
            </Button>
          </div>
        </form>
      </Section>

      <Dialog open={reviewing} onOpenChange={(open) => { if (!open && !busy) setReview(null); }}>
        <DialogContent
          className="z-[120] max-w-md"
          overlayClassName="z-[120]"
          closeDisabled={!!busy}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle>
              {t(($) => $.settings.ai.agents.install.title, {
                name: review?.name ?? "",
                version: review?.version ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t(($) => $.settings.ai.agents.install.description)}
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 rounded-md border bg-muted/30 p-2.5 text-xs">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">
                {t(($) => $.settings.ai.agents.install.packageLabel)}
              </dt>
              <dd className="min-w-0 break-all font-mono text-[11px]">{packageName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">
                {t(($) => $.settings.ai.agents.install.locationLabel)}
              </dt>
              <dd className="min-w-0 break-all font-mono text-[11px]">
                {t(($) => $.settings.ai.agents.install.location, {
                  id: review?.id ?? "",
                  version: review?.version ?? "",
                })}
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
              {t(($) => $.common.actions.cancel)}
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
                  setNotice(
                    t(($) => $.settings.ai.agents.notice.installed, { name: review.name }),
                  );
                  setReview(null);
                })
              }
            >
              {busy === "install" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {busy === "install"
                ? t(($) => $.settings.ai.agents.install.installing)
                : t(($) => $.settings.ai.agents.install.confirm)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
