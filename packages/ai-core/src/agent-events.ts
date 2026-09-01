// The agent event wire union (mirrors crates/oleafly-agent/src/event.rs,
// serde tag "kind", camelCase fields). The app's transport layer
// (src/lib/agent-backend.ts) re-exports this; the package owns the shape so
// folds stay framework-free.

export type AgentUsage = { input: number; output: number };

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
  | { kind: "usage"; usage: AgentUsage }
  | {
      kind: "subagentUpdate";
      id: string;
      label: string;
      state: string;
      detail: string | null;
    }
  | { kind: "compacted"; droppedMessages: number; reason: string }
  | { kind: "steered"; text: string }
  | { kind: "done"; stopReason: string | null }
  | { kind: "error"; message: string; retryable: boolean };
