import type { AgentUsage } from "./usage";

export type AgentNoticeCode =
  | "attachment_sent_as_text"
  | "attachment_skipped"
  | "web_search_unavailable";

export type AgentEvent =
  | { kind: "stepStart"; step: number }
  | { kind: "retry"; attempt: number; max: number }
  | { kind: "toolRequest"; id: string; name: string; arguments: string }
  | { kind: "toolOutcome"; id: string; output: string }
  | { kind: "textDelta"; text: string }
  | { kind: "reasoningDelta"; text: string }
  | { kind: "toolCallStart"; id: string; name: string }
  | { kind: "toolCallArgsDelta"; id: string; json: string }
  | { kind: "toolCallEnd"; id: string; arguments: string }
  | {
      kind: "usage";
      usage: AgentUsage;
      lastStep?: AgentUsage | null;
      contextWindow?: number | null;
    }
  | { kind: "notice"; code: AgentNoticeCode | (string & {}); detail: string | null }
  | {
      kind: "subagentUpdate";
      runtime?: "built-in" | "acp" | null;
      sessionId?: string | null;
      providerId?: string | null;
      modelId?: string | null;
      agentId?: string | null;
      id: string;
      label: string;
      state: string;
      detail: string | null;
    }
  | { kind: "compacted"; droppedMessages: number; reason: string }
  | { kind: "steered"; text: string }
  | { kind: "done"; stopReason: string | null }
  | { kind: "error"; message: string; retryable: boolean }
  | { kind: "runEnd" };
