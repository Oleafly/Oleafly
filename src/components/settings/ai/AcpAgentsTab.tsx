import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
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
import { CollapsibleSection } from "@/components/ui/collapsible-section";
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
import { PrivatePath, PrivateText } from "@/components/ui/private";
import { useDisplayText } from "@/lib/display-path";
import {
  acpError,
  acpInstall,
  acpReadiness,
  acpRegister,
  acpRegistrySearch,
  acpRemoveAgent,
  type AcpAgentStatus,
  type AcpDefinition,
  type AcpReadiness,
  type AcpRegistryEntry,
} from "@/lib/acp";
import { AgentProgramField, CopyDetailsButton, programPlacement } from "./AgentProgramField";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { useSettingsStore } from "@/store/settings";
import { useTerminalsStore } from "@/store/terminals";
import { i18n } from "@/i18n";

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
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedLabel = t(($) => $.common.actions.copied);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  return (
    <Tooltip label={copied ? copiedLabel : label}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={
          copied
            ? "size-8 shrink-0 text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400"
            : "size-8 shrink-0"
        }
        aria-label={copied ? copiedLabel : label}
        data-copied={copied ? "true" : undefined}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => {
              if (resetTimer.current) clearTimeout(resetTimer.current);
              setCopied(true);
              resetTimer.current = setTimeout(() => {
                setCopied(false);
                resetTimer.current = null;
              }, 1500);
            })
            .catch(() => setCopied(false));
        }}
      >
        {copied ? (
          <Check aria-hidden="true" className="size-3.5" />
        ) : (
          <Copy aria-hidden="true" className="size-3.5" />
        )}
        <span aria-live="polite" className="sr-only">
          {copied ? copiedLabel : ""}
        </span>
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
  builtIn,
  busy,
  onRegister,
  onShow,
}: Readonly<{
  entry: AcpRegistryEntry;
  registered: boolean;
  /** The entry is one of Oleafly's built-in agents, which is already on the list. */
  builtIn: boolean;
  busy: boolean;
  onRegister: (definition: AcpDefinition) => void;
  onShow: () => void;
}>) {
  const { t } = useTranslation(["settings", "ai"]);
  const [shown, setShown] = useState(false);
  return (
    <article className="space-y-2 rounded-md border bg-background p-3">
      <h4 className="text-sm font-medium">
        {entry.name} <span className="font-normal text-muted-foreground">{entry.version}</span>
        {builtIn && (
          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium text-muted-foreground">
            {t(($) => $.ai.acp.setup.builtIn)}
          </span>
        )}
      </h4>
      <p className="text-xs text-muted-foreground">{entry.description}</p>
      {entry.reason && !builtIn && <p className="text-xs text-muted-foreground">{entry.reason}</p>}
      <div className="flex flex-wrap gap-2">
        {builtIn ? (
          <Button type="button" variant="outline" size="sm" onClick={onShow}>
            {t(($) => $.ai.acp.setup.showAgent)}
          </Button>
        ) : (
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
        )}
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

/** The one setup step for a card, before any sign-in hint. */
function nextStepText(
  agent: AcpAgentStatus,
  readiness: AcpReadiness,
  installStep: string,
  installBlocked: string,
): string | null {
  if (readiness === "bridge-missing") return agent.canInstall ? installStep : agent.reason ?? installBlocked;
  if (readiness === "cli-missing" && agent.cli) {
    return i18n.t(($) => $.ai.acp.setup.cliMissingNextStep, { cli: agent.cli.displayName });
  }
  return agent.reason ?? agent.signInHint;
}

function AgentCard({
  agent,
  projectId,
  busy,
  focusToken = 0,
  retestToken = 0,
  onInstall,
  onRemove,
  onOpenTerminal,
  onStatus,
}: Readonly<{
  agent: AcpAgentStatus;
  projectId?: string | null;
  busy: string | null;
  /** Changes when this card should expand and scroll into view. */
  focusToken?: number;
  /** Changes after this agent's bridge was installed. */
  retestToken?: number;
  onInstall: (definition: AcpDefinition, opener: HTMLButtonElement) => void;
  onRemove: (agentId: string) => void;
  onOpenTerminal: () => void;
  onStatus: (status: AcpAgentStatus) => void;
}>) {
  const { t } = useTranslation(["common", "settings", "ai"]);
  // The agent's own reason can name files; show the home folder as ~.
  const displayText = useDisplayText();
  const [open, setOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const readiness = acpReadiness(agent);
  const cli = agent.cli;
  const id = agent.definition.id;
  const installing = busy === "install";
  const placement = programPlacement(agent);
  const bridgeActionAvailable =
    !agent.bridgeSharedWithCli && (!agent.installed || !agent.managed);
  const installBlocked = bridgeActionAvailable && !agent.canInstall
    ? agent.reason ?? t(($) => $.ai.acp.setup.installUnavailable)
    : null;
  const nextStep = nextStepText(
    agent,
    readiness,
    t(($) => $.settings.ai.agents.installBridgeNextStep),
    t(($) => $.ai.acp.setup.installUnavailable),
  );
  const cliTitleId = `acp-agent-${id}-cli-title`;
  const nextStepTitleId = `acp-agent-${id}-next-step-title`;
  const installReasonId = `acp-agent-${id}-install-reason`;

  useEffect(() => {
    if (!focusToken) return;
    setOpen(true);
    const frame = window.requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ block: "start" });
      toggleRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusToken]);

  const programField = (fieldPlacement: "main" | "bridge") => (
    <AgentProgramField
      agent={agent}
      placement={fieldPlacement}
      disabled={!!busy}
      retestToken={retestToken}
      onStatus={onStatus}
      onInstallBridge={
        bridgeActionAvailable ? (opener) => onInstall(agent.definition, opener) : undefined
      }
      onOpenTerminal={projectId ? onOpenTerminal : undefined}
    />
  );

  return (
    <div
      ref={cardRef}
      data-testid={`acp-agent-card-${id}`}
      className="scroll-mt-2 rounded-lg border bg-card transition-colors"
    >
      <div className="flex items-start gap-2 p-3">
        <button
          ref={toggleRef}
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
              <AgentLogo agentId={id} size={18} />
              <h4 className="text-sm font-medium">{agent.definition.name}</h4>
            </span>
            <span className="mt-0.5 block break-words text-xs leading-relaxed text-muted-foreground">
              <PrivateText text={readinessDetail(agent, readiness)} focusable={false} />
            </span>
          </span>
        </button>
        <div className="mt-0.5 shrink-0">
          <ReadinessBadge readiness={readiness} />
        </div>
      </div>
      {open && (
        <div className="space-y-4 border-t border-border/70 px-4 py-4">
          {!cli && placement === "main" && programField("main")}
          {cli && (
            <section aria-labelledby={cliTitleId} className="space-y-3">
              <h5 id={cliTitleId} className="text-xs font-semibold text-foreground">
                {t(($) => $.settings.ai.agents.cliTitle)}
              </h5>
              {placement === "main" ? (
                <div className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  {programField("main")}
                  <dl className="min-w-24">
                    <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t(($) => $.settings.ai.agents.versionLabel)}
                    </dt>
                    <dd className="mt-1 text-xs tabular-nums text-foreground">
                      {cli.version ?? t(($) => $.settings.ai.agents.notReported)}
                    </dd>
                  </dl>
                </div>
              ) : (
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t(($) => $.settings.ai.agents.cliPathLabel)}
                    </dt>
                    <dd className="mt-1 break-all font-mono text-[11px] leading-relaxed text-foreground">
                      {cli.path
                        ? <PrivatePath path={cli.path} />
                        : t(($) => $.settings.ai.agents.program.notFound)}
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
              )}
              <div className="space-y-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.settings.ai.agents.signInCommandLabel)}
                </p>
                <div
                  data-testid={`acp-agent-sign-in-command-${id}`}
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
          <CollapsibleSection
            id={`acp-agent-bridge-details-${id}`}
            title={t(($) => $.settings.ai.agents.bridgeTitle)}
            headingLevel="h4"
            className="bg-background/40"
          >
            <dl className="grid grid-cols-3 gap-x-4 gap-y-3">
              <div className="col-span-3 min-w-0">
                <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.settings.ai.agents.bridgePathLabel)}
                </dt>
                <dd className="mt-1 break-all font-mono text-[11px] leading-relaxed text-foreground">
                  {agent.executable
                    ? <PrivatePath path={agent.executable} />
                    : t(($) => $.settings.ai.agents.bridgeUnresolved)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.settings.ai.agents.versionLabel)}
                </dt>
                <dd className="mt-1 text-xs tabular-nums text-foreground">
                  {agent.installedVersion ?? agent.definition.version}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.settings.ai.agents.platformLabel)}
                </dt>
                <dd className="mt-1 break-all text-xs text-foreground">
                  {agent.platform}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.settings.ai.agents.bridgeSourceLabel)}
                </dt>
                <dd className="mt-1 text-xs text-foreground">
                  {bridgeSourceLabel(agent)}
                </dd>
              </div>
            </dl>
            {placement === "bridge" && (
              <div className="border-t border-border/70 pt-3">{programField("bridge")}</div>
            )}
          </CollapsibleSection>
          {(nextStep || bridgeActionAvailable || (projectId && cli) || agent.taskUnavailableReason) && (
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
                <p
                  id={nextStep === installBlocked ? installReasonId : undefined}
                  className="text-xs leading-relaxed text-foreground/85"
                >
                  <PrivateText text={displayText(nextStep)} />
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {bridgeActionAvailable && (
                  <Button
                    type="button"
                    size="sm"
                    data-testid={`acp-agent-install-${id}`}
                    disabled={!!busy || !agent.canInstall}
                    aria-describedby={installBlocked ? installReasonId : undefined}
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
              {installBlocked && installBlocked !== nextStep && (
                <p id={installReasonId} className="text-[11px] leading-relaxed text-muted-foreground">
                  <PrivateText text={displayText(installBlocked)} />
                </p>
              )}
              {agent.taskUnavailableReason && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t(($) => $.ai.acp.setup.backgroundTasks, { reason: agent.taskUnavailableReason })}
                </p>
              )}
            </section>
          )}
          {!agent.definition.builtin && (
            <div className="flex border-t border-border/70 pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!!busy}
                onClick={() => onRemove(id)}
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

type CatalogCheckState = "checking" | "ready" | "error";

function AgentCatalogEmptyState({
  state,
  error,
  onRetry,
}: Readonly<{
  state: CatalogCheckState;
  error: string | null;
  onRetry: () => void;
}>) {
  const { t } = useTranslation(["settings"]);
  if (state === "checking") {
    return (
      <Empty className="max-w-sm gap-3">
        <EmptyMedia>
          <Loader2 aria-hidden="true" className="size-5 animate-spin" />
        </EmptyMedia>
        <div className="space-y-1.5">
          <EmptyTitle className="text-base">
            {t(($) => $.settings.ai.agents.checkingTitle)}
          </EmptyTitle>
          <EmptyDescription className="text-xs leading-relaxed">
            {t(($) => $.settings.ai.agents.checkingDescription)}
          </EmptyDescription>
        </div>
      </Empty>
    );
  }
  if (state === "error") {
    return (
      <Empty className="max-w-sm gap-3">
        <EmptyMedia>
          <RefreshCw aria-hidden="true" className="size-5" />
        </EmptyMedia>
        <div className="space-y-1.5">
          <EmptyTitle className="text-base">
            {t(($) => $.settings.ai.agents.checkFailedTitle)}
          </EmptyTitle>
          <div role="alert">
            <EmptyDescription className="text-xs leading-relaxed text-destructive">
              {error}
            </EmptyDescription>
          </div>
        </div>
        <Button variant="outline" size="sm" type="button" onClick={onRetry}>
          <RefreshCw aria-hidden="true" className="size-3.5" />
          {t(($) => $.settings.ai.agents.checkAgain)}
        </Button>
      </Empty>
    );
  }
  return (
    <Empty className="max-w-sm gap-3">
      <EmptyMedia>
        <Search aria-hidden="true" className="size-5" />
      </EmptyMedia>
      <div className="space-y-1.5">
        <EmptyTitle className="text-base">
          {t(($) => $.settings.ai.agents.emptyTitle)}
        </EmptyTitle>
        <EmptyDescription className="text-xs leading-relaxed">
          {t(($) => $.settings.ai.agents.emptyDescription)}
        </EmptyDescription>
      </div>
    </Empty>
  );
}

export interface AcpAgentsTabProps {
  projectId?: string | null;
  /** An agent whose card should expand and scroll into view (a settings deep link). */
  focusAgentId?: string | null;
  /** Changes on every deep link, so the same agent can be requested again. */
  focusToken?: number;
  /**
   * Called with `focusToken` once the card focus is applied. The host drops the
   * link then, so remounting this tab (the tab is unmounted while another AI
   * tab is shown) does not expand, scroll and focus the card again.
   */
  onFocusHandled?: (token: number) => void;
}

/** Puts one agent's fresh status into the shared catalog without a full re-check. */
function applyAgentStatus(status: AcpAgentStatus) {
  useAcpSessionsStore.setState((state) => ({
    catalog: state.catalog.map((agent) =>
      agent.definition.id === status.definition.id ? status : agent,
    ),
  }));
}

export function AcpAgentsTab({
  projectId,
  focusAgentId,
  focusToken = 0,
  onFocusHandled,
}: Readonly<AcpAgentsTabProps>) {
  const { t } = useTranslation(["common", "settings"]);
  const catalog = useAcpSessionsStore((state) => state.catalog);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalogCheckState, setCatalogCheckState] = useState<CatalogCheckState>("checking");
  const [catalogCheckError, setCatalogCheckError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AcpRegistryEntry[]>([]);
  const [definition, setDefinition] = useState("");
  const [review, setReview] = useState<AcpDefinition | null>(null);
  // Every review mounts a fresh dialog. Reopened while the last one is still
  // animating out, Radix would reuse that content: nothing inside takes focus,
  // and the press that reopened it counts as a press outside and closes it.
  const [reviewKey, setReviewKey] = useState(0);
  const reviewOpener = useRef<HTMLElement | null>(null);
  const [focus, setFocus] = useState<{ id: string; token: number } | null>(null);
  const focusSeq = useRef(0);
  const [retest, setRetest] = useState<Record<string, number>>({});
  const mounted = useRef(true);
  const catalogCheckRequest = useRef(0);
  const reviewing = review !== null;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const focusAgent = useCallback((agentId: string) => {
    focusSeq.current += 1;
    setFocus({ id: agentId, token: focusSeq.current });
  }, []);
  const onFocusHandledRef = useRef(onFocusHandled);
  onFocusHandledRef.current = onFocusHandled;
  useEffect(() => {
    if (!focusAgentId || !focusToken) return;
    focusAgent(focusAgentId);
    onFocusHandledRef.current?.(focusToken);
  }, [focusAgent, focusAgentId, focusToken]);
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
        <p role="alert" className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 p-2 text-xs text-destructive">
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
                focusToken={focus?.id === agent.definition.id ? focus.token : 0}
                retestToken={retest[agent.definition.id] ?? 0}
                onStatus={applyAgentStatus}
                onInstall={(definition, opener) => {
                  reviewOpener.current = opener;
                  setError(null);
                  setReview(definition);
                  setReviewKey((key) => key + 1);
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
            <AgentCatalogEmptyState
              state={catalogCheckState}
              error={catalogCheckError}
              onRetry={() => void checkInstalledAgents(true)}
            />
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
                builtIn={
                  !!entry.builtinId &&
                  catalog.some((agent) => agent.definition.id === entry.builtinId && agent.definition.builtin)
                }
                onRegister={(value) => void register(JSON.stringify(value))}
                onShow={() => {
                  if (entry.builtinId) focusAgent(entry.builtinId);
                }}
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
          key={reviewKey}
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
            <div className="space-y-2">
              <p
                role="alert"
                className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-destructive/40 p-2 text-xs text-destructive"
              >
                {error}
              </p>
              <CopyDetailsButton text={error} />
            </div>
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
                  setRetest((value) => ({ ...value, [review.id]: (value[review.id] ?? 0) + 1 }));
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
