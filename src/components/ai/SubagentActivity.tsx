// Live sub-agent activity: chips with seeded avatars derived from the turn
// record's subAgentActivity items (in arrival order), an expandable per-agent
// detail line, the agent's full transcript from its rollout thread, and a
// Stop-all affordance that interrupts the children without stopping the run.

import { useMemo, useRef, useState } from "react";
import { Bot, CheckCircle2, Loader2, MessageSquareText, Square, XCircle } from "lucide-react";
import { subagentDisplayStatus } from "@oleafly/ai-core";
import type { TurnRecord } from "@oleafly/ai-core";
import { useAgentTurnsStore } from "@/store/agent-turns";
import { agentSubagentsStop, agentThreadRead } from "@/lib/agent-backend";
import { cn } from "@/lib/utils";

const EMPTY_RECORDS: TurnRecord[] = [];

interface AgentState {
  id: string;
  label: string;
  kind: string;
  detail: string | null;
  events: number;
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
      });
    }
  }
  return [...byId.values()];
}

/** Deterministic hue from the agent id: the chip color is stable per agent. */
function avatarHue(id: string): number {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return hash;
}

function StatusIcon({ status }: { status: ReturnType<typeof subagentDisplayStatus> }) {
  if (status === "active") return <Loader2 className="size-3 shrink-0 animate-spin" />;
  if (status === "completed") return <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />;
  if (status === "interrupted")
    return <Square className="size-3 shrink-0 text-muted-foreground" />;
  return <MessageSquareText className="size-3 shrink-0 text-sky-500" />;
}

const STATUS_LABELS: Record<string, string> = {
  active: "working",
  updated: "updated",
  interrupted: "stopped",
  completed: "done",
};

export function SubagentActivity({
  chatId,
  streaming,
  activeRunId,
  onError,
}: {
  chatId: string;
  streaming: boolean;
  activeRunId: () => string | null;
  onError?: (message: string) => void;
}) {
  // A stable empty array keeps the selector's output referentially equal
  // for chats without records (a fresh [] would re-render on every touch).
  const records = useAgentTurnsStore((state) => state.recordsByChat[chatId] ?? EMPTY_RECORDS);
  const agents = useMemo(() => collectAgents(records), [records]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<{ agent: string; text: string } | null>(null);
  const transcriptRequestRef = useRef(0);

  if (agents.length === 0) return null;
  const anyRunning = agents.some(
    (agent) => subagentDisplayStatus(agent.kind) === "active",
  );

  const openTranscript = async (agent: AgentState) => {
    const request = ++transcriptRequestRef.current;
    // The child rollout is only written when the subagent finishes, so a
    // read while it is still active would fail. Show its live progress (the
    // expanded panel already renders "Latest: …") and the accurate status
    // instead of a spurious load error.
    if (subagentDisplayStatus(agent.kind) === "active") {
      setTranscript({
        agent: agent.id,
        text: "This subagent is still working. Its full transcript opens when it finishes.",
      });
      return;
    }
    setTranscript({ agent: agent.id, text: "Loading transcript…" });
    try {
      const turns = await agentThreadRead(`thread-${agent.id}`);
      if (transcriptRequestRef.current !== request) return;
      const last = [...turns].reverse().find((turn) => turn.status !== "interrupted") ?? turns[0];
      const answer = last?.items
        ?.filter((item) => item.item.type === "agentMessage")
        .map((item) => String(item.item.text ?? ""))
        .join("\n\n")
        .trim();
      setTranscript({
        agent: agent.id,
        text: answer || "This agent did not record a final answer.",
      });
    } catch {
      if (transcriptRequestRef.current !== request) return;
      setTranscript({ agent: agent.id, text: "The transcript could not be loaded." });
    }
  };

  const stopAll = async () => {
    const runId = activeRunId();
    if (!runId) return;
    try {
      await agentSubagentsStop(runId);
    } catch {
      onError?.("The subagents could not be stopped.");
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
          {anyRunning ? "Subagents working" : `Subagents (${agents.length})`}
        </span>
        {anyRunning && streaming && (
          <button
            type="button"
            data-testid="subagent-stop-all"
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-destructive transition-colors hover:bg-accent"
            onClick={() => void stopAll()}
          >
            <Square className="size-3" />
            Stop all
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {agents.map((agent) => {
          const status = subagentDisplayStatus(agent.kind);
          const open = expanded === agent.id;
          return (
            <button
              key={agent.id}
              type="button"
              data-testid={`subagent-chip-${agent.id}`}
              data-subagent-chip={agent.id}
              data-subagent-status={status}
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
              <span className="text-muted-foreground">{STATUS_LABELS[status]}</span>
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
              {agents.find((agent) => agent.id === expanded)?.events ?? 0} updates
            </span>
          </div>
          <div>
            {transcript?.agent === expanded
              ? transcript.text
              : "Latest: " +
                (agents.find((agent) => agent.id === expanded)?.detail ?? "working")}
          </div>
        </div>
      )}
      {agents.some((agent) => subagentDisplayStatus(agent.kind) === "completed" && agent.kind === "error") && (
        <div className="flex items-center gap-1.5 text-[11px] text-destructive">
          <XCircle className="size-3" />
          A subagent failed; its answer will note the error.
        </div>
      )}
    </div>
  );
}
