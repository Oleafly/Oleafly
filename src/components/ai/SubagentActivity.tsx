// Live sub-agent activity: chips with seeded avatars derived from the turn
// record's subAgentActivity items (in arrival order), an expandable per-agent
// detail line, the agent's full transcript from its rollout thread, and a
// Stop-all affordance that interrupts the children without stopping the run.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  ShieldAlert,
  Square,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { subagentDisplayStatus } from "@oleafly/ai-core";
import { i18n } from "@/i18n";
import type { TurnRecord } from "@oleafly/ai-core";
import { useAgentTurnsStore } from "@/store/agent-turns";
import { agentSubagentsStop, agentThreadRead } from "@/lib/agent-backend";
import { acpEvents, type AcpEvent } from "@/lib/acp";
import { projectAcpEvents } from "@/components/ai/acp/projection";
import { splitAgentNotices } from "@/lib/chat-activity";
import { MessageItem } from "@/components/ai/chat-parts";
import type { RenderedMessage } from "@/components/ai/MessageList";
import { cn } from "@/lib/utils";

const EMPTY_RECORDS: TurnRecord[] = [];

interface AgentState {
  id: string;
  label: string;
  kind: string;
  detail: string | null;
  events: number;
  runtime: "built-in" | "acp" | null;
  sessionId: string | null;
  providerId: string | null;
  modelId: string | null;
  runtimeAgentId: string | null;
}

type AgentDisplayStatus =
  | "active"
  | "awaiting"
  | "updated"
  | "interrupted"
  | "completed"
  | "failed";

function agentStatus(kind: string): AgentDisplayStatus {
  if (kind === "error" || kind === "failed") return "failed";
  if (kind === "permission") return "awaiting";
  return subagentDisplayStatus(kind);
}

function isRunning(status: AgentDisplayStatus): boolean {
  return status === "active" || status === "awaiting";
}

/** Latest state per agent across the chat's turn records. */
function collectAgents(records: TurnRecord[]): AgentState[] {
  const byId = new Map<string, AgentState>();
  for (const record of records) {
    for (const recorded of record.items) {
      if (recorded.item.type !== "subAgentActivity") continue;
      const item = recorded.item;
      const existing = byId.get(item.agentId);
      byId.set(item.agentId, {
        id: item.agentId,
        label: item.label,
        kind: item.kind,
        detail: item.detail,
        events: (existing?.events ?? 0) + 1,
        runtime: item.runtime ?? existing?.runtime ?? null,
        sessionId: item.sessionId ?? existing?.sessionId ?? null,
        providerId: item.providerId ?? existing?.providerId ?? null,
        modelId: item.modelId ?? existing?.modelId ?? null,
        runtimeAgentId: item.runtimeAgentId ?? existing?.runtimeAgentId ?? null,
      });
    }
  }
  return [...byId.values()];
}

/** Deterministic hue from the agent id: the chip color is stable per agent. */
function avatarHue(id: string): number {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  }
  return hash;
}

function StatusIcon({ status }: Readonly<{ status: AgentDisplayStatus }>) {
  if (status === "active") return <Loader2 className="size-3 shrink-0 animate-spin" />;
  if (status === "awaiting")
    return <ShieldAlert className="size-3 shrink-0 text-amber-500" />;
  if (status === "completed") return <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />;
  if (status === "interrupted")
    return <Square className="size-3 shrink-0 text-muted-foreground" />;
  if (status === "failed") return <XCircle className="size-3 shrink-0 text-destructive" />;
  return <MessageSquareText className="size-3 shrink-0 text-sky-500" />;
}

function statusLabel(status: AgentDisplayStatus): string {
  switch (status) {
    case "active":
      return i18n.t(($) => $.ai.subagents.status.active);
    case "awaiting":
      return i18n.t(($) => $.ai.subagents.status.awaiting);
    case "interrupted":
      return i18n.t(($) => $.ai.subagents.status.interrupted);
    case "completed":
      return i18n.t(($) => $.ai.subagents.status.completed);
    case "failed":
      return i18n.t(($) => $.ai.subagents.status.failed);
    default:
      return i18n.t(($) => $.ai.subagents.status.updated);
  }
}

type Transcript =
  | { agent: string; type: "text"; text: string }
  | { agent: string; type: "acp"; rows: RenderedMessage[]; truncated: boolean };

async function readAcpTranscript(projectId: string, sessionId: string) {
  const events: AcpEvent[] = [];
  let after = 0;
  let hasMore = true;
  for (let pageNumber = 0; pageNumber < 10 && hasMore; pageNumber++) {
    const page = await acpEvents(projectId, sessionId, after, 300);
    events.push(...page.events);
    hasMore = page.hasMore;
    const last = page.events.at(-1);
    if (!last || last.sequence <= after) break;
    after = last.sequence;
  }
  return { events, truncated: hasMore };
}

export function SubagentActivity({
  chatId,
  streaming,
  activeRunId,
  onError,
  onOpenSession,
  projectId,
}: Readonly<{
  chatId: string;
  streaming: boolean;
  activeRunId: () => string | null;
  onError?: (message: string) => void;
  onOpenSession?: (sessionId: string, runtime?: "built-in" | "acp" | null) => void;
  projectId?: string | null;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  // A stable empty array keeps the selector's output referentially equal
  // for chats without records (a fresh [] would re-render on every touch).
  const records = useAgentTurnsStore((state) => state.recordsByChat[chatId] ?? EMPTY_RECORDS);
  const agents = useMemo(() => collectAgents(records), [records]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const transcriptRequestRef = useRef(0);

  useEffect(() => {
    void chatId;
    transcriptRequestRef.current += 1;
    setExpanded(null);
    setTranscript(null);
  }, [chatId]);

  if (agents.length === 0) return null;
  const anyRunning = agents.some((agent) => isRunning(agentStatus(agent.kind)));
  const anyAwaiting = agents.some((agent) => agentStatus(agent.kind) === "awaiting");

  const openTranscript = async (agent: AgentState) => {
    const request = ++transcriptRequestRef.current;
    if (agent.runtime === "acp") {
      if (!projectId || !agent.sessionId) {
        setTranscript({
          agent: agent.id,
          type: "text",
          text: t(($) => $.ai.subagents.noSessionInfo),
        });
        return;
      }
      setTranscript({ agent: agent.id, type: "text", text: t(($) => $.ai.subagents.loadingTranscript) });
      try {
        const result = await readAcpTranscript(projectId, agent.sessionId);
        if (transcriptRequestRef.current !== request) return;
        setTranscript({
          agent: agent.id,
          type: "acp",
          rows: projectAcpEvents(result.events, isRunning(agentStatus(agent.kind))),
          truncated: result.truncated,
        });
      } catch {
        if (transcriptRequestRef.current !== request) return;
        setTranscript({
          agent: agent.id,
          type: "text",
          text: t(($) => $.ai.subagents.transcriptFailed),
        });
      }
      return;
    }
    // The child rollout is only written when the subagent finishes, so a
    // read while it is still active would fail. Show its live progress (the
    // expanded panel already renders "Latest: …") and the accurate status
    // instead of a spurious load error.
    if (isRunning(agentStatus(agent.kind))) {
      setTranscript({
        agent: agent.id,
        type: "text",
        text: t(($) => $.ai.subagents.stillWorking),
      });
      return;
    }
    setTranscript({ agent: agent.id, type: "text", text: t(($) => $.ai.subagents.loadingTranscript) });
    try {
      const turns = await agentThreadRead(agent.sessionId ?? `thread-${agent.id}`);
      if (transcriptRequestRef.current !== request) return;
      const last = [...turns].reverse().find((turn) => turn.status !== "interrupted") ?? turns[0];
      const answer = last?.items
        ?.filter((item) => item.item.type === "agentMessage")
        .map((item) => String(item.item.text ?? ""))
        .join("\n\n")
        .trim();
      setTranscript({
        agent: agent.id,
        type: "text",
        text: answer || t(($) => $.ai.subagents.noFinalAnswer),
      });
    } catch {
      if (transcriptRequestRef.current !== request) return;
      setTranscript({
        agent: agent.id,
        type: "text",
        text: t(($) => $.ai.subagents.transcriptFailed),
      });
    }
  };

  const stopAll = async () => {
    const runId = activeRunId();
    if (!runId) return;
    try {
      await agentSubagentsStop(runId);
    } catch {
      onError?.(t(($) => $.ai.subagents.stopFailed));
    }
  };

  return (
    <div
      data-testid="subagent-activity"
      className="flex flex-col gap-1.5 rounded-md border border-border/70 bg-muted/30 px-2.5 py-2"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Bot className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 font-medium">
          {anyRunning
            ? t(($) => $.ai.subagents.working)
            : t(($) => $.ai.subagents.count, { count: agents.length })}
        </span>
        {anyRunning && streaming && (
          <button
            type="button"
            data-testid="subagent-stop-all"
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-destructive transition-colors hover:bg-accent"
            onClick={() => void stopAll()}
          >
            <Square className="size-3" />
            {t(($) => $.ai.subagents.stopAll)}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {agents.map((agent) => {
          const status = agentStatus(agent.kind);
          const open = expanded === agent.id;
          return (
            <button
              key={agent.id}
              type="button"
              data-testid={`subagent-chip-${agent.id}`}
              data-subagent-chip={agent.id}
              data-subagent-status={status}
              aria-expanded={open}
              className={cn(
                "flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] transition-colors hover:bg-accent",
                open && "bg-accent",
              )}
              onClick={() => {
                setExpanded(open ? null : agent.id);
                setTranscript(null);
                if (!open) void openTranscript(agent);
              }}
            >
              <span
                aria-hidden
                className="flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ backgroundColor: `hsl(${avatarHue(agent.id)} 55% 45%)` }}
              >
                {agent.label.slice(0, 1).toUpperCase()}
              </span>
              <span className="max-w-40 truncate">{agent.label}</span>
              <StatusIcon status={status} />
              <span
                className={cn(
                  "text-muted-foreground",
                  status === "awaiting" && "font-medium text-amber-600 dark:text-amber-400",
                )}
              >
                {statusLabel(status)}
              </span>
            </button>
          );
        })}
      </div>
      {expanded && (
        <div className="rounded-md border border-border/60 bg-background px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
          <div className="mb-1 flex items-center gap-2">
            <span className="font-medium text-foreground">
              {agents.find((agent) => agent.id === expanded)?.label}
            </span>
            <span className="text-muted-foreground">
              {t(($) => $.ai.subagents.updates, {
                count: agents.find((agent) => agent.id === expanded)?.events ?? 0,
              })}
            </span>
          </div>
          <div>
            {transcript?.agent === expanded && transcript.type === "acp" ? (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {transcript.truncated && (
                  <p className="text-[10px]">{t(($) => $.ai.subagents.transcriptTruncated)}</p>
                )}
                {transcript.rows.length > 0 ? transcript.rows.slice(-80).map((row) => (
                  <MessageItem
                    key={row.key}
                    msg={row.msg}
                    live={row.live}
                    expansionScope={`${chatId}:subagent:${expanded}:${row.key}`}
                  />
                )) : <p>{t(($) => $.ai.subagents.noTranscriptYet)}</p>}
              </div>
            ) : (
              (() => {
                const answered = transcript?.agent === expanded && transcript.type === "text";
                const raw = answered
                  ? transcript.text
                  : (agents.find((agent) => agent.id === expanded)?.detail ??
                      t(($) => $.ai.subagents.workingDetail));
                const split = splitAgentNotices(raw);
                return (
                  <>
                    {split.text ? (
                      <p>
                        {answered
                          ? split.text
                          : t(($) => $.ai.subagents.latest, { text: split.text })}
                      </p>
                    ) : null}
                    {split.notices.map((notice) => (
                      <p
                        key={notice}
                        data-testid="agent-notice"
                        className="mt-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[10px] leading-snug"
                      >
                        {notice}
                      </p>
                    ))}
                  </>
                );
              })()
            )}
          </div>
          {(() => {
            const agent = agents.find((value) => value.id === expanded);
            const details = [agent?.runtimeAgentId, agent?.providerId, agent?.modelId].filter(Boolean);
            return details.length > 0 ? (
              <p className="mt-2 text-[10px] text-muted-foreground">{details.join(" · ")}</p>
            ) : null;
          })()}
          {onOpenSession && (
            <button
              type="button"
              className="mt-2 rounded px-1.5 py-1 font-medium text-foreground hover:bg-accent"
              onClick={() => {
                const agent = agents.find((value) => value.id === expanded);
                onOpenSession(agent?.sessionId ?? `thread-${expanded}`, agent?.runtime);
              }}
            >
              {t(($) => $.ai.subagents.openTask)}
            </button>
          )}
        </div>
      )}
      {anyAwaiting && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          <ShieldAlert className="size-3" />
          {t(($) => $.ai.subagents.awaitingPermission)}
        </div>
      )}
      {agents.some((agent) => agentStatus(agent.kind) === "failed") && (
        <div className="flex items-center gap-1.5 text-[11px] text-destructive">
          <XCircle className="size-3" />
          {t(($) => $.ai.subagents.taskFailed)}
        </div>
      )}
    </div>
  );
}
