import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Download, ExternalLink, FolderOpen, Loader2, Play, RotateCcw, Terminal } from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Input } from "@/components/ui/input";
import { fileName, isPowerShellScript } from "@/components/ai/acp/agent-copy";
import { i18n } from "@/i18n";
import {
  acpCheckAgent,
  acpError,
  acpPickAgentProgram,
  acpSetAgentProgram,
  type AcpAgentCheck,
  type AcpAgentStatus,
  type AcpCheckCode,
  type AcpRejectReason,
} from "@/lib/acp";
import { decodeAppError, describeError } from "@/lib/app-error";
import { isWindows } from "@/lib/utils";

export const NODE_DOWNLOAD_URL = "https://nodejs.org/en/download";

/** Where an agent's Program row lives: on the card, or inside the collapsed bridge details. */
export type ProgramPlacement = "main" | "bridge";

/**
 * Native agents, Pi and custom agents choose the program on the card. Bridged
 * vendor CLIs (the bridge ships its own copy) keep the choice in the bridge
 * details. A built-in without a vendor CLI has nothing to choose.
 */
export function programPlacement(agent: AcpAgentStatus): ProgramPlacement | null {
  if (!agent.definition.builtin) return "main";
  if (!agent.cli) return null;
  if (agent.bridgeSharedWithCli || agent.cliRequired) return "main";
  return "bridge";
}

/** Codes the file check itself rejects: saving such a file fails too. */
const INSPECT_CODES = new Set<AcpCheckCode>([
  "not_found", "is_directory", "unsupported_script", "not_executable", "gui_program", "interpreter", "network_path",
]);
const NODE_CODES = new Set<AcpCheckCode>(["node_missing", "node_too_old"]);
const RUN_CODES = new Set<AcpCheckCode>(["start_failed", "timeout", "exited", "not_acp"]);

/** `acp.program.<reason>` error codes from saving a program, mapped to check codes. */
const PROGRAM_ERROR_CODES: Record<string, AcpCheckCode> = {
  not_found: "not_found",
  is_directory: "is_directory",
  directory: "is_directory",
  not_executable: "not_executable",
  unsupported_script: "unsupported_script",
  power_shell_script: "unsupported_script",
  powershell_script: "unsupported_script",
  gui_program: "gui_program",
  interpreter: "interpreter",
  network_path: "network_path",
};

function stem(path: string): string {
  return fileName(path).replace(/\.[^.]+$/, "");
}

function commandName(agent: AcpAgentStatus, path: string | null): string {
  return agent.cli?.command ?? (path ? stem(path) : agent.definition.id);
}

/** The sentence shown for a check result, keyed by its code. */
export function checkMessage(agent: AcpAgentStatus, check: AcpAgentCheck, candidate: string | null): string {
  const name = agent.definition.name;
  const cli = agent.cli?.displayName ?? name;
  const path = check.program ?? candidate;
  const shown = path ?? name;
  const command = commandName(agent, path);
  switch (check.code) {
    case "ready":
      return check.version
        ? i18n.t(($) => $.settings.ai.agents.program.check.ready, { name, version: check.version })
        : i18n.t(($) => $.settings.ai.agents.program.check.readyNoVersion, { name });
    case "not_found":
      return path
        ? i18n.t(($) => $.settings.ai.agents.program.check.notFound, { path })
        : i18n.t(($) => $.ai.acp.setup.cliNotFound, { cli });
    case "is_directory":
      return i18n.t(($) => $.settings.ai.agents.program.check.isDirectory, { path: shown });
    case "unsupported_script":
      return path && !isPowerShellScript(path)
        ? i18n.t(($) => $.settings.ai.agents.program.check.unsupportedScript, { file: fileName(path), command })
        : i18n.t(($) => $.settings.ai.agents.program.check.powershellScript, { command });
    case "not_executable":
      return i18n.t(($) => $.settings.ai.agents.program.check.notExecutable, { path: shown });
    case "gui_program":
      return i18n.t(($) => $.settings.ai.agents.program.check.guiProgram, { path: shown });
    case "interpreter":
      return i18n.t(($) => $.settings.ai.agents.program.check.interpreter, { path: shown, name });
    case "network_path":
      return i18n.t(($) => $.settings.ai.agents.program.check.networkPath, { path: shown });
    case "cli_missing":
      return i18n.t(($) => $.settings.ai.agents.program.check.cliMissing, { cli });
    case "bridge_missing":
      return i18n.t(($) => $.settings.ai.agents.program.check.bridgeMissing, { name });
    case "node_missing":
      return i18n.t(($) => $.settings.ai.agents.program.check.nodeMissing, { name });
    case "node_too_old":
      return i18n.t(($) => $.settings.ai.agents.program.check.nodeTooOld, { name });
    case "timeout":
      return i18n.t(($) => $.settings.ai.agents.program.check.timeout, { name });
    case "exited":
      return i18n.t(($) => $.settings.ai.agents.program.check.exited, { name });
    case "not_acp":
      return i18n.t(($) => $.settings.ai.agents.program.check.notAcp, { name });
    default:
      return i18n.t(($) => $.settings.ai.agents.program.check.startFailed, { name });
  }
}

function skippedReasonLabel(reason: AcpRejectReason): string {
  switch (reason) {
    case "not_found":
      return i18n.t(($) => $.settings.ai.agents.program.skippedReason.notFound);
    case "is_directory":
      return i18n.t(($) => $.settings.ai.agents.program.skippedReason.isDirectory);
    case "not_executable":
      return i18n.t(($) => $.settings.ai.agents.program.skippedReason.notExecutable);
    case "unsupported_script":
      return i18n.t(($) => $.settings.ai.agents.program.skippedReason.unsupportedScript);
    case "gui_program":
      return i18n.t(($) => $.settings.ai.agents.program.skippedReason.guiProgram);
    case "interpreter":
      return i18n.t(($) => $.settings.ai.agents.program.skippedReason.interpreter);
    default:
      return i18n.t(($) => $.settings.ai.agents.program.skippedReason.networkPath);
  }
}

/** A copy of a Windows "Copy as path" value arrives wrapped in quotes. */
function cleanTypedPath(value: string): string {
  return value.trim().replace(/^"(.*)"$/, "$1").trim();
}

type Translate = ReturnType<typeof useTranslation<["common", "settings", "ai"]>>["t"];

/** The file the row shows: the override, else what was detected. The bridge row has no detected file. */
function programPath(agent: AcpAgentStatus, placement: ProgramPlacement, override: string | null): string | null {
  if (override) return override;
  if (placement === "bridge") return null;
  return agent.cli ? agent.cli.path : agent.executable;
}

/** Where the shown file came from, or null when there is none. */
function programSource(t: Translate, agent: AcpAgentStatus, override: string | null, path: string | null): string | null {
  if (override || agent.cli?.source === "override") return t(($) => $.settings.ai.agents.program.source.override);
  if (path && !agent.cli && agent.managed) return t(($) => $.settings.ai.agents.program.source.managed);
  if (path) return t(($) => $.settings.ai.agents.program.source.auto);
  return null;
}

export function CopyDetailsButton({ text, className }: Readonly<{ text: string; className?: string }>) {
  const { t } = useTranslation(["common", "settings"]);
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      data-copied={copied ? "true" : undefined}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
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
      {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
      {copied ? t(($) => $.common.actions.copied) : t(($) => $.settings.ai.agents.program.copyDetails)}
    </Button>
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "picking" }
  | { kind: "checking"; candidate: string | null }
  | { kind: "saving"; candidate: string | null }
  | { kind: "result"; candidate: string | null; check: AcpAgentCheck; saved: boolean }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export interface AgentProgramFieldProps {
  agent: AcpAgentStatus;
  placement: ProgramPlacement;
  /** Another action on the card is running. */
  disabled?: boolean;
  /** Changes after the bridge install that a failed check asked for, to test again. */
  retestToken?: number;
  /** Receives the agent status after a program was saved or cleared. */
  onStatus: (status: AcpAgentStatus) => void;
  onInstallBridge?: (opener: HTMLButtonElement) => void;
  onOpenTerminal?: () => void;
}

/**
 * The Program row: the file Oleafly starts for an agent, where it came from,
 * Choose… and Test. A chosen or typed file is tested before it is saved.
 */
export function AgentProgramField({
  agent,
  placement,
  disabled = false,
  retestToken = 0,
  onStatus,
  onInstallBridge,
  onOpenTerminal,
}: Readonly<AgentProgramFieldProps>) {
  const { t } = useTranslation(["common", "settings", "ai"]);
  const id = agent.definition.id;
  const name = agent.definition.name;
  const cli = agent.cli;
  const inputId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [typed, setTyped] = useState("");
  const retestCandidate = useRef<{ candidate: string | null } | null>(null);
  const busy = phase.kind === "picking" || phase.kind === "checking" || phase.kind === "saving";
  const locked = busy || disabled;

  const override = agent.programOverride ?? null;
  const path = programPath(agent, placement, override);
  const source = programSource(t, agent, override, path);
  const showInput = placement === "main" && !path;
  const command = commandName(agent, path);
  const example = isWindows ? `C:\\Tools\\${command}.exe` : `/usr/local/bin/${command}`;
  const rejected = cli?.rejected ?? [];

  const failure = (error: unknown, candidate: string | null): Phase => {
    const app = decodeAppError(error);
    if (app?.code.startsWith("acp.program.")) {
      const code = PROGRAM_ERROR_CODES[app.code.slice("acp.program.".length)];
      if (code) {
        return {
          kind: "result",
          candidate,
          saved: false,
          check: { ok: false, code, detail: app.detail, program: app.params.path ?? candidate, version: null, agentName: null },
        };
      }
    }
    return { kind: "error", message: app ? describeError(error) : acpError(error) };
  };

  const save = async (candidate: string, check: AcpAgentCheck | null) => {
    setPhase({ kind: "saving", candidate });
    try {
      const status = await acpSetAgentProgram(id, candidate);
      onStatus(status);
      setTyped("");
      setPhase(check ? { kind: "result", candidate, check, saved: true } : { kind: "saved" });
    } catch (error) {
      setPhase(failure(error, candidate));
    }
  };

  const runCheck = async (candidate: string | null) => {
    setPhase({ kind: "checking", candidate });
    try {
      const check = await acpCheckAgent(id, candidate);
      if (check.ok && candidate) {
        await save(candidate, check);
        return;
      }
      setPhase({ kind: "result", candidate, check, saved: false });
    } catch (error) {
      setPhase(failure(error, candidate));
    }
  };
  const runCheckRef = useRef(runCheck);
  runCheckRef.current = runCheck;

  useEffect(() => {
    const pending = retestCandidate.current;
    if (!retestToken || !pending) return;
    retestCandidate.current = null;
    void runCheckRef.current(pending.candidate);
  }, [retestToken]);

  const choose = async () => {
    setPhase({ kind: "picking" });
    try {
      const picked = await acpPickAgentProgram(id);
      if (!picked) {
        setPhase({ kind: "idle" });
        return;
      }
      await runCheck(picked);
    } catch (error) {
      setPhase(failure(error, null));
    }
  };

  const resetToAutomatic = async () => {
    setPhase({ kind: "saving", candidate: null });
    try {
      onStatus(await acpSetAgentProgram(id, null));
      setPhase({ kind: "idle" });
    } catch (error) {
      setPhase(failure(error, null));
    }
  };

  const test = () => {
    const candidate = showInput ? cleanTypedPath(typed) : "";
    void runCheck(candidate || null);
  };

  const label =
    placement === "bridge" && cli
      ? t(($) => $.settings.ai.agents.program.bridgeLabel, { cli: cli.displayName })
      : t(($) => $.settings.ai.agents.program.label);
  let valueText = path;
  if (!valueText) {
    valueText = placement === "bridge"
      ? t(($) => $.settings.ai.agents.program.bridgeDefault)
      : t(($) => $.settings.ai.agents.program.notFound);
  }

  return (
    <div data-testid={`acp-agent-program-${id}`} className="min-w-0 space-y-2">
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={path ? "mt-1 break-all font-mono text-[11px] leading-relaxed text-foreground" : "mt-1 text-xs leading-relaxed text-muted-foreground"}>
          {valueText}
        </p>
        {source && <p className="text-[11px] leading-relaxed text-muted-foreground">{source}</p>}
      </div>
      {showInput && (
        <form
          className="space-y-1"
          onSubmit={(event) => {
            event.preventDefault();
            const candidate = cleanTypedPath(typed);
            if (candidate && !locked) void runCheck(candidate);
          }}
        >
          <label htmlFor={inputId} className="block text-xs font-medium">
            {t(($) => $.settings.ai.agents.program.inputLabel, { name })}
          </label>
          <Input
            id={inputId}
            data-testid={`acp-agent-program-input-${id}`}
            className="h-8 font-mono text-xs focus-visible:border-ring"
            value={typed}
            maxLength={4096}
            spellCheck={false}
            autoComplete="off"
            placeholder={t(($) => $.settings.ai.agents.program.pathPlaceholder, { example })}
            disabled={locked}
            onChange={(event) => setTyped(event.target.value)}
          />
        </form>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={`acp-agent-program-choose-${id}`}
          disabled={locked}
          onClick={() => void choose()}
        >
          <FolderOpen className="size-3.5" />
          {t(($) => $.settings.ai.agents.program.choose)}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={`acp-agent-program-test-${id}`}
          disabled={locked}
          onClick={test}
        >
          {phase.kind === "checking" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          {phase.kind === "checking"
            ? t(($) => $.settings.ai.agents.program.testing)
            : t(($) => $.settings.ai.agents.program.test)}
        </Button>
        {override && (
          <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => void resetToAutomatic()}>
            <RotateCcw className="size-3.5" />
            {t(($) => $.settings.ai.agents.program.useAutomatic)}
          </Button>
        )}
        {phase.kind === "saving" && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            {t(($) => $.settings.ai.agents.program.saving)}
          </span>
        )}
      </div>
      <ProgramResult
        agent={agent}
        phase={phase}
        locked={locked}
        onChoose={() => void choose()}
        onUseAnyway={(candidate) => void save(candidate, null)}
        onInstallBridge={
          onInstallBridge
            ? (opener, candidate) => {
                retestCandidate.current = { candidate };
                onInstallBridge(opener);
              }
            : undefined
        }
        onOpenTerminal={onOpenTerminal}
      />
      {rejected.length > 0 && (
        <CollapsibleSection
          id={`acp-agent-skipped-${id}`}
          title={t(($) => $.settings.ai.agents.program.skippedTitle)}
          headingLevel="h4"
          className="bg-background/40"
        >
          <ul aria-label={t(($) => $.settings.ai.agents.program.skippedTitle)} className="space-y-1.5">
            {rejected.map((candidate) => (
              <li key={`${candidate.path}:${candidate.reason}`} className="min-w-0 text-[11px] leading-relaxed">
                <span className="block break-all font-mono text-foreground">{candidate.path}</span>
                <span className="block text-muted-foreground">{skippedReasonLabel(candidate.reason)}</span>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}
    </div>
  );
}

function ProgramResult({
  agent,
  phase,
  locked,
  onChoose,
  onUseAnyway,
  onInstallBridge,
  onOpenTerminal,
}: Readonly<{
  agent: AcpAgentStatus;
  phase: Phase;
  locked: boolean;
  onChoose: () => void;
  onUseAnyway: (candidate: string) => void;
  onInstallBridge?: (opener: HTMLButtonElement, candidate: string | null) => void;
  onOpenTerminal?: () => void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const testId = `acp-agent-program-result-${agent.definition.id}`;
  if (phase.kind === "saved") {
    return (
      <output aria-live="polite" data-testid={testId} className="block text-xs leading-relaxed text-foreground/85">
        {t(($) => $.settings.ai.agents.program.saved)}
      </output>
    );
  }
  if (phase.kind === "error") {
    return (
      <p role="alert" data-testid={testId} className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 p-2 text-xs text-destructive">
        {phase.message}
      </p>
    );
  }
  if (phase.kind !== "result") return null;
  const { check, candidate } = phase;
  const message = checkMessage(agent, check, candidate);
  if (check.ok) {
    return (
      <div data-testid={testId} className="space-y-1">
        <output aria-live="polite" className="flex items-start gap-1.5 text-xs leading-relaxed text-emerald-700 dark:text-emerald-400">
          <Check aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{message}</span>
        </output>
        {agent.signInHint && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">{agent.signInHint}</p>
        )}
      </div>
    );
  }
  const code = check.code;
  const showDetail = !!check.detail && !INSPECT_CODES.has(code);
  const details = [message, check.program ?? candidate, check.detail].filter(Boolean).join("\n");
  const canUseAnyway = !!candidate && !INSPECT_CODES.has(code) && !phase.saved;
  return (
    <div data-testid={testId} className="space-y-2 rounded-md border border-destructive/40 p-2">
      <p role="alert" className="break-words text-xs leading-relaxed text-destructive">
        {message}
      </p>
      {showDetail && (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
          {check.detail}
        </pre>
      )}
      {code === "bridge_missing" && !onInstallBridge && agent.reason && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{agent.reason}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {(INSPECT_CODES.has(code) || code === "cli_missing") && (
          <Button type="button" size="sm" disabled={locked} onClick={onChoose}>
            <FolderOpen className="size-3.5" />
            {t(($) => $.settings.ai.agents.program.choose)}
          </Button>
        )}
        {code === "bridge_missing" && onInstallBridge && (
          <Button
            type="button"
            size="sm"
            disabled={locked || !agent.canInstall}
            onClick={(event) => onInstallBridge(event.currentTarget, candidate)}
          >
            <Download className="size-3.5" />
            {t(($) => $.settings.ai.agents.installBridge)}
          </Button>
        )}
        {NODE_CODES.has(code) && (
          <Button type="button" size="sm" onClick={() => void openExternal(NODE_DOWNLOAD_URL)}>
            <ExternalLink className="size-3.5" />
            {t(($) => $.settings.ai.agents.program.getNode)}
          </Button>
        )}
        {RUN_CODES.has(code) && (
          <>
            <CopyDetailsButton text={details} />
            {onOpenTerminal && (
              <Button type="button" variant="outline" size="sm" onClick={onOpenTerminal}>
                <Terminal className="size-3.5" />
                {t(($) => $.settings.ai.agents.openTerminal)}
              </Button>
            )}
          </>
        )}
        {canUseAnyway && (
          <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => onUseAnyway(candidate)}>
            {t(($) => $.settings.ai.agents.program.useAnyway)}
          </Button>
        )}
      </div>
    </div>
  );
}
