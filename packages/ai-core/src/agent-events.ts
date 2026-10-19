import type { AgentUsage } from "./usage";

// The agent event wire union (mirrors crates/oleafly-agent/src/event.rs,
// serde tag "kind", camelCase fields). The app's transport layer
// (src/lib/agent-backend.ts) re-exports this; the package owns the shape so
// folds stay framework-free.

/** Things the user should know about a run that are not errors. */
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
      /** The latest step alone: the context the model just saw. */
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
